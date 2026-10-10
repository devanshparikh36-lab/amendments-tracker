"""The free-tier watch, and in particular the compute half of it.

Compute is the one allowance that cannot be measured from inside Postgres, so it is read from Neon's API --
which means the field names, the unit conversion and the unconfigured path are all things that can be wrong
without anything noticing. A watch that silently reports healthy is the failure it exists to prevent, so each
of those is pinned here.
"""
from __future__ import annotations

from dataclasses import replace

from amendments.storage import usage


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def json(self) -> dict:
        return self._payload


def _configure(monkeypatch, *, key="neon_api_key_test", project="proj-123"):
    """`Settings` is a frozen dataclass, so swap the whole instance rather than one attribute."""
    monkeypatch.setattr(
        usage, "settings", replace(usage.settings, neon_api_key=key, neon_project_id=project)
    )


def test_compute_usage_is_none_until_configured(monkeypatch):
    """No key means "not watched", never "0% used" -- the latter reads as healthy."""
    _configure(monkeypatch, key=None, project=None)
    assert usage.compute_usage() is None


def test_compute_usage_converts_cu_seconds_to_cu_hours(monkeypatch):
    _configure(monkeypatch)
    # 180,000 CU-seconds is 50 CU-hours, half of the 100 the free plan allows.
    monkeypatch.setattr(
        usage.http, "get",
        lambda url, **kw: _FakeResponse({"project": {"compute_time_seconds": 180_000, "active_time_seconds": 360_000}}),
    )
    u = usage.compute_usage()
    assert u is not None
    assert u.used == 50.0
    assert u.limit == usage.NEON_FREE_CU_HOURS == 100
    assert u.fraction == 0.5
    assert u.unit == "CU-hours"
    # active_time is wall clock, so 360,000 s is 100 hours awake at an average of 0.5 CU.
    assert "100 h awake" in u.detail
    assert "50.0 of 100 CU-hours (50%)" in u.human()


def test_compute_usage_reports_the_url_it_reads(monkeypatch):
    """Guards the endpoint and the auth header, which are the parts a Neon API change would break."""
    _configure(monkeypatch)
    seen: dict = {}

    def fake_get(url, **kw):
        seen["url"] = url
        seen["headers"] = kw.get("headers") or {}
        return _FakeResponse({"project": {"compute_time_seconds": 0, "active_time_seconds": 0}})

    monkeypatch.setattr(usage.http, "get", fake_get)
    usage.compute_usage()
    assert seen["url"] == "https://console.neon.tech/api/v2/projects/proj-123"
    assert seen["headers"]["Authorization"] == "Bearer neon_api_key_test"


def test_compute_usage_survives_the_api_being_unreachable(monkeypatch):
    """Neon's console being down must not turn the watch red -- red there means an allowance is filling up."""
    _configure(monkeypatch)

    def boom(url, **kw):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(usage.http, "get", boom)
    assert usage.compute_usage() is None


def test_compute_usage_tolerates_missing_fields(monkeypatch):
    """An empty or reshaped payload reads as zero rather than raising mid-check."""
    _configure(monkeypatch)
    monkeypatch.setattr(usage.http, "get", lambda url, **kw: _FakeResponse({}))
    u = usage.compute_usage()
    assert u is not None and u.used == 0.0
    assert u.detail == "nothing recorded yet"


def test_compute_never_arms_retention():
    """The guard that matters.

    Retention deletes documents off the largest reported fraction, and its trigger is 70%. Compute at 95%
    must not reach that calculation: deleting documents would not return one CU-hour, so arming retention on
    compute would destroy the library to fix something deletion cannot touch.
    """
    storage_u = usage.Usage("Neon storage", 100 * 1024**2, usage.NEON_FREE_BYTES, "")
    compute_u = usage.Usage("Neon compute", 95, 100, "", unit="CU-hours", frees_by_deleting=False)

    assert compute_u.fraction == 0.95
    assert compute_u.frees_by_deleting is False
    assert storage_u.frees_by_deleting is True

    # Exactly the expression pipeline.retain_documents uses.
    pressure = max((u.fraction for u in [storage_u, compute_u] if u.frees_by_deleting), default=0.0)
    assert pressure == storage_u.fraction < 0.70


def test_bytes_still_format_as_bytes():
    """The unit field is new; the storage lines must read exactly as they did."""
    assert "0.49 GB of 10 GB (5%)" in usage.Usage("Cloudflare R2", 500 * 1024**2, usage.R2_FREE_BYTES, "").human()
    assert "250.00 MB of 500 MB (50%)" in usage.Usage("Neon storage", 250 * 1024**2, usage.NEON_FREE_BYTES, "").human()
