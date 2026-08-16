# app/notify.py — completion notifications: generic webhook and/or Telegram Saved Messages.
import logging
import httpx
from . import settings

log = logging.getLogger("notify")


async def _webhook(text):
    hook = settings.get("notify_webhook", "")
    if not hook:
        return None
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(hook, json={"content": text, "text": text}, timeout=10)
        return r.status_code < 400
    except Exception as e:
        log.warning("webhook notify failed: %s", e)
        return False


async def _telegram(text):
    if not settings.get_bool("notify_telegram", False):
        return None
    try:
        from . import tg
        c = tg.get_client()
        if not c.is_connected():
            await c.connect()
        await c.send_message("me", text)        # "me" = the account's Saved Messages
        return True
    except Exception as e:
        log.warning("telegram notify failed: %s", e)
        return False


async def send(title, detail=""):
    text = f"📥 {title}" + (f"\n{detail}" if detail else "")
    await _webhook(text)
    await _telegram(text)


async def test():
    results, ok = [], True
    w = await _webhook("✅ Telearr test notification")
    if w is not None:
        results.append("Webhook " + ("✓" if w else "✗"))
        ok = ok and w
    t = await _telegram("✅ Telearr test — notifications are working.")
    if t is not None:
        results.append("Telegram Saved Messages " + ("✓" if t else "✗"))
        ok = ok and t
    if not results:
        return {"ok": True, "detail": "No notification channels enabled — turn on a webhook or Telegram below."}
    return {"ok": ok, "detail": " · ".join(results)}
