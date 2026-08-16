# app/tmdb.py — server-side TMDB proxy for poster/backdrop artwork.
# The API key stays on the server; the browser only ever receives public image URLs.
import time
import logging
import httpx
from . import settings

log = logging.getLogger("tmdb")
IMG = "https://image.tmdb.org/t/p/"
_cache = {}          # imdb_id -> (ts, data)
TTL = 86400          # 1 day


async def art(imdb_id: str):
    key = settings.get("tmdb_key", "")
    if not key or not imdb_id:
        return {}
    now = time.time()
    hit = _cache.get(imdb_id)
    if hit and now - hit[0] < TTL:
        return hit[1]
    data = {}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"https://api.themoviedb.org/3/find/{imdb_id}",
                                  params={"api_key": key, "external_source": "imdb_id"}, timeout=10)
            r.raise_for_status()
            j = r.json()
            results = (j.get("tv_results") or []) + (j.get("movie_results") or [])
            if results:
                m = results[0]
                data = {
                    "poster": (IMG + "w342" + m["poster_path"]) if m.get("poster_path") else "",
                    "backdrop": (IMG + "w1280" + m["backdrop_path"]) if m.get("backdrop_path") else "",
                    "title": m.get("name") or m.get("title") or "",
                    "overview": (m.get("overview") or "")[:300],
                    "rating": round(m.get("vote_average") or 0, 1),
                    "year": (m.get("first_air_date") or m.get("release_date") or "")[:4],
                }
    except Exception as e:
        log.warning("tmdb art failed for %s: %s", imdb_id, e)
    _cache[imdb_id] = (now, data)
    return data


async def test():
    key = settings.get("tmdb_key", "")
    if not key:
        return {"ok": False, "detail": "No TMDB API key set"}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get("https://api.themoviedb.org/3/configuration",
                                  params={"api_key": key}, timeout=10)
        return {"ok": r.status_code < 400,
                "detail": "Connected to TMDB" if r.status_code < 400 else f"HTTP {r.status_code} — check the key"}
    except Exception as e:
        return {"ok": False, "detail": str(e)}
