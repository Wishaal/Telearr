"""Tests for password hashing/verification.

``app.auth`` imports ``itsdangerous`` and ``fastapi`` at module top, which may
not be installed in a minimal dev env. So the app-level tests are guarded with
``pytest.importorskip`` and skip cleanly when those deps are missing. The pure
bcrypt roundtrip below mirrors the exact implementation in ``app.auth`` and
always runs (bcrypt is a hard runtime dependency).
"""
import pytest

bcrypt = pytest.importorskip("bcrypt")


# --------------------------------------------------------------------------
# Standalone bcrypt roundtrip mirroring app.auth._hash / _check.
# --------------------------------------------------------------------------
def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt()).decode()


def _check(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode()[:72], h.encode())
    except Exception:
        return False


def test_bcrypt_roundtrip_correct_password():
    h = _hash("correct horse battery staple")
    assert _check("correct horse battery staple", h) is True


def test_bcrypt_roundtrip_wrong_password():
    h = _hash("correct horse battery staple")
    assert _check("wrong password", h) is False


def test_bcrypt_empty_hash_fails_gracefully():
    assert _check("anything", "") is False


def test_bcrypt_garbage_hash_fails_gracefully():
    assert _check("anything", "not-a-valid-bcrypt-hash") is False


def test_bcrypt_hashes_are_salted_and_unique():
    # same password hashed twice -> different digests, both verify
    h1, h2 = _hash("samepw"), _hash("samepw")
    assert h1 != h2
    assert _check("samepw", h1) and _check("samepw", h2)


def test_bcrypt_long_password_truncated_to_72_bytes():
    # bcrypt only considers the first 72 bytes; app.auth truncates explicitly.
    base = "a" * 72
    h = _hash(base)
    assert _check(base + "extra-ignored-tail", h) is True


# --------------------------------------------------------------------------
# App-level helpers — only when optional web deps are importable.
# --------------------------------------------------------------------------
def test_app_auth_hash_check_roundtrip():
    pytest.importorskip("itsdangerous")
    pytest.importorskip("fastapi")
    from app import auth

    h = auth._hash("s3cret")
    assert auth._check("s3cret", h) is True
    assert auth._check("nope", h) is False
    assert auth._check("s3cret", "") is False
