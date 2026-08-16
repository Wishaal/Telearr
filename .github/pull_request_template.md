## Summary

<!-- What does this PR do and why? Keep it focused on one logical change. -->

## Related issue

<!-- e.g. Closes #123 -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor / performance
- [ ] CI / tooling / chore

## Changes

<!-- Bullet the notable changes. -->

-

## Testing

<!-- How did you verify this? -->

- [ ] `python -m pytest -q` passes
- [ ] `ruff check app` passes
- [ ] Added/updated tests for the change
- [ ] Manually verified (describe below)

<!-- Manual test notes: -->

## Checklist

- [ ] Branch is off `main` and named with a type prefix (e.g. `feat/…`, `fix/…`)
- [ ] Commits follow Conventional Commits
- [ ] Updated docs (`README.md` / `docs/`) where behavior or setup changed
- [ ] Added a `CHANGELOG.md` entry for user-visible changes
- [ ] Did not raise uvicorn `--workers` above 1 (single-worker scanner invariant)
- [ ] No secrets committed; `.env` untouched

## Screenshots (if UI)

<!-- Before/after screenshots for UI changes. -->
