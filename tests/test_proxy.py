"""Proxy URL parsing for the Telegram client (SOCKS/HTTP/MTProxy)."""
import pytest

pytest.importorskip("telethon")


def _kwargs(url, monkeypatch):
    from app import tg
    monkeypatch.setattr(tg.settings, "get", lambda k, d="": url if k == "tg_proxy" else d)
    return tg._build_proxy_kwargs()


def test_no_proxy(monkeypatch):
    assert _kwargs("", monkeypatch) == {}


def test_socks5_with_creds(monkeypatch):
    kw = _kwargs("socks5://bob:pw@1.2.3.4:1080", monkeypatch)
    p = kw["proxy"]
    assert p["proxy_type"] == "socks5" and p["addr"] == "1.2.3.4" and p["port"] == 1080
    assert p["username"] == "bob" and p["password"] == "pw"


def test_http_no_creds(monkeypatch):
    kw = _kwargs("http://proxy.local:8080", monkeypatch)
    assert kw["proxy"]["proxy_type"] == "http" and kw["proxy"]["port"] == 8080
    assert "username" not in kw["proxy"]


def test_mtproxy(monkeypatch):
    kw = _kwargs("mtproxy://deadbeef@mt.example.com:443", monkeypatch)
    assert kw["proxy"] == ("mt.example.com", 443, "deadbeef")
    assert "connection" in kw


def test_bad_url_degrades_to_direct(monkeypatch):
    assert _kwargs("socks5://missing-port", monkeypatch) == {}
    assert _kwargs("garbage", monkeypatch) == {}


def test_proxy_display_strips_creds(monkeypatch):
    from app import tg
    monkeypatch.setattr(tg.settings, "get", lambda k, d="": "socks5://bob:secret@1.2.3.4:1080" if k == "tg_proxy" else d)
    d = tg.proxy_display()
    assert "secret" not in d and "1.2.3.4:1080" in d
