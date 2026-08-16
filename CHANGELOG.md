# Changelog

## Unreleased — UI overhaul
- Installable **PWA** (manifest + icons) with SVG favicon and gradient brand identity.
- **Real-time SSE** live updates (stats, active downloads, speed) — no more polling lag.
- **⌘K command palette** for navigation and actions.
- Dashboard: **storage donut**, animated count-up stats, and a **live download-speed sparkline**.
- Channels are now a **TMDB poster library** (server-side proxy; API key never hits the browser).
- Branded login screen, richer empty states, poster loading shimmer, micro-interactions, per-view page titles, theme-color + safe-area for mobile.

## 2.1.0 — \*arr integration + open-source scaffolding
Telearr can now plug into the \*arr stack, and the project has proper
open-source project files for external contributors.

### \*arr integration
- **Newznab-compatible indexer** at `http://<host>:8790/api/newznab` — add Telearr
  to Prowlarr/Sonarr/Radarr as a Newznab indexer (categories `5000` = TV,
  `2000` = Movies) and search Telegram channels like a usenet indexer.
- **SABnzbd-compatible download client** on the same host/port — Sonarr/Radarr add
  Telearr as a SABnzbd client; grabs resolve to Telegram messages and download
  through the existing fast pipeline, landing where the \*arr app imports them.
- New `releases` table maps synthetic Newznab release GUIDs back to
  `(channel_id, message_id)` so indexer results and SABnzbd grabs share a stable
  handle.
- API-key auth guards both APIs (managed from the Settings page).
- See `docs/ARR_INTEGRATION.md` for setup and known limitations of this young
  integration.

### Project / open source
- Rebranded to **Telearr** with a rewritten `README.md`.
- Added `LICENSE` (GPL-3.0, matching the \*arr ecosystem).
- Added `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1), and
  `SECURITY.md`.
- Added `docs/ARCHITECTURE.md` (module map, data-flow diagram, DB schema, \*arr
  design) and `docs/ARR_INTEGRATION.md`.
- Added GitHub Actions CI (`.github/workflows/ci.yml`) running pytest on Python
  3.13, plus issue and pull-request templates.

## 2.0.0 — containerized, hardened, optimized rewrite
Schema/session-compatible with v1 (imported by `deploy.sh`).

### Speed
- cryptg (AES-NI) in the image.
- Parallel multi-sender downloader with preallocation + automatic sequential fallback.
- Right-sized worker/concurrency defaults; all tunable via env.

### Reliability
- Throttled progress writes; WAL auto-checkpoint on boot.
- Added `idx_dl_chan_gk`, `idx_dl_status`, `idx_logs_chan_id`.
- Strong refs on background tasks; crash-resume of interrupted downloads.
- Bounded container logs.

### Security / architecture
- Non-root (`PUID/PGID`); 127.0.0.1 bind by default.
- Secrets in `0600 .env`; pinned deps; multi-stage build.
- Normalizes bare channel ids to `-100…` form on add.

### Features
- 4K/1080p auto-routing by detected quality.
- Targeted Plex refresh; completion webhooks; episode-title cleanup.
- Underscore-separator episode parsing (`Season_15_Episode_1`, `S15_E02`, …).
