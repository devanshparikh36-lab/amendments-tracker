"""Browser-backed fetcher for official sites that refuse plain HTTP clients.

incometaxindia.gov.in and mca.gov.in sit behind Akamai bot protection: scripted requests get 403, a real
browser gets 200. This module drives a real Chromium through Playwright and performs every request *inside the page*
so the site sees an ordinary browser session.

Playwright's sync API can only have one instance alive per thread: once the first one is running, its event loop is
the thread's running loop, and a second `sync_playwright().start()` raises "Sync API inside the asyncio loop". So the
Playwright instance and Chromium are started once, module-wide, and each site gets its own browser context and warm
page off that shared Chromium.

On Linux CI, Chromium must run headed under Xvfb (headless is rejected); `xvfb-run` is applied automatically.
"""
from __future__ import annotations

import json
import logging
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
from typing import Any

log = logging.getLogger(__name__)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"


def ensure_display() -> None:
    """On Linux, start Xvfb once so headed Chromium can run in CI."""
    if platform.system() != "Linux" or os.environ.get("DISPLAY"):
        return
    if not shutil.which("Xvfb"):
        log.warning("Xvfb not installed; headed Chromium may fail")
        return
    subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1366x768x24"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.environ["DISPLAY"] = ":99"
    time.sleep(2)


_pw = None
_browser = None
_engine_lock = threading.Lock()


def _engine():
    """The one Chromium every site shares. Started on first use, relaunched if it has died."""
    global _pw, _browser
    with _engine_lock:
        if _browser is not None and not _browser.is_connected():
            _browser = None
        if _browser is None:
            from playwright.sync_api import sync_playwright

            if _pw is None:
                ensure_display()
                _pw = sync_playwright().start()
            _browser = _pw.chromium.launch(
                headless=False,
                args=["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
            )
            log.info("chromium launched")
        return _browser


def _stop_engine() -> None:
    global _pw, _browser
    with _engine_lock:
        try:
            if _browser is not None:
                _browser.close()
        except Exception:
            pass
        try:
            if _pw is not None:
                _pw.stop()
        except Exception:
            pass
        _pw = _browser = None


class BrowserSession:
    """A single warm browser page anchored on the target site.

    All helpers run in the page's own JavaScript context, so cookies, TLS fingerprint and headers are the browser's.
    Each site gets its own context off the shared Chromium, so one site's cookies never leak into another's.
    """

    def __init__(self, home_url: str, *, delay_seconds: float = 0.4) -> None:
        self.home_url = home_url
        self.delay = delay_seconds
        self._ctx = None
        self._page = None
        self._lock = threading.Lock()
        self._last = 0.0

    # ---------------------------------------------------------------- lifecycle
    def start(self) -> None:
        if self._page is not None:
            return
        self._ctx = _engine().new_context(user_agent=UA, locale="en-IN", viewport={"width": 1366, "height": 768})
        self._page = self._ctx.new_page()
        self._page.goto(self.home_url, wait_until="domcontentloaded", timeout=90_000)
        self._page.wait_for_timeout(2500)
        log.info("browser session ready at %s", self.home_url)

    def close(self) -> None:
        """Drop this site's context only; the shared Chromium stays up for the other sites."""
        try:
            if self._ctx:
                self._ctx.close()
        except Exception:
            pass
        self._ctx = self._page = None

    def __enter__(self) -> "BrowserSession":
        self.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # ---------------------------------------------------------------- requests
    def _throttle(self) -> None:
        wait = self.delay - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def _eval(self, script: str, arg: Any = None, *, retries: int = 2) -> Any:
        self.start()
        with self._lock:
            for attempt in range(retries + 1):
                self._throttle()
                try:
                    return self._page.evaluate(script, arg)
                except Exception as exc:
                    if attempt == retries:
                        raise
                    log.warning("browser call failed (%s), restarting page", type(exc).__name__)
                    try:
                        self._page.goto(self.home_url, wait_until="domcontentloaded", timeout=90_000)
                        self._page.wait_for_timeout(2000)
                    except Exception:
                        self.close()
                        self.start()

    def get_json(self, url: str) -> Any:
        return self._eval(
            """async u => { const r = await fetch(u, {headers:{Accept:'application/json'}});
                 const t = await r.text(); if (!r.ok) throw new Error(r.status + ' for ' + u);
                 return JSON.parse(t); }""",
            url,
        )

    def post_json(self, url: str, body: dict) -> Any:
        return self._eval(
            """async ([u, b]) => { const r = await fetch(u, {method:'POST',
                 headers:{'Content-Type':'application/json','Accept-Language':'en-US'}, body: JSON.stringify(b)});
                 const t = await r.text(); if (!r.ok) throw new Error(r.status + ' for ' + u);
                 return JSON.parse(t); }""",
            [url, body],
        )

    def get_text(self, url: str) -> str:
        return self._eval(
            """async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' for ' + u); return r.text(); }""",
            url,
        )

    def get_bytes(self, url: str) -> tuple[bytes, str | None]:
        """Download a file through the page (base64 across the bridge)."""
        out = self._eval(
            """async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' for ' + u);
                 const b = await r.arrayBuffer(); const bytes = new Uint8Array(b);
                 let s = ''; const chunk = 0x8000;
                 for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                 return {b64: btoa(s), type: r.headers.get('content-type')}; }""",
            url,
        )
        import base64

        return base64.b64decode(out["b64"]), out.get("type")


_sessions: dict[str, BrowserSession] = {}


def session(home_url: str) -> BrowserSession:
    """Shared session per site, reused across adapters within one worker run."""
    key = home_url.split("/")[2]
    if key not in _sessions:
        _sessions[key] = BrowserSession(home_url)
    return _sessions[key]


def close_all() -> None:
    for s in list(_sessions.values()):
        s.close()
    _sessions.clear()
    _stop_engine()
