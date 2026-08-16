"""Shared test setup for Telearr.

CRITICAL: ``app.config`` reads environment variables *at import time* and calls
``os.makedirs(DATA_DIR)`` where ``DATA_DIR`` defaults to ``/data`` (not writable
in dev/CI). So we MUST point the data/log dirs at a writable temp location and
set a secret key BEFORE any ``app.*`` module is imported. This runs at module
import (collection) time, which is before test modules import ``app.*``.
"""
import os
import tempfile

# A process-wide temp dir for the whole test session. Created here (not via the
# tmp_path fixture) because config is imported at collection time, earlier than
# any fixture can run.
_TEST_DATA_DIR = tempfile.mkdtemp(prefix="telearr-tests-")

os.environ.setdefault("TELEARR_DATA_DIR", _TEST_DATA_DIR)
os.environ.setdefault("TELEARR_LOG_DIR", os.path.join(_TEST_DATA_DIR, "logs"))
os.environ.setdefault("TELEARR_SECRET_KEY", "test-secret-key-not-for-production")

import pytest


@pytest.fixture()
def fresh_db(tmp_path, monkeypatch):
    """Give a test an isolated, initialised SQLite database.

    Rebinds ``DB_PATH`` in the config and db modules to a fresh file under the
    per-test ``tmp_path`` and (re)creates the schema. Keeps settings/auth tests
    from bleeding state into each other.
    """
    from app import config, db

    dbfile = str(tmp_path / "telearr.db")
    monkeypatch.setattr(config, "DB_PATH", dbfile, raising=False)
    monkeypatch.setattr(db, "DB_PATH", dbfile, raising=False)
    db.init()
    return dbfile
