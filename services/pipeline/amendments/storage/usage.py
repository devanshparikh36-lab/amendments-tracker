"""Watch how much of the free tiers we are using, and warn before any of them runs out.

Three limits matter:
  * Cloudflare R2  - 10 GB stored free, then about $0.015 per GB per month.
  * Neon storage   - 500 MB on the free plan; past that, writes stop until the plan is upgraded.
  * Neon compute   - 100 CU-hours a month on the free plan; past that, the compute is suspended.

Compute was added late, and its absence was the more dangerous gap. Storage fills slowly and visibly; compute
was being spent continuously by a keep-warm ping timed to defeat Neon's five-minute idle suspend, and nothing
here measured it. Two of the three are bytes and one is hours, which is why `Usage` carries a unit.
"""
from __future__ import annotations

import logging
import os as _os
from dataclasses import dataclass

from .. import db, http
from ..config import settings
from .files import storage

log = logging.getLogger(__name__)

R2_FREE_BYTES = 10 * 1024**3          # 10 GB
NEON_FREE_BYTES = 500 * 1024**2       # 500 MB
# Neon's free plan allows 100 CU-hours per project per month. A CU-hour is one compute unit running for an
# hour; the floor is 0.25 CU, so an instance that never sleeps spends about 182 CU-hours in a 730-hour month
# -- nearly twice the allowance. That arithmetic is the whole reason this metric is now watched.
NEON_FREE_CU_HOURS = float(_os.environ.get("NEON_FREE_CU_HOURS") or 100)
# Warn at 60% rather than 75%. Getting back under a limit means reclaiming space and redeploying, which takes a
# session; by 75% of Neon there is little room left to be calm about it, and past 100% the free plan stops
# accepting writes and collection halts outright.
WARN_AT = float(_os.environ.get("STORAGE_WARN_AT") or 0.60)
CRITICAL_AT = float(_os.environ.get("STORAGE_CRITICAL_AT") or 0.90)


@dataclass
class Usage:
    label: str
    used: float
    limit: float
    detail: str = ""
    # Bytes unless stated otherwise. Compute is measured in CU-hours, which must not be formatted as though
    # they were bytes -- "0.00 MB of 0 MB" is what that looks like, and it reads as healthy.
    unit: str = "bytes"
    # Retention reclaims room by deleting documents (`prune_before_cutoff`), and it arms itself off the
    # largest fraction reported here. Deleting documents frees bytes; it does nothing at all for compute
    # hours. So compute must be excluded from that decision, or running low on compute would start
    # destroying the library to fix something deletion cannot fix. See pipeline.retain_documents.
    frees_by_deleting: bool = True

    @property
    def fraction(self) -> float:
        return self.used / self.limit if self.limit else 0.0

    @property
    def level(self) -> str:
        if self.fraction >= CRITICAL_AT:
            return "critical"
        return "warning" if self.fraction >= WARN_AT else "ok"

    def human(self) -> str:
        if self.unit != "bytes":
            return f"{self.label}: {self.used:.1f} of {self.limit:.0f} {self.unit} ({self.fraction * 100:.0f}%)"
        used = self.used / 1024**3
        limit = self.limit / 1024**3
        unit = "GB"
        if limit < 1:
            used, limit, unit = self.used / 1024**2, self.limit / 1024**2, "MB"
        return f"{self.label}: {used:.2f} {unit} of {limit:.0f} {unit} ({self.fraction * 100:.0f}%)"


def _recorded_object_usage() -> Usage:
    """Fallback: what the database says was stored. Undercounts — see object_storage_usage."""
    with db.transaction() as conn:
        row = db.fetch_one(
            conn,
            "SELECT coalesce(sum(size_bytes), 0)::bigint AS n, count(*) AS files FROM attachment WHERE storage_key IS NOT NULL",
        )
    return Usage("Cloudflare R2", int(row["n"]), R2_FREE_BYTES, f"{row['files']} files (recorded, not counted)")


def object_storage_usage() -> Usage:
    """Bytes actually held in R2, counted by listing the bucket.

    This used to sum `attachment.size_bytes`, which silently misses anything written by a path that does not
    create an attachment row. The official instrument PDFs are one such path: `_store_official_pdf` writes them
    under `official/` against `instrument.pdf_storage_key`, and they were invisible here — 139 objects and
    0.107 GB of a real 3.445 GB bucket, so the alarm read 33% where the truth was 34%. Small today, but it is
    the share that grows every time an instrument is re-seeded, and an alarm that measures a subset of what is
    billed will always fire late.

    Listing costs one Class B operation per 1,000 objects, a handful a day against a 10-million monthly free
    allowance. If the bucket cannot be reached the recorded sum is used instead, labelled so the difference is
    visible rather than silently wrong.
    """
    store = storage()
    if not store.remote:
        return _recorded_object_usage()
    try:
        total = objects = 0
        for page in store._s3.get_paginator("list_objects_v2").paginate(Bucket=settings.r2_bucket):
            for obj in page.get("Contents", []):
                total += obj["Size"]
                objects += 1
        return Usage("Cloudflare R2", total, R2_FREE_BYTES, f"{objects} objects")
    except Exception as exc:
        log.warning("could not list the R2 bucket (%s); using the recorded sizes, which undercount", str(exc)[:120])
        return _recorded_object_usage()


def database_usage() -> Usage:
    with db.transaction() as conn:
        row = db.fetch_one(conn, "SELECT pg_database_size(current_database())::bigint AS n")
        docs = db.fetch_one(conn, "SELECT count(*) AS n FROM document")
    return Usage("Neon storage", int(row["n"]), NEON_FREE_BYTES, f"{docs['n']} documents")


def compute_usage() -> Usage | None:
    """CU-hours spent this billing period, read from Neon's own API.

    This is the limit that was being approached while nothing watched it. Storage can be measured from inside
    Postgres, so it always was; compute cannot, because CU-hours are a billing metric the database knows
    nothing about. Measuring it needs a key, so it was simply left unmeasured -- and `keepwarm` was pinging
    every five minutes, the exact interval that defeats Neon's five-minute idle suspend, which keeps the
    compute up more or less continuously. The first sign would have been writes stopping.

    `compute_time_seconds` is CU-seconds for the current billing period: running time weighted by compute
    size, which is what the plan is counted against. Divided by 3600 those are CU-hours.
    (`active_time_seconds` is the same clock unweighted, so it undercounts anything running above 1 CU; it is
    reported alongside only because "how many hours was it actually awake" is the number that explains the
    first one.)

    Returns None when no key is configured, rather than zero. A watch that cannot see has to say so: zero
    would render as "0.0 of 100 CU-hours (0%)", which reads as healthy and is the failure this exists to end.
    """
    key, project = settings.neon_api_key, settings.neon_project_id
    if not (key and project):
        log.info("NEON_API_KEY / NEON_PROJECT_ID are not set, so compute is not being watched")
        return None
    try:
        resp = http.get(
            f"https://console.neon.tech/api/v2/projects/{project}",
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
        )
        row = (resp.json() or {}).get("project") or {}
        cu_hours = float(row.get("compute_time_seconds") or 0) / 3600
        awake_hours = float(row.get("active_time_seconds") or 0) / 3600
    except Exception as exc:
        # Never fatal. This runs beside the storage checks, and Neon's console being unreachable must not
        # stop them reporting -- nor turn the workflow red, which would say "storage is filling up".
        log.warning("could not read Neon compute usage (%s)", str(exc)[:160])
        return None
    detail = f"{awake_hours:.0f} h awake this period" if awake_hours else "nothing recorded yet"
    return Usage(
        "Neon compute", cu_hours, NEON_FREE_CU_HOURS, detail,
        unit="CU-hours", frees_by_deleting=False,
    )


WHY_IT_MATTERS = (
    "Cloudflare R2 costs about $0.015 per GB per month beyond the free 10 GB. Neon's free plan stops "
    "accepting writes at 500 MB of storage, and suspends the compute after 100 CU-hours in a month; the "
    "next plan is $19 a month. Raising any of them is a paid change, so this is a heads-up rather than "
    "something the pipeline will do on its own. Storage is relieved by holding fewer documents; compute is "
    "relieved by querying less often, which is a matter of what is scheduled, not of what is stored."
)


def check(*, notify: bool = True) -> list[Usage]:
    """Report both limits, and raise an alert on every configured channel when either passes 60%.

    Sends to Teams *and* email rather than one or the other, because each has a way of being unavailable: the
    Teams webhook has never been set, and the GitHub-workflow-failure route -- which is what actually delivers
    this today -- cannot run while the Actions allowance is exhausted. An alarm nobody receives is the failure
    mode this whole check exists to prevent, so it takes every path it has.
    """
    # Compute is appended only when it could be read, so an unconfigured key leaves the list exactly as it
    # was rather than adding a line that always says 0%.
    usages = [object_storage_usage(), database_usage()]
    compute = compute_usage()
    if compute is not None:
        usages.append(compute)
    for u in usages:
        log.info("%s - %s", u.human(), u.detail)
    at_risk = [u for u in usages if u.level != "ok"]
    if not (at_risk and notify):
        return usages

    from ..notify import email as email_notify
    from ..notify import teams

    worst = max(at_risk, key=lambda u: u.fraction)
    headline = "Storage almost full" if worst.level == "critical" else "Storage filling up"
    subject = f"{headline}: {worst.label}"
    rows = [(u.label, f"{u.human()} - {u.detail}") for u in usages]

    sent_teams = teams.send_teams(subject, rows, settings.site_url + "/status", WHY_IT_MATTERS)
    body = (
        f"<h2>{subject}</h2><ul>"
        + "".join(f"<li><b>{label}</b>: {detail}</li>" for label, detail in rows)
        + f"</ul><p>{WHY_IT_MATTERS}</p><p><a href='{settings.site_url}/status'>Status page</a></p>"
    )
    sent_email = email_notify.send_digest(subject, body)
    if not (sent_teams or sent_email):
        log.warning("%s - but no alert channel is configured, so nobody was told", subject)
    return usages
