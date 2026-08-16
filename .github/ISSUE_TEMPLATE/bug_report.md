---
name: Bug report
about: Report something that isn't working as expected
title: "[Bug]: "
labels: bug
assignees: ""
---

## Describe the bug

A clear and concise description of what the bug is.

## To reproduce

Steps to reproduce the behavior:

1. Go to '...'
2. Add channel / grab release '...'
3. See error

## Expected behavior

What you expected to happen.

## Logs

Paste relevant output. **Redact secrets** (API hash, tokens, passwords).

- Container logs: `docker compose logs --tail=200 hermes-media`
- The Activity page in the UI, if relevant.

```
<logs here>
```

## Environment

- Telearr version (see the app footer / `app/__init__.py`):
- Deployment: [Docker Compose / local uvicorn]
- Host OS + architecture:
- Using the \*arr integration? [no / Sonarr / Radarr / Prowlarr] and their versions:

## Configuration (redact secrets)

Relevant `.env` / Settings values (e.g. `HERMES_DL_WORKERS`, `HERMES_MAX_CONCURRENT`,
library paths, whether Plex/webhook are enabled).

## Additional context

Screenshots or anything else that helps.
