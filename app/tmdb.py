# app/tmdb.py — poster/backdrop artwork.
# Works KEYLESS out of the box via IMDb's public suggestion API (posters);
# if a TMDB key is configured it's preferred (higher-res posters + backdrops).
# All lookups are server-side; the browser only receives public image URLs.
import re
import time
import logging
import urllib.parse
import httpx
from . import settings

log = logging.getLogger("art")
IMG = "https://image.tmdb.org/t/p/"
_cache = {}          # imdb_id -> (ts, data)
TTL = 86400          # 1 day


async def _tmdb_art(imdb_id, key):
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"https://api.themoviedb.org/3/find/{imdb_id}",
                                  params={"api_key": key, "external_source": "imdb_id"}, timeout=10)
            r.raise_for_status()
            j = r.json()
        results = (j.get("tv_results") or []) + (j.get("movie_results") or [])
        if not results:
            return {}
        m = results[0]
        return {
            "poster": (IMG + "w342" + m["poster_path"]) if m.get("poster_path") else "",
            "backdrop": (IMG + "w1280" + m["backdrop_path"]) if m.get("backdrop_path") else "",
            "title": m.get("name") or m.get("title") or "",
            "rating": round(m.get("vote_average") or 0, 1),
            "year": (m.get("first_air_date") or m.get("release_date") or "")[:4],
        }
    except Exception as e:
        log.warning("tmdb art failed for %s: %s", imdb_id, e)
        return {}


def _imdb_resize(url):
    # IMDb/Amazon image URLs accept a size transform before the extension.
    return re.sub(r"\._V1_.*?(\.\w+)$", r"._V1_QL75_UX342_\1", url) if "._V1_" in url else url


async def _imdb_art(imdb_id, title):
    q = (title or imdb_id).strip()
    if not q:
        return {}
    first = q.lower()[0]
    url = f"https://v3.sg.media-imdb.com/suggestion/{first}/{urllib.parse.quote(q)}.json"
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            r.raise_for_status()
            items = r.json().get("d", []) or []
    except Exception as e:
        log.warning("imdb art failed for %s: %s", imdb_id, e)
        return {}
    # prefer the exact id match; else first result that has an image
    pick = next((it for it in items if it.get("id") == imdb_id and it.get("i", {}).get("imageUrl")), None) \
        or next((it for it in items if it.get("i", {}).get("imageUrl")), None)
    if not pick:
        return {}
    return {"poster": _imdb_resize(pick["i"]["imageUrl"]), "backdrop": "",
            "title": pick.get("l", ""), "year": str(pick.get("y") or ""), "rating": 0}


async def art(imdb_id, title=""):
    if not imdb_id:
        return {}
    now = time.time()
    hit = _cache.get(imdb_id)
    if hit and now - hit[0] < TTL:
        return hit[1]
    key = settings.get("tmdb_key", "")
    data = await _tmdb_art(imdb_id, key) if key else {}
    if not data.get("poster"):                       # keyless fallback (or TMDB miss)
        imdb = await _imdb_art(imdb_id, title)
        if imdb.get("poster"):
            imdb["backdrop"] = data.get("backdrop", "")
            data = imdb
    _cache[imdb_id] = (now, data)
    return data


async def test(key=None):
    # tests the passed-in key if given (so users can verify before saving), else the stored one
    k = (key or settings.get("tmdb_key", "")).strip()
    if not k:
        return {"ok": True, "detail": "No key entered — posters load from IMDb automatically. A TMDB key adds HD art + backdrops."}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get("https://api.themoviedb.org/3/configuration",
                                  params={"api_key": k}, timeout=10)
        if r.status_code < 400:
            return {"ok": True, "detail": "Connected to TMDB ✓"}
        return {"ok": False, "detail": f"Invalid key (HTTP {r.status_code})"}
    except Exception as e:
        return {"ok": False, "detail": str(e)}
