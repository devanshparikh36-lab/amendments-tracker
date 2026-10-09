"""Polite HTTP client shared by all adapters: real user-agent, delay between requests, retries."""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import ssl
import time
from pathlib import Path

import certifi
import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .config import settings

log = logging.getLogger(__name__)

_last_request_at = 0.0

# Intermediate CA certificates some official sites omit from their TLS chain (taxinformation.cbic.gov.in sends only
# its leaf, issued by Sectigo OV R36). Browsers fetch the missing issuer via AIA; we bundle it so verification stays on.
_CERTS_DIR = Path(__file__).resolve().parent / "certs"
_ssl_context: ssl.SSLContext | None = None


def ssl_context() -> ssl.SSLContext:
    global _ssl_context
    if _ssl_context is None:
        ctx = ssl.create_default_context(cafile=certifi.where())
        for pem in sorted(_CERTS_DIR.glob("*.pem")) if _CERTS_DIR.is_dir() else []:
            try:
                ctx.load_verify_locations(cafile=str(pem))
            except ssl.SSLError as exc:
                log.warning("could not load extra CA certificate %s: %s", pem.name, exc)
        _ssl_context = ctx
    return _ssl_context


def _throttle() -> None:
    global _last_request_at
    wait = settings.request_delay_seconds - (time.monotonic() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.monotonic()


def timeout_for(read_seconds: float | None = None) -> httpx.Timeout:
    """Connect fast, read patiently.

    One scalar timeout applies the same number to connect, read, write and pool, which is the wrong shape for
    these sites. Connecting to a regulator either works in a couple of seconds or is not going to; *reading*
    a consolidated SEBI Regulation runs to a few megabytes over a link that is frequently slow, and 60
    seconds is not always enough for it. The two failures are not alike and should not share a budget.

    This is the direct cause of the self-check backlog: 397 `selfcheck_instrument` jobs failed with the bare
    message "timed out", which is what `str(httpx.ReadTimeout)` gives you. They were not broken sources --
    they were large official PDFs that needed longer than one minute to arrive.
    """
    base = settings.request_timeout_seconds
    return httpx.Timeout(
        connect=min(20.0, base),
        read=read_seconds or base,
        write=base,
        pool=base,
    )


def client(*, read_seconds: float | None = None) -> httpx.Client:
    return httpx.Client(
        headers={
            "User-Agent": settings.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8",
            "Accept-Language": "en-IN,en;q=0.9",
        },
        timeout=timeout_for(read_seconds),
        follow_redirects=True,
        verify=ssl_context(),
    )


class RetryableHTTPError(Exception):
    pass


# How long a file download may take to arrive, as opposed to a listing or detail page.
#
# Four minutes, against the one minute a page gets. The files this matters for are the regulators' own
# consolidated texts -- SEBI publishes LODR as a 230-page PDF -- and they are fetched once per refresh, not
# per request, so waiting is cheap and failing is not: a timeout here aborts the whole self-check and the
# instrument keeps serving older text.
LARGE_FILE_READ_SECONDS = 240.0


@retry(
    retry=retry_if_exception_type((RetryableHTTPError, httpx.TransportError)),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=2, max=30),
    reraise=True,
)
def get(url: str, *, http: httpx.Client | None = None, read_seconds: float | None = None, **kwargs) -> httpx.Response:
    _throttle()
    own = http is None
    http = http or client(read_seconds=read_seconds)
    try:
        resp = http.get(url, **kwargs)
    except httpx.TimeoutException as exc:
        # str(httpx.ReadTimeout) is the single word "timed out", which told nobody anything: 397 self-check
        # jobs failed carrying exactly that and the URL had to be guessed. Name the target and the budget.
        kind = type(exc).__name__
        raise RetryableHTTPError(
            f"{kind} after {read_seconds or settings.request_timeout_seconds:.0f}s fetching {url}"
        ) from exc
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


def unwrap_base64_envelope(content: bytes, content_type: str | None) -> tuple[bytes, str | None] | None:
    """CBIC's taxinformation portal serves files as JSON {"data": <base64>, "fileName": ...}. Return the decoded
    bytes (and a guessed content type) when `content` is such an envelope, else None."""
    if not content_type or "json" not in content_type.lower() or not content.lstrip().startswith(b"{"):
        return None
    try:
        obj = json.loads(content)
    except ValueError:
        return None
    if not isinstance(obj, dict) or not isinstance(obj.get("data"), str) or not obj["data"]:
        return None
    try:
        data = base64.b64decode(obj["data"], validate=False)
    except ValueError:
        return None
    name = str(obj.get("fileName") or "").lower()
    ctype = "application/pdf" if data.startswith(b"%PDF") or name.endswith(".pdf") else None
    return data, ctype


def get_bytes(url: str, **kwargs) -> tuple[bytes, str | None]:
    """Return (content, content-type). Base64 JSON envelopes (taxinformation.cbic.gov.in `content/pdf/...`) are decoded.

    Every caller of this is downloading a file rather than reading a page, so the patient read budget is the
    default here and the short one stays the default for `get` / `get_text`. Pass `read_seconds` to override.
    """
    kwargs.setdefault("read_seconds", LARGE_FILE_READ_SECONDS)
    resp = get(url, **kwargs)
    unwrapped = unwrap_base64_envelope(resp.content, resp.headers.get("content-type"))
    if unwrapped is not None:
        return unwrapped
    return resp.content, resp.headers.get("content-type")


def sha256(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()
