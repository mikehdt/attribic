"""Tests for the loopback-origin check that gates WebSocket upgrades and
mutating HTTP requests (`main._is_allowed_origin`).

This used to be a fixed allow-list of exactly ("http://localhost:3000",
"http://127.0.0.1:3000"), which broke silently whenever `next dev` moved off
3000 (it auto-increments when the port's taken) or the sidecar was reconnected
to as an orphan by a Node process on a different port — every WebSocket
upgrade got rejected with code 4403 and progress just stopped updating, with
no visible error. See the comment above `_LOOPBACK_ORIGIN_RE` in main.py for
the full reasoning behind matching any loopback port instead of a fixed one.
"""

import main


def test_accepts_localhost_on_any_port():
    assert main._is_allowed_origin("http://localhost:3000") is True
    # The actual bug this fixes: next dev moving off the default port.
    assert main._is_allowed_origin("http://localhost:3001") is True
    assert main._is_allowed_origin("http://localhost:51234") is True


def test_accepts_127_0_0_1_on_any_port():
    assert main._is_allowed_origin("http://127.0.0.1:3000") is True
    assert main._is_allowed_origin("http://127.0.0.1:8080") is True


def test_rejects_non_loopback_hosts():
    # A remote page can't forge this — the browser sets Origin to the
    # requesting page's own origin — but the check must still reject it.
    assert main._is_allowed_origin("http://evil.example.com:3000") is False
    assert main._is_allowed_origin("http://192.168.1.5:3000") is False
    # Bare hostname that merely contains "localhost" shouldn't slip through.
    assert main._is_allowed_origin("http://notlocalhost:3000") is False
    assert main._is_allowed_origin("http://localhost.evil.com:3000") is False


def test_rejects_https_and_missing_port():
    # The app is plain http in dev; a scheme/shape mismatch should not match.
    assert main._is_allowed_origin("https://localhost:3000") is False
    assert main._is_allowed_origin("http://localhost") is False


def test_rejects_malformed_origin():
    assert main._is_allowed_origin("") is False
    assert main._is_allowed_origin("null") is False
