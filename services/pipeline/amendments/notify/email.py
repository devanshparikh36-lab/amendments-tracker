"""Daily digest email via Resend.

Written for mail clients, which is a narrower medium than it looks. Every style is inline, because Gmail
strips a <style> block in some views and Outlook in others; layout is tables, because Outlook renders through
Word and does not do flex or grid; widths are fixed at 600px, the figure every client and phone handles
without side-scrolling. None of that is how the website is built, and it is not a mistake that they differ.
"""
from __future__ import annotations

import html
import logging
from datetime import date

from ..config import settings

log = logging.getLogger(__name__)

# Full names for the codes stored against each document. A digest is read at a glance and half-awake; "CBIC"
# is what a practitioner recognises, the expansion is there for everyone else.
REGULATOR_NAMES = {
    "CBDT": "Income tax",
    "CBIC": "GST &amp; customs",
    "MCA": "Companies",
    "RBI": "FEMA &amp; banking",
    "SEBI": "Securities",
}

INK = "#1c1917"
INK_2 = "#44403c"
INK_3 = "#78716c"
RULE = "#e7e5e4"
PAPER = "#faf9f7"
LINK = "#14532d"


def _esc(v: object) -> str:
    return html.escape(str(v or ""))


def _found_phrase(n: int) -> str:
    """"1 new notifications and circulars" is the sort of thing that makes a report look unread."""
    if n == 0:
        return "No new notifications"
    if n == 1:
        return "One new notification or circular"
    return f"{n} new notifications and circulars"


def _section(title: str, body: str) -> str:
    """A headed block. Only called for sections that have something in them."""
    return (
        f"<tr><td style='padding:22px 24px 0'>"
        f"<div style='font:600 11px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
        f"letter-spacing:.08em;text-transform:uppercase;color:{INK_3}'>{title}</div>"
        f"</td></tr><tr><td style='padding:8px 24px 0'>{body}</td></tr>"
    )


def _by_regulator(new_docs: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for d in new_docs:
        grouped.setdefault(d.get("regulator_code") or "Other", []).append(d)
    return dict(sorted(grouped.items(), key=lambda kv: (-len(kv[1]), kv[0])))


def digest_subject(new_docs: list[dict], failures: list[dict], day: date) -> str:
    """What the inbox shows before anything is opened.

    The counts per regulator go in the subject on purpose: most mornings that is the whole message, and
    whether it is worth opening now depends on which regulator moved. No date -- the mail carries its own,
    and the room is better spent on the breakdown.
    """
    if not new_docs:
        head = "As Amended · nothing new"
    else:
        counts = [f"{code} {len(items)}" for code, items in _by_regulator(new_docs).items()]
        head = f"As Amended · {len(new_docs)} new · " + ", ".join(counts[:4])
        if len(counts) > 4:
            head += f" +{len(counts) - 4} more"
    if failures:
        head += f" · {len(failures)} collector failure{'s' if len(failures) != 1 else ''}"
    return head


def build_digest_html(
    new_docs: list[dict],
    merges: list[dict],
    cannot_apply: list[dict],
    discrepancies: list[dict],
    failures: list[dict],
    site_url: str,
    day: date,
) -> str:
    site = site_url.rstrip("/")
    rows: list[str] = []

    # Masthead.
    rows.append(
        f"<tr><td style='padding:24px 24px 0'>"
        f"<div style='font:600 19px/1.2 Georgia,\"Times New Roman\",serif;color:{INK}'>As Amended</div>"
        f"<div style='font:500 10.5px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
        f"letter-spacing:.12em;text-transform:uppercase;color:{INK_3};padding-top:3px'>"
        f"Indian tax &amp; corporate law, in the regulator&rsquo;s words</div>"
        f"<div style='font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
        f"color:{INK_2};padding-top:14px'>"
        + f"{_found_phrase(len(new_docs))} on {day.strftime('%d %b %Y')}."
        + "</div></td></tr>"
    )

    # New documents, grouped by regulator: the same fifty rows read very differently sorted by who issued
    # them, because a reader is almost always here for one regulator and skimming past the rest.
    if new_docs:
        blocks = []
        for code, items in _by_regulator(new_docs).items():
            label = REGULATOR_NAMES.get(code, code)
            blocks.append(
                f"<div style='font:600 12.5px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
                f"color:{INK};padding:14px 0 6px'>{_esc(code)} "
                f"<span style='font-weight:400;color:{INK_3}'>&middot; {label} &middot; {len(items)}</span></div>"
            )
            lis = []
            for d in items:
                number = _esc(d.get("number"))
                issued = _esc(d.get("date_issued"))
                meta = " &middot; ".join(x for x in [number, issued] if x)
                lis.append(
                    f"<div style='padding:7px 0;border-top:1px solid {RULE}'>"
                    f"<a href='{site}/documents/{d['id']}' "
                    f"style='font:500 13.5px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
                    f"color:{LINK};text-decoration:none'>{_esc(d.get('title'))}</a>"
                    + (
                        f"<div style='font:400 11.5px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
                        f"color:{INK_3};padding-top:2px'>{meta}</div>"
                        if meta
                        else ""
                    )
                    + "</div>"
                )
            blocks.append("".join(lis))
        rows.append(f"<tr><td style='padding:0 24px'>{''.join(blocks)}</td></tr>")

    # Everything below appears only when it has something to report. The old digest printed "None." under
    # five headings every morning, which buried the one line that ever changed.
    if merges:
        body = "".join(
            f"<div style='padding:6px 0;border-top:1px solid {RULE};font:400 13px/1.5 -apple-system,Segoe UI,"
            f"Roboto,Helvetica,Arial,sans-serif;color:{INK_2}'>{_esc(m['instrument_title'])} "
            f"{_esc(m['provision_number'])} &middot; {_esc(m['change_type'])} &middot; "
            f"<a href='{site}/documents/{m['document_id']}' style='color:{LINK}'>{_esc(m['document_title'])}</a></div>"
            for m in merges
        )
        rows.append(_section(f"Amendments applied ({len(merges)})", body))

    if cannot_apply:
        body = "".join(
            f"<div style='padding:6px 0;border-top:1px solid {RULE};font:400 13px/1.5 -apple-system,Segoe UI,"
            f"Roboto,Helvetica,Arial,sans-serif;color:{INK_2}'>{_esc(m['instrument_title'])} "
            f"{_esc(m['provision_number'])}: {_esc((m.get('ai_note') or '')[:300])} &middot; "
            f"<a href='{site}/documents/{m['document_id']}' style='color:{LINK}'>source</a></div>"
            for m in cannot_apply
        )
        rows.append(_section(f"Could not be applied automatically ({len(cannot_apply)})", body))

    if discrepancies:
        body = "".join(
            f"<div style='padding:6px 0;border-top:1px solid {RULE};font:400 13px/1.5 -apple-system,Segoe UI,"
            f"Roboto,Helvetica,Arial,sans-serif;color:{INK_2}'>{_esc(m['instrument_title'])} "
            f"{_esc(m['provision_number'])}</div>"
            for m in discrepancies
        )
        rows.append(_section(f"Official text differs, last 30 days ({len(discrepancies)})", body))

    if failures:
        body = "".join(
            f"<div style='padding:6px 0;border-top:1px solid {RULE};font:400 13px/1.5 -apple-system,Segoe UI,"
            f"Roboto,Helvetica,Arial,sans-serif;color:#991b1b'><b>{_esc(f['adapter'])}</b> "
            f"{_esc((f.get('error') or '')[:240])}</div>"
            for f in failures
        )
        rows.append(_section(f"Collectors that failed ({len(failures)})", body))

    rows.append(
        f"<tr><td style='padding:22px 24px 24px'>"
        f"<a href='{site}' style='display:inline-block;border:1px solid {RULE};border-radius:3px;"
        f"padding:9px 16px;font:500 13px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
        f"color:{INK};text-decoration:none;background:#fff'>Open As Amended</a>"
        f"<div style='font:400 11.5px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
        f"color:{INK_3};padding-top:16px;border-top:1px solid {RULE};margin-top:20px'>"
        f"Amendments are shown as references and are never applied to the statutory text, so what you read is "
        f"the regulator&rsquo;s own wording. A research aid, not legal advice.</div>"
        f"</td></tr>"
    )

    return (
        f"<div style='background:{PAPER};padding:24px 12px'>"
        f"<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='600' "
        f"style='width:600px;max-width:100%;margin:0 auto;background:#fff;border:1px solid {RULE};"
        f"border-radius:4px;border-collapse:separate'>"
        + "".join(rows)
        + "</table></div>"
    )


def build_digest_text(new_docs: list[dict], failures: list[dict], site_url: str, day: date) -> str:
    """The same thing as plain text.

    Sent alongside the HTML, not instead of it. Some clients prefer it, some people choose it, and a mail
    with no text part scores worse with spam filters -- which matters when sending from a shared domain.
    """
    site = site_url.rstrip("/")
    lines = [f"As Amended - {day.strftime('%d %b %Y')}", ""]
    lines.append(f"{_found_phrase(len(new_docs))}.")
    if new_docs:
        for code, items in _by_regulator(new_docs).items():
            lines += ["", f"{code} ({len(items)})"]
            for d in items:
                meta = " - ".join(x for x in [str(d.get("number") or ""), str(d.get("date_issued") or "")] if x)
                lines.append(f"  * {d.get('title')}")
                if meta:
                    lines.append(f"    {meta}")
                lines.append(f"    {site}/documents/{d['id']}")
    if failures:
        lines += ["", f"Collectors that failed ({len(failures)}):"]
        lines += [f"  * {f['adapter']}: {(f.get('error') or '')[:200]}" for f in failures]
    lines += ["", site, "", "Amendments are shown as references and are never applied to the statutory text.",
              "A research aid, not legal advice."]
    return "\n".join(lines)


def send_digest(subject: str, body_html: str, body_text: str | None = None) -> bool:
    if not settings.resend_api_key or not settings.digest_to:
        log.info("RESEND_API_KEY / DIGEST_TO not set; skipping digest email")
        return False
    try:
        import resend

        resend.api_key = settings.resend_api_key
        payload: dict = {
            "from": settings.digest_from,
            "to": settings.digest_to,
            "subject": subject,
            "html": body_html,
        }
        if body_text:
            payload["text"] = body_text
        resend.Emails.send(payload)
        return True
    except Exception as exc:
        log.error("Resend failed: %s", exc)
        return False
