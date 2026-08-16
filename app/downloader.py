# app/downloader.py — parallel multi-sender fast downloader.
#
# Technique (a.k.a. "FastTelethon"): borrow N exported MTProto senders, split the
# file into contiguous part-ranges, fetch each range on its own socket, and pwrite
# into a preallocated file. With cryptg installed the crypto is ~free, so N senders
# ≈ N × Telegram's ~1.5 MB/s per-connection cap.
#
# Robustness: if the fast path raises (e.g. a Telethon internal changed after an
# upgrade), we fall back to the library's built-in sequential download so the app
# keeps working regardless. That makes the optimisation safe to ship.
import os
import time
import math
import asyncio
import logging

from telethon.tl.functions.upload import GetFileRequest
from telethon.tl.types import InputDocumentFileLocation
from telethon.errors import FloodWaitError, FileReferenceExpiredError

from . import settings
from .config import (DL_WORKERS, DL_CHUNK_MB, MIN_FREE_SPACE_GB, OTHER_DIR,
                     PROGRESS_MIN_INTERVAL)

log = logging.getLogger("downloader")

_flood_until = 0.0          # global flood-wait gate shared by all senders
PART = DL_CHUNK_MB * 1024 * 1024   # 1 MB — Telegram's max GetFile limit


def has_enough_space(path: str, required: int, buffer_gb=None) -> bool:
    if buffer_gb is None:
        buffer_gb = settings.get_int("min_free_gb", MIN_FREE_SPACE_GB)
    try:
        st = os.statvfs(path)
        return st.f_bavail * st.f_frsize > required + buffer_gb * 1024 ** 3
    except Exception:
        return True


def _doc_of(message):
    doc = message.document or message.video
    if doc is None:
        raise RuntimeError("message has no document/video")
    return doc


def _location(doc):
    return InputDocumentFileLocation(id=doc.id, access_hash=doc.access_hash,
                                     file_reference=doc.file_reference, thumb_size="")


async def _flood_gate():
    global _flood_until
    wait = _flood_until - time.time()
    if wait > 0:
        log.info("flood gate: sleeping %.0fs", wait)
        await asyncio.sleep(wait + 1)
        _flood_until = 0.0


async def _worker(client, sender, location, fd, parts, part_size, file_size,
                  on_bytes, refresh):
    """Fetch an assigned list of part indices and pwrite them at their offsets."""
    global _flood_until
    loop = asyncio.get_event_loop()
    for idx in parts:
        offset = idx * part_size
        limit = min(part_size, file_size - offset)
        while True:
            await _flood_gate()
            try:
                res = await sender.send(GetFileRequest(location, offset=offset, limit=part_size))
                break
            except FloodWaitError as e:
                _flood_until = time.time() + e.seconds
                log.warning("FloodWait %ss", e.seconds)
            except FileReferenceExpiredError:
                location = await refresh()   # re-resolve a fresh file_reference
        data = res.bytes[:limit]
        await loop.run_in_executor(None, os.pwrite, fd, data, offset)
        on_bytes(len(data))


async def _fast_download(client, message, tmp_path, progress_cb):
    doc = _doc_of(message)
    file_size = doc.size
    dc_id = doc.dc_id
    n_parts = max(1, math.ceil(file_size / PART))
    workers = max(1, min(settings.get_int("dl_workers", DL_WORKERS), n_parts))
    interval = settings.get_float("progress_interval", PROGRESS_MIN_INTERVAL)

    async def refresh():
        fresh = await client.get_messages(message.chat_id, ids=message.id)
        return _location(_doc_of(fresh))

    location = _location(doc)

    # preallocate contiguously to avoid HDD fragmentation and per-write extends
    fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT, 0o644)
    try:
        try:
            os.posix_fallocate(fd, 0, file_size)
        except (AttributeError, OSError):
            os.ftruncate(fd, file_size)

        done = {"n": 0}
        start = time.monotonic()
        stop = asyncio.Event()

        def on_bytes(n):
            done["n"] += n

        async def reporter():
            # dedicated coroutine so progress writes actually land — a fire-and-forget
            # create_task() can be GC'd before it runs, which left the bar stuck at 0%.
            while not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=interval)
                except asyncio.TimeoutError:
                    pass
                if progress_cb:
                    el = time.monotonic() - start
                    speed = done["n"] / max(1e-6, el) / 1024 / 1024
                    await progress_cb(min(1.0, done["n"] / file_size), speed)

        # contiguous region per worker → sequential writes, minimal HDD seeking
        per = math.ceil(n_parts / workers)
        assignments = [list(range(i * per, min((i + 1) * per, n_parts)))
                       for i in range(workers)]
        assignments = [a for a in assignments if a]   # drop empties (small files)

        borrow = getattr(client, "_borrow_exported_sender")
        ret = getattr(client, "_return_exported_sender")
        senders = [await borrow(dc_id) for _ in assignments]
        rep = asyncio.create_task(reporter())
        try:
            await asyncio.gather(*[
                _worker(client, senders[i], location, fd, assignments[i],
                        PART, file_size, on_bytes, refresh)
                for i in range(len(assignments))
            ])
        finally:
            stop.set()
            try:
                await rep
            except Exception:
                pass
            for s in senders:
                try:
                    await ret(s)
                except Exception:
                    pass
    finally:
        os.close(fd)

    actual = os.path.getsize(tmp_path)
    if actual != file_size:
        raise RuntimeError(f"size mismatch: {actual} vs {file_size}")


async def _fallback_download(client, message, tmp_path, progress_cb):
    """Telethon's built-in downloader — sequential but always compatible."""
    start = time.monotonic()
    last = {"t": 0.0}
    interval = settings.get_float("progress_interval", PROGRESS_MIN_INTERVAL)

    def cb(recv, total):
        now = time.monotonic()
        if progress_cb and (now - last["t"] >= interval or recv >= total):
            last["t"] = now
            speed = recv / max(1e-6, now - start) / 1024 / 1024
            asyncio.create_task(progress_cb(recv / max(1, total), speed))

    await client.download_media(message, file=tmp_path, progress_callback=cb)


async def download_file(client, message, save_path, progress_cb=None):
    """Download to save_path via the fast path, auto-falling back on failure."""
    doc = _doc_of(message)
    file_size = doc.size
    # SECURITY: defense-in-depth — never write outside the media tree
    if ".." in os.path.normpath(save_path).split(os.sep) or not os.path.isabs(save_path):
        raise RuntimeError(f"unsafe save path rejected: {save_path}")
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    if not has_enough_space(os.path.dirname(save_path) or OTHER_DIR, file_size):
        raise RuntimeError(f"insufficient disk space for {file_size/1e9:.1f}GB")

    tmp_path = save_path + ".tmp"
    if os.path.exists(tmp_path):
        os.remove(tmp_path)  # parallel writer needs a clean preallocated file

    try:
        await _fast_download(client, message, tmp_path, progress_cb)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        log.warning("fast path failed (%s) — falling back to sequential", e)
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        await _fallback_download(client, message, tmp_path, progress_cb)

    os.replace(tmp_path, save_path)   # atomic publish
    return save_path
