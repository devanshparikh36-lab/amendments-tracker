"""Watch how much of the free tiers we are using, and warn before either runs out.

Two limits matter:
  * Cloudflare R2  - 10 GB stored free, then about $0.015 per GB per month.
  * Neon Postgres  - 500 MB on the free plan; past that, writes stop until the plan is upgraded.

Neon is the tighter of the two because it holds the extracted text of every document and file.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from .. import db
from ..config import settings
from .files import storage

log = logging.getLogger(__name__)

R2_FREE_BYTES = 10 * 1024**3          # 10 GB
NEON_FREE_BYTES = 500 * 1024**2       # 500 MB
# Warn at 60% rather than 75%. Getting back under a limit means reclaiming space and redeploying, which takes a
# session; by 75% of Neon there is little room left to be calm about it, and past 100% the free plan stops
# accepting writes and collection halts outright.
WARN_AT = 0.60
CRITICAL_AT = 0.90


@dataclass
class Usage:
    label: str
    used_bytes: int
    limit_bytes: int
    detail: str = ""

    @property
    def fraction(self) -> float:
        return self.used_bytes / self.limit_bytes if self.limit_bytes else 0.0

    @property
    def level(self) -> str:
        if self.fraction >= CRITICAL_AT:
            return "critical"
        return "warning" if self.fraction >= WARN_AT else "ok"

    def human(self) -> str:
        used = self.used_bytes / 1024**3
        limit = self.limit_bytes / 1024**3
        unit = "GB"
        if limit < 1:
            used, limit, unit = self.used_bytes / 1024**2, self.limit_bytes / 1024**2, "MB"
        return f"{self.label}: {used:.2f} {unit} of {limit:.0f} {unit} ({self.fraction * 100:.0f}%)"


def object_storage_usage() -> Usage:
    """Bytes held in R2, from what the pipeline recorded plus the official PDFs."""
    with db.transaction() as conn:
        row = db.fetch_one(
            conn,
            "SELECT coalesce(sum(size_bytes), 0)::bigint AS n, count(*) AS files FROM attachment WHERE storage_key IS NOT NULL",
        )
    return Usage("Cloudflare R2", int(row["n"]), R2_FREE_BYTES, f"{row['files']} files")


def database_usage() -> Usage:
    with db.transaction() as conn:
        row = db.fetch_one(conn, "SELECT pg_database_size(current_database())::bigint AS n")
        docs = db.fetch_one(conn, "SELECT count(*) AS n FROM document")
    return Usage("Neon database", int(row["n"]), NEON_FREE_BYTES, f"{docs['n']} documents")


def check(*, notify: bool = True) -> list[Usage]:
    """Report both limits, and raise an alert when either passes the warning threshold."""
    usages = [object_storage_usage(), database_usage()]
    for u in usages:
        log.info("%s - %s", u.human(), u.detail)
    at_risk = [u for u in usages if u.level != "ok"]
    if at_risk and notify:
        from ..notify import teams

        worst = max(at_risk, key=lambda u: u.fraction)
        headline = "Storage almost full" if worst.level == "critical" else "Storage filling up"
        teams.send_teams(
            f"{headline}: {worst.label}",
            [(u.label, f"{u.human()} - {u.detail}") for u in usages],
            settings.site_url + "/status",
            "Cloudflare R2 costs about $0.015 per GB per month beyond the free 10 GB. Neon's free plan stops "
            "accepting writes at 500 MB; the next plan is $19 a month. Raising either is a paid change, so this "
            "is a heads-up rather than something the pipeline will do on its own.",
        )
    return usages
