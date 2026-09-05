"""Polite HTTP client shared by all adapters: real user-agent, delay between requests, retries."""
from __future__ import annotations

import hashlib
import logging
import time

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .config import settings

log = logging.getLogger(__name__)

_last_request_at = 0.0


def _throttle() -> None:
    global _last_request_at
    wait = settings.request_delay_seconds - (time.monotonic() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.monotonic()


def client() -> httpx.Client:
    return httpx.Client(
        headers={
            "User-Agent": settings.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
            "Accept-Language": "en-IN,en;q=0.9",
        },
        timeout=settings.request_timeout_seconds,
        follow_redirects=True,
    )


class RetryableHTTPError(Exception):
    pass


@retry(
    retry=retry_if_exception_type((RetryableHTTPError, httpx.TransportError)),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    reraise=True,
)
def get(url: str, *, http: httpx.Client | None = None, **kwargs) -> httpx.Response:
    _throttle()
    own = http is None
    http = http or client()
    try:
        resp = http.get(url, **kwargs)
    finally:
        if own:
            http.close()
    if resp.status_code in (429, 500, 502, 503, 504):
        raise RetryableHTTPError(f"{resp.status_code} for {url}")
    resp.raise_for_status()
    return resp


@retry(
    retry=retry_if_exception_type((RetryableHTTPError, httpx.TransportError)),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    reraise=True,
)
def post(url: str, data: dict, *, http: httpx.Client | None = None, **kwargs) -> httpx.Response:
    _throttle()
    own = http is None
    http = http or client()
    try:
        resp = http.post(url, data=data, **kwargs)
    finally:
        if own:
            http.close()
    if resp.status_code in (429, 500, 502, 503, 504):
        raise RetryableHTTPError(f"{resp.status_code} for {url}")
    resp.raise_for_status()
    return resp


def get_text(url: str, **kwargs) -> str:
    resp = get(url, **kwargs)
    resp.encoding = resp.encoding or "utf-8"
    return resp.text


def get_bytes(url: str, **kwargs) -> tuple[bytes, str | None]:
    """Return (content, content-type)."""
    resp = get(url, **kwargs)
    return resp.content, resp.headers.get("content-type")


def sha256(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()
