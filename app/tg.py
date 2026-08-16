# app/tg.py — single shared Telethon client + account helpers.
import re
import time
import logging
from telethon import TelegramClient, utils
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest, CheckChatInviteRequest
from .config import API_ID, API_HASH, SESSION_PATH

log = logging.getLogger("tg")
_client: TelegramClient | None = None
_dialogs_cache = {"ts": 0, "data": []}


def get_client() -> TelegramClient:
    global _client
    if _client is None:
        # connection_retries/​retry_delay make the long-lived scanner resilient
        # to transient MTProto drops; flood_sleep_threshold lets Telethon auto-wait
        # short flood waits instead of raising.
        _client = TelegramClient(
            SESSION_PATH, API_ID, API_HASH,
            connection_retries=5,
            retry_delay=2,
            auto_reconnect=True,
            flood_sleep_threshold=60,
        )
    return _client


async def _ready():
    c = get_client()
    if not c.is_connected():
        await c.connect()
    return c if await c.is_user_authorized() else None


async def list_dialogs(limit=250):
    """Channels/groups the logged-in account belongs to — so users pick, not paste ids."""
    now = time.time()
    if now - _dialogs_cache["ts"] < 30 and _dialogs_cache["data"]:
        return _dialogs_cache["data"]
    c = await _ready()
    if not c:
        return []
    out = []
    try:
        async for d in c.iter_dialogs(limit=limit):
            if d.is_user:
                continue
            e = d.entity
            out.append({
                "chat_id": d.id,
                "title": d.title or getattr(e, "title", "") or "",
                "username": getattr(e, "username", None) or "",
                "kind": "channel" if getattr(e, "broadcast", False) else "group",
                "members": getattr(e, "participants_count", None),
            })
    except Exception as e:
        log.warning("list_dialogs failed: %s", e)
    out.sort(key=lambda x: x["title"].lower())
    _dialogs_cache.update(ts=now, data=out)
    return out


def _invite_hash(q):
    m = re.search(r"(?:t\.me/\+|t\.me/joinchat/|joinchat/|(?:^|/)\+)([A-Za-z0-9_-]{12,})", q)
    return m.group(1) if m else None


async def resolve(query):
    """Resolve a @username / t.me link / invite link / id → chat, joining if needed."""
    c = await _ready()
    if not c:
        return {"error": "Telegram not connected"}
    q = (query or "").strip()
    if not q:
        return {"error": "empty"}
    ent = None
    try:
        ih = _invite_hash(q)
        if ih:
            try:
                upd = await c(ImportChatInviteRequest(ih))
                ent = upd.chats[0]
            except Exception:
                chk = await c(CheckChatInviteRequest(ih))   # likely already a member
                ent = getattr(chk, "chat", None)
                if ent is None:
                    raise
        else:
            u = re.sub(r"^https?://t\.me/", "", q).lstrip("@").strip("/")
            if re.fullmatch(r"-?\d+", u):
                cid = int(u)
                ent = await c.get_entity(cid if cid < 0 else int(f"-100{u}"))
            else:
                ent = await c.get_entity(u)
            try:                                            # join public channels so scans work
                if getattr(ent, "broadcast", False) or getattr(ent, "megagroup", False):
                    await c(JoinChannelRequest(ent))
            except Exception:
                pass
    except Exception as e:
        return {"error": str(e)}
    if ent is None:
        return {"error": "could not resolve"}
    _dialogs_cache["ts"] = 0   # invalidate so the new channel shows in the picker
    return {"chat_id": utils.get_peer_id(ent), "title": getattr(ent, "title", "") or "",
            "username": getattr(ent, "username", None) or ""}
