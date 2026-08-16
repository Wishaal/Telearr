#!/usr/bin/env bash
# Hermes Media v2 deploy — migrate v1 (systemd/root) → Docker (non-root).
# Run as root:  sudo bash deploy.sh
set -euo pipefail

PROJECT="/home/wishaal/hermes-media"
OLD="/root/hermes-media"
PUID=1000
PGID=1000
OWNER="wishaal"

[ "$EUID" -eq 0 ] || { echo "Run as root: sudo bash deploy.sh"; exit 1; }
cd "$PROJECT"

echo "==> 1/6 Reading Telegram API creds from the v1 install"
if [ -f "$OLD/app/config.py" ]; then
  API_ID=$(grep -oP 'API_ID\s*=\s*\K[0-9]+' "$OLD/app/config.py" | head -1)
  API_HASH=$(grep -oP 'API_HASH\s*=\s*"\K[^"]+' "$OLD/app/config.py" | head -1)
else
  echo "!! $OLD/app/config.py not found — set TG_API_ID/TG_API_HASH in .env manually."
  API_ID=""; API_HASH=""
fi

echo "==> 2/6 Generating .env (fresh secret + admin password)"
SECRET=$(openssl rand -hex 32)
ADMIN_PASS=$(openssl rand -base64 15 | tr -d '/+=' | cut -c1-16)
cat > .env <<EOF
TG_API_ID=${API_ID}
TG_API_HASH=${API_HASH}
PUID=${PUID}
PGID=${PGID}
HERMES_TV_DIR=/media/TvShows/1080p
HERMES_TV_DIR_4K=/media/TvShows/4K
HERMES_MOVIES_DIR=/media/Movies/1080p
HERMES_MOVIES_DIR_4K=/media/Movies/4K
HERMES_OTHER_DIR=/media/Other
HERMES_MIN_FREE_GB=50
HERMES_DL_WORKERS=16
HERMES_MAX_CONCURRENT=1
HERMES_DL_CHUNK_MB=1
HERMES_PROGRESS_INTERVAL=1.0
HERMES_SECRET_KEY=${SECRET}
HERMES_ADMIN_USER=${OWNER}
HERMES_ADMIN_PASS=${ADMIN_PASS}
PLEX_URL=
PLEX_TOKEN=
HERMES_NOTIFY_WEBHOOK=
EOF
chown "$OWNER:$OWNER" .env
chmod 600 .env

echo "==> 3/6 Importing existing DB + Telegram session"
mkdir -p data
if [ -f "$OLD/data/hermes.db" ]; then
  sqlite3 "$OLD/data/hermes.db" "PRAGMA wal_checkpoint(TRUNCATE);" || true
  cp -f "$OLD/data/hermes.db" data/hermes.db
  echo "   imported hermes.db ($(du -h data/hermes.db | cut -f1))"
else
  echo "   no v1 DB found — starting fresh (admin user will be seeded)"
fi
if [ -f "$OLD/data/session.session" ]; then
  cp -f "$OLD/data/session.session" data/session.session
  echo "   imported Telegram session (no re-login needed)"
else
  echo "   no v1 session — run: docker compose run --rm telearr python authorize.py"
fi
chown -R "$PUID:$PGID" data
chmod -R u+rwX data

echo "==> 4/6 Stopping and disabling the v1 systemd services"
for svc in hermes-media tg-downloader tg-webapp; do
  systemctl stop "$svc" 2>/dev/null || true
  systemctl disable "$svc" 2>/dev/null || true
done

echo "==> 5/6 Building and starting the container"
if docker compose version >/dev/null 2>&1; then DC="docker compose"; else DC="docker-compose"; fi
$DC build
$DC up -d

echo "==> 6/6 Waiting for health"
ok=""
for i in $(seq 1 30); do
  if curl -fsS -m 3 http://127.0.0.1:8790/healthz >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
$DC ps

echo
if [ -n "$ok" ]; then
  echo "✅ Hermes Media v2 is up at http://127.0.0.1:8790"
else
  echo "⚠ Health check didn't pass yet — check: $DC logs --tail 50"
fi
echo "   Login: ${OWNER} / ${ADMIN_PASS}"
echo "   (also saved in $PROJECT/.env as HERMES_ADMIN_PASS)"
echo
echo "Once verified, the v1 tree at $OLD can be archived/removed."
