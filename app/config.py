# app/config.py — all runtime config from environment (12-factor).
# Nothing secret is hard-coded; deploy.sh generates a 0600 .env.
import os


def _b(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


def _i(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


# ── Telegram ──────────────────────────────────────────────────────────
API_ID = _i("TG_API_ID", 0)
API_HASH = os.getenv("TG_API_HASH", "")

# ── Paths (inside the container these are volume mounts) ───────────────
DATA_DIR = os.getenv("HERMES_DATA_DIR", "/data")
LOG_DIR = os.getenv("HERMES_LOG_DIR", "/data/logs")
DB_PATH = os.path.join(DATA_DIR, "hermes.db")
SESSION_PATH = os.path.join(DATA_DIR, "session")  # Telethon appends .session

TV_DIR = os.getenv("HERMES_TV_DIR", "/media/TvShows/1080p")
TV_DIR_4K = os.getenv("HERMES_TV_DIR_4K", "/media/TvShows/4K")
MOVIES_DIR = os.getenv("HERMES_MOVIES_DIR", "/media/Movies/1080p")
MOVIES_DIR_4K = os.getenv("HERMES_MOVIES_DIR_4K", "/media/Movies/4K")
OTHER_DIR = os.getenv("HERMES_OTHER_DIR", "/media/Other")

MIN_FREE_SPACE_GB = _i("HERMES_MIN_FREE_GB", 50)

# ── Download performance ──────────────────────────────────────────────
# With cryptg installed, crypto is nearly free and the wall becomes
# Telegram's ~1.5 MB/s-per-connection cap → N senders ≈ N × 1.5 MB/s.
DL_WORKERS = _i("HERMES_DL_WORKERS", 4)           # exported senders per file (higher → Telegram FloodWait)
DL_CHUNK_MB = _i("HERMES_DL_CHUNK_MB", 1)          # 1 MB = Telegram max
MAX_CONCURRENT_DOWNLOADS = _i("HERMES_MAX_CONCURRENT", 1)
PROGRESS_MIN_INTERVAL = float(os.getenv("HERMES_PROGRESS_INTERVAL", "1.0"))  # s

# ── Web ───────────────────────────────────────────────────────────────
BIND_HOST = os.getenv("HERMES_BIND_HOST", "0.0.0.0")   # container-internal
BIND_PORT = _i("HERMES_BIND_PORT", 8790)
SECRET_KEY = os.getenv("HERMES_SECRET_KEY", "")
DEFAULT_USER = os.getenv("HERMES_ADMIN_USER", "wishaal")
DEFAULT_PASS = os.getenv("HERMES_ADMIN_PASS", "")

# ── Integrations (all optional) ───────────────────────────────────────
PLEX_URL = os.getenv("PLEX_URL", "").rstrip("/")        # e.g. http://plex_local:32400
PLEX_TOKEN = os.getenv("PLEX_TOKEN", "")
NOTIFY_WEBHOOK = os.getenv("HERMES_NOTIFY_WEBHOOK", "") # Discord/Slack/generic JSON

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)


def summary() -> dict:
    """Non-secret view of config, for the /api/status debug panel."""
    return {
        "tv_dir": TV_DIR, "tv_dir_4k": TV_DIR_4K,
        "movies_dir": MOVIES_DIR, "other_dir": OTHER_DIR,
        "dl_workers": DL_WORKERS, "max_concurrent": MAX_CONCURRENT_DOWNLOADS,
        "min_free_gb": MIN_FREE_SPACE_GB,
        "plex": bool(PLEX_URL and PLEX_TOKEN),
        "notify": bool(NOTIFY_WEBHOOK),
    }
