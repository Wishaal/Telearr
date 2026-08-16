# app/tg.py — single shared Telethon client.
from telethon import TelegramClient
from .config import API_ID, API_HASH, SESSION_PATH

_client: TelegramClient | None = None


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
