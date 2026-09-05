"""Daily digest email via Resend."""
from __future__ import annotations

import html
import logging
from datetime import date

from ..config import settings

log = logging.getLogger(__name__)


def _row(cells: list[str]) -> str:
    return "<tr>" + "".join(f"<td style='padding:4px 8px;border-bottom:1px solid #eee'>{c}</td>" for c in cells) + "</tr>"


def build_digest_html(
    new_docs: list[dict],
    merges: list[dict],
    cannot_apply: list[dict],
    discrepancies: list[dict],
    failures: list[dict],
    site_url: str,
    day: date,
) -> str:
    parts = [f"<h2>Regulation Tracker digest for {day.isoformat()}</h2>"]

    parts.append(f"<h3>New documents ({len(new_docs)})</h3>")
    if new_docs:
        rows = [
            _row(
                [
                    str(d.get("date_issued") or ""),
                    html.escape(d.get("regulator_code", "")),
                    html.escape(d.get("number") or ""),
                    f"<a href='{site_url}/documents/{d['id']}'>{html.escape(d['title'])}</a>",
                ]
            )
            for d in new_docs
        ]
        parts.append("<table style='border-collapse:collapse'>" + "".join(rows) + "</table>")
    else:
        parts.append("<p>None.</p>")

    parts.append(f"<h3>Machine merges applied ({len(merges)})</h3>")
    parts.append(
        "<ul>" + "".join(f"<li>{html.escape(m['instrument_title'])} {html.escape(m['provision_number'])} "
                          f"({html.escape(m['change_type'])}) from <a href='{site_url}/documents/{m['document_id']}'>"
                          f"{html.escape(m['document_title'])}</a></li>" for m in merges) + "</ul>"
        if merges else "<p>None.</p>"
    )

    parts.append(f"<h3>Amendments that could not be applied automatically ({len(cannot_apply)})</h3>")
    parts.append(
        "<ul>" + "".join(f"<li>{html.escape(m['instrument_title'])} {html.escape(m['provision_number'])}: "
                          f"{html.escape(m.get('ai_note') or '')} - <a href='{site_url}/documents/{m['document_id']}'>source</a></li>"
                          for m in cannot_apply) + "</ul>"
        if cannot_apply else "<p>None.</p>"
    )

    parts.append(f"<h3>Official text differed from machine merge ({len(discrepancies)})</h3>")
    parts.append(
        "<ul>" + "".join(f"<li>{html.escape(m['instrument_title'])} {html.escape(m['provision_number'])}</li>" for m in discrepancies) + "</ul>"
        if discrepancies else "<p>None.</p>"
    )

    parts.append(f"<h3>Adapter failures ({len(failures)})</h3>")
    parts.append(
        "<ul>" + "".join(f"<li>{html.escape(f['adapter'])}: {html.escape((f.get('error') or '')[:300])}</li>" for f in failures) + "</ul>"
        if failures else "<p>None.</p>"
    )
    parts.append(f"<p><a href='{site_url}'>Open the tracker</a></p>")
    return "\n".join(parts)


def send_digest(subject: str, body_html: str) -> bool:
    if not settings.resend_api_key or not settings.digest_to:
        log.info("RESEND_API_KEY / DIGEST_TO not set; skipping digest email")
        return False
    try:
        import resend

        resend.api_key = settings.resend_api_key
        resend.Emails.send({"from": settings.digest_from, "to": settings.digest_to, "subject": subject, "html": body_html})
        return True
    except Exception as exc:
        log.error("Resend failed: %s", exc)
        return False
