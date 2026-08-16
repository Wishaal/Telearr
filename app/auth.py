# app/auth.py — bcrypt credentials + signed, expiring, revocable session cookie.
import secrets
import bcrypt as _bcrypt
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from fastapi import Request, HTTPException
from . import db, settings
from .config import SECRET_KEY, DEFAULT_USER, DEFAULT_PASS

MAX_AGE = 7 * 86400   # cookies expire server-side after 7 days
_signer = URLSafeTimedSerializer(SECRET_KEY or secrets.token_hex(32), salt="hermes-session")


def _hash(pw: str) -> str:
    return _bcrypt.hashpw(pw.encode()[:72], _bcrypt.gensalt()).decode()


def _check(pw: str, h: str) -> bool:
    try:
        return _bcrypt.checkpw(pw.encode()[:72], h.encode())
    except Exception:
        return False


def _epoch() -> str:
    # bumped on password change → all previously-issued cookies become invalid
    return str(settings.get("session_epoch", "0"))


def ensure_default_user():
    if not DEFAULT_PASS:
        return
    with db.conn() as c:
        if c.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            return
        c.execute("INSERT INTO users(username, pw_hash) VALUES(?,?)",
                  (DEFAULT_USER, _hash(DEFAULT_PASS)))


def verify(username: str, password: str) -> bool:
    with db.conn() as c:
        r = c.execute("SELECT pw_hash FROM users WHERE username=?", (username,)).fetchone()
    return bool(r) and _check(password, r["pw_hash"])


def set_password(username: str, password: str):
    with db.conn() as c:
        c.execute("UPDATE users SET pw_hash=? WHERE username=?", (_hash(password), username))
    # revoke every existing session
    settings.set("session_epoch", str(int(_epoch() or 0) + 1))


def make_cookie(username: str) -> str:
    return _signer.dumps({"u": username, "e": _epoch()})


def cookie_user(request: Request):
    tok = request.cookies.get("hermes_sess")
    if not tok:
        return None
    try:
        data = _signer.loads(tok, max_age=MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    if str(data.get("e")) != _epoch():   # revoked by a password change
        return None
    return data.get("u")


def require_user(request: Request):
    u = cookie_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    return u
