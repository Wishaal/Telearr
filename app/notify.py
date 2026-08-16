# app/notify.py — fire-and-forget completion notification to a generic webhook.
# Payload is Discord/Slack-compatible and also carries structured fields.
import logging
import httpx
from . import settings

log = logging.getLogger("notify")


async def send(title: str, detail: str = ""):
    hook = settings.get("notify_webhook", "")
    if not hook:
        return
    text = f"📥 {title}" + (f"\n{detail}" if detail else "")
    try:
        async with httpx.AsyncClient() as client:
            await client.post(hook, json={"content": text, "text": text,
                                          "title": title, "detail": detail}, timeout=10)
    except Exception as e:
        log.warning("notify failed: %s", e)


async def test() -> dict:
    hook = settings.get("notify_webhook", "")
    if not hook:
        return {"ok": False, "detail": "No webhook URL set"}
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(hook, json={"content": "✅ Telearr test notification",
                                              "text": "✅ Telearr test notification"}, timeout=10)
        return {"ok": r.status_code < 400, "detail": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"ok": False, "detail": str(e)}
