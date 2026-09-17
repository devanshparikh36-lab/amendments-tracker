"""Daily digest email via Resend.

Written for mail clients, which is a narrower medium than it looks. Every style is inline, because Gmail
strips a <style> block in some views and Outlook in others; layout is tables, because Outlook renders through
Word and does not do flex or grid; widths are fixed at 600px, the figure every client and phone handles
without side-scrolling. None of that is how the website is built, and it is not a mistake that they differ.
"""
from __future__ import annotations

import html
import logging
from datetime import date, datetime, timedelta, timezone

from ..config import settings

log = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))

# Full names for the codes stored against each document. A digest is read at a glance and half-awake; "CBIC"
# is what a practitioner recognises, the expansion is there for everyone else.
REGULATOR_NAMES = {
    "CBDT": "Income tax",
    "CBIC": "GST &amp; customs",
    "MCA": "Companies",
    "RBI": "FEMA &amp; banking",
    "SEBI": "Securities",
}

# How many documents the mail will list before it stops and links to the rest.
#
# A typical day is two. The day the corpus was first backfilled was 7,979, and at roughly a kilobyte of
# markup per row that is an eight-megabyte message: Resend rejects it, and Gmail clips anything past 102 KB
# mid-sentence with a "view entire message" link that loses the formatting. A re-seed, or adding a new body
# of regulation, would do it again -- so this is a real bound rather than a defensive one.
#
# Fifty rows is around 45 KB, less than half of what Gmail will take. The headroom is deliberate: the cap
# counts documents, not bytes, and a day of unusually long titles costs more per row than an average one.
#
# What is left out is always stated and always linked. A digest that quietly shows fifty of eight hundred
# reads exactly like a digest that found fifty.
MAX_LISTED = 50

INK = "#1c1917"
INK_2 = "#44403c"
INK_3 = "#78716c"
RULE = "#e7e5e4"
PAPER = "#faf9f7"
CARD = "#ffffff"
LINK = "#14532d"
ALERT = "#991b1b"


def _esc(v: object) -> str:
    return html.escape(str(v or ""))


def _found_phrase(n: int) -> str:
    """"1 new notifications and circulars" is the sort of thing that makes a report look unread."""
    if n == 0:
        return "No new notifications"
    if n == 1:
        return "One new notification or circular"
    return f"{n} new notifications and circulars"


def _human_date(value: object) -> str:
    """15 Sep 2026, not 2026-09-15. ISO is for machines and for sorting, and this is neither."""
    if not value:
        return ""
    if isinstance(value, (date, datetime)):
        return value.strftime("%d %b %Y")
    try:
        return date.fromisoformat(str(value)[:10]).strftime("%d %b %Y")
    except ValueError:
        return str(value)


def _pdf_url(doc: dict) -> str | None:
    """The official file, by the same rule the website uses, so a link means the same thing in both places."""
    key = doc.get("pdf_key")
    if not key:
        return None
    from ..storage.files import storage

    try:
        return storage().public_url(key)
    except Exception:  # pragma: no cover - a digest must not die over a link
        return None


def _by_regulator(new_docs: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for d in new_docs:
        grouped.setdefault(d.get("regulator_code") or "Other", []).append(d)
    return dict(sorted(grouped.items(), key=lambda kv: (-len(kv[1]), kv[0])))


def _arrival_name(a: dict) -> str:
    """What to call a newly tracked body of law. The regulator's own name, or its code if it has none."""
    return str(a.get("name") or a.get("code") or "").strip() or str(a.get("code") or "")


def digest_subject(new_docs: list[dict], failures: list[dict], day: date, arrivals: list[dict] | None = None) -> str:
    """What the inbox shows before anything is opened.

    The counts per regulator go in the subject on purpose: most mornings that is the whole message, and
    whether it is worth opening now depends on which regulator moved. No date -- the mail carries its own,
    and the room is better spent on the breakdown.

    A newly tracked regulator takes the front of the line, because it is the rarest thing this mail ever
    carries and the only one that changes what the tracker covers rather than what it found.
    """
    parts = []
    if arrivals:
        names = ", ".join(_arrival_name(a) for a in arrivals[:2])
        if len(arrivals) > 2:
            names += f" and {len(arrivals) - 2} more"
        parts.append(f"now tracking {names}")
    if new_docs:
        counts = [f"{code} {len(items)}" for code, items in _by_regulator(new_docs).items()]
        seg = f"{len(new_docs)} new · " + ", ".join(counts[:4])
        if len(counts) > 4:
            seg += f" +{len(counts) - 4} more"
        parts.append(seg)
    if not parts:
        parts.append("nothing new")
    if failures:
        parts.append(f"{len(failures)} collector failure{'s' if len(failures) != 1 else ''}")
    return "As Amended · " + " · ".join(parts)


def _preheader(new_docs: list[dict], failures: list[dict], arrivals: list[dict] | None = None) -> str:
    """The grey line the inbox prints beside the subject.

    Left alone, clients scrape it from the top of the body, which here is the masthead -- so the one piece of
    inbox real estate that could say something would have repeated the name of the sender. This says what
    was found instead.

    The trailing run of zero-width spaces stops the client continuing the preview into the body text after
    this div ends, which is the standard trick and looks like nonsense without knowing why.
    """
    if arrivals:
        text = "Now tracking " + ", ".join(_arrival_name(a) for a in arrivals)
        if new_docs:
            text += " · " + " · ".join(f"{code} {len(items)}" for code, items in _by_regulator(new_docs).items())
    elif new_docs:
        bits = [f"{code} {len(items)}" for code, items in _by_regulator(new_docs).items()]
        tagged = sum(1 for d in new_docs if d.get("affects"))
        text = " · ".join(bits)
        if tagged:
            text += f" · {tagged} tagged to an Act or Rule"
    else:
        text = "Nothing published since the last check."
    if failures:
        text += f" · {len(failures)} collector failure{'s' if len(failures) != 1 else ''}"
    return (
        f"<div style='display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;"
        f"color:{CARD};opacity:0'>{_esc(text)}"
        + "&#847;&zwnj;&nbsp;" * 60
        + "</div>"
    )


def _section(title: str, body: str) -> str:
    """A headed block. Only called for sections that have something in them."""
    return (
        f"<tr><td style='padding:22px 24px 0;background:{CARD}'>"
        f"<div style='font:600 11px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;"
        f"letter-spacing:.08em;text-transform:uppercase;color:{INK_3}'>{title}</div>"
        f"</td></tr><tr><td style='padding:8px 24px 0;background:{CARD}'>{body}</td></tr>"
    )


def _window_line(since: datetime | None, day: date) -> str:
    """Exactly what this digest covers.

    Worth stating plainly. A reader deciding whether a notification was missed needs to know the boundaries,
    and "daily" does not say where a day starts -- particularly here, where the window is in UTC, collection
    runs at 07:00 IST, and the two do not line up.
    """
    if not since:
        return f"Covering the day to {day.strftime('%d %b %Y')}."
    start = since.astimezone(IST)
    end = datetime.now(timezone.utc).astimezone(IST)
    return f"Covering {start.strftime('%d %b, %H:%M')} to {end.strftime('%d %b, %H:%M')} IST."


def build_digest_html(
    new_docs: list[dict],
    merges: list[dict],
    cannot_apply: list[dict],
    discrepancies: list[dict],
    failures: list[dict],
    site_url: str,
    day: date,
    since: datetime | None = None,
    arrivals: list[dict] | None = None,
) -> str:
    site = site_url.rstrip("/")
    sans = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"
    rows: list[str] = []

    # Masthead.
    rows.append(
        f"<tr><td style='padding:24px 24px 0;background:{CARD}'>"
        f"<div style='font:600 19px/1.2 Georgia,\"Times New Roman\",serif;color:{INK}'>As Amended</div>"
        f"<div style='font:500 10.5px/1.5 {sans};letter-spacing:.12em;text-transform:uppercase;"
        f"color:{INK_3};padding-top:3px'>Indian tax &amp; corporate law, in the regulator&rsquo;s words</div>"
        f"<div style='font:400 13px/1.5 {sans};color:{INK_2};padding-top:14px'>"
        f"{_found_phrase(len(new_docs))} on {day.strftime('%d %b %Y')}.</div>"
        f"<div style='font:400 11.5px/1.5 {sans};color:{INK_3};padding-top:4px'>"
        f"{_esc(_window_line(since, day))}</div>"
        f"</td></tr>"
    )

    # A newly tracked regulator, announced rather than listed.
    #
    # This is the one genuinely good thing the digest ever carries: not "here is what changed today" but
    # "there is a whole area of law here now that was not before". It sits above the day's findings, in the
    # one coloured panel in the mail, and says how far back the archive reaches -- because the depth is the
    # point. Its documents are summarised rather than enumerated: the first haul is the entire back
    # catalogue, and a few thousand rows would bury everything else.
    if arrivals:
        cards = []
        for a in arrivals:
            n = int(a.get("n") or 0)
            span = ""
            oldest, newest = _human_date(a.get("oldest")), _human_date(a.get("newest"))
            if oldest and newest and oldest != newest:
                span = f", published between {oldest} and {newest}"
            elif oldest:
                span = f", from {oldest}"
            cards.append(
                f"<div style='padding:14px 16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;"
                f"margin-bottom:10px'>"
                f"<div style='font:600 11px/1.4 {sans};letter-spacing:.08em;text-transform:uppercase;"
                f"color:{LINK}'>Now tracking</div>"
                f"<div style='font:600 15px/1.4 Georgia,\"Times New Roman\",serif;color:{INK};padding-top:4px'>"
                f"{_esc(_arrival_name(a))}</div>"
                f"<div style='font:400 13px/1.55 {sans};color:{INK_2};padding-top:6px'>"
                f"<b>{n:,}</b> document{'s' if n != 1 else ''} added to the archive{_esc(span)}. "
                f"Everything this regulator publishes from now on arrives in this digest.</div>"
                f"<div style='padding-top:10px'>"
                f"<a href='{site}/documents?regulator={_esc(a.get('code'))}' "
                f"style='font:500 13px/1 {sans};color:{LINK};text-decoration:none;border-bottom:1px solid #bbf7d0'>"
                f"Browse {_esc(a.get('code'))} &rarr;</a></div>"
                f"</div>"
            )
        rows.append(f"<tr><td style='padding:18px 24px 0;background:{CARD}'>{''.join(cards)}</td></tr>")

    # New documents, grouped by regulator: the same fifty rows read very differently sorted by who issued
    # them, because a reader is almost always here for one regulator and skimming past the rest.
    if new_docs:
        blocks = []
        budget = MAX_LISTED
        for code, items in _by_regulator(new_docs).items():
            label = REGULATOR_NAMES.get(code, code)
            blocks.append(
                f"<div style='font:600 12.5px/1.5 {sans};color:{INK};padding:14px 0 6px'>{_esc(code)} "
                f"<span style='font-weight:400;color:{INK_3}'>&middot; {label} &middot; {len(items)}</span></div>"
            )
            shown, hidden = items[:budget], items[budget:]
            budget -= len(shown)
            if hidden:
                blocks.append(
                    f"<div style='padding:8px 0;border-top:1px solid {RULE};font:400 12.5px/1.5 {sans};"
                    f"color:{INK_3}'>and {len(hidden)} more from {_esc(code)} &middot; "
                    f"<a href='{site}/documents?regulator={_esc(code)}' style='color:{LINK}'>see them all</a></div>"
                )
            for d in shown:
                pdf = _pdf_url(d)
                number = _esc(d.get("number"))
                # The number opens the regulator's own file and the title opens our page about it, which is
                # the same division the website makes. Practitioners cite the number, so the number is what
                # reaches the source.
                cite = (
                    f"<a href='{pdf}' style='color:{LINK};text-decoration:none;border-bottom:1px solid {RULE}'>"
                    f"{number}</a> <span style='color:{INK_3}'>PDF</span>"
                    if pdf and number
                    else number
                )
                meta_bits = [b for b in [cite, _human_date(d.get("date_issued"))] if b]
                affects = _esc(d.get("affects"))
                blocks.append(
                    f"<div style='padding:8px 0;border-top:1px solid {RULE}'>"
                    f"<a href='{site}/documents/{d['id']}' style='font:500 13.5px/1.45 {sans};"
                    f"color:{LINK};text-decoration:none'>{_esc(d.get('title'))}</a>"
                    + (
                        f"<div style='font:400 11.5px/1.6 {sans};color:{INK_3};padding-top:3px'>"
                        + " &middot; ".join(meta_bits)
                        + "</div>"
                        if meta_bits
                        else ""
                    )
                    # Only about half of all documents are tagged to an instrument, so this line appears when
                    # it is known and is simply absent otherwise -- an empty "Affects:" label every other row
                    # would be worse than no label at all.
                    + (
                        f"<div style='font:400 11.5px/1.6 {sans};color:{INK_3};padding-top:2px'>"
                        f"Affects <span style='color:{INK_2}'>{affects}</span></div>"
                        if affects
                        else ""
                    )
                    + "</div>"
                )
        rows.append(f"<tr><td style='padding:0 24px;background:{CARD}'>{''.join(blocks)}</td></tr>")

    # Everything below appears only when it has something to report. The old digest printed "None." under
    # five headings every morning, which buried the one line that ever changed.
    if merges:
        body = "".join(
            f"<div style='padding:6px 0;border-top:1px solid {RULE};font:400 13px/1.5 {sans};color:{INK_2}'>"
            f"{_esc(m['instrument_title'])} {_esc(m['provision_number'])} &middot; {_esc(m['change_type'])} &middot; "
            f"<a href='{site}/documents/{m['document_id']}' style='color:{LINK}'>{_esc(m['document_title'])}</a></div>"
            for m in merges
        )
        rows.append(_section(f"Amendments applied ({len(merges)})", body))

    if cannot_apply:
        body = "".join(
            f"<div style='padding:6px 0;border-top:1px solid {RULE};font:400 13px/1.5 {sans};color:{INK_2}'>"
            f"{_esc(m['instrument_title'])} {_esc(m['provision_number'])}: {_esc((m.get('ai_note') or '')[:300])} "
            f"&middot; <a href='{site}/documents/{m['document_id']}' style='color:{LINK}'>source</a></div>"
            for m in cannot_apply
        )
        rows.append(_section(f"Could not be applied automatically ({len(cannot_apply)})", body))

    if discrepancies:
        body = "".join(
            f"<div style='padding:6px 0;border-top:1px solid {RULE};font:400 13px/1.5 {sans};color:{INK_2}'>"
            f"{_esc(m['instrument_title'])} {_esc(m['provision_number'])}</div>"
            for m in discrepancies
        )
        rows.append(_section(f"Official text differs, last 30 days ({len(discrepancies)})", body))

    if failures:
        body = "".join(
            f"<div style='padding:6px 0;border-top:1px solid {RULE};font:400 13px/1.5 {sans};color:{ALERT}'>"
            f"<b>{_esc(f['adapter'])}</b> {_esc((f.get('error') or '')[:240])}</div>"
            for f in failures
        )
        rows.append(_section(f"Collectors that failed ({len(failures)})", body))

    rows.append(
        f"<tr><td style='padding:22px 24px 24px;background:{CARD}'>"
        f"<a href='{site}' style='display:inline-block;border:1px solid {RULE};border-radius:3px;"
        f"padding:9px 16px;font:500 13px/1 {sans};color:{INK};text-decoration:none;background:{CARD}'>"
        f"Open As Amended</a>"
        f"<div style='font:400 11.5px/1.6 {sans};color:{INK_3};padding-top:16px;border-top:1px solid {RULE};"
        f"margin-top:20px'>Amendments are shown as references and are never applied to the statutory text, so "
        f"what you read is the regulator&rsquo;s own wording. A research aid, not legal advice.</div>"
        f"</td></tr>"
    )

    # A whole document rather than a fragment, so the colour-scheme meta tags exist. Without them a client in
    # dark mode inverts the palette on its own and decides for itself what these greys become; with them it
    # knows the design is light and leaves it alone. Every container also carries an explicit background,
    # because the clients that invert anyway do it to unpainted surfaces first.
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<meta name='color-scheme' content='light'>"
        "<meta name='supported-color-schemes' content='light'>"
        f"</head><body style='margin:0;padding:0;background:{PAPER}'>"
        + _preheader(new_docs, failures, arrivals)
        + f"<div style='background:{PAPER};padding:24px 12px'>"
        f"<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='600' "
        f"style='width:600px;max-width:100%;margin:0 auto;background:{CARD};border:1px solid {RULE};"
        f"border-radius:4px;border-collapse:separate'>"
        + "".join(rows)
        + "</table></div></body></html>"
    )


def build_digest_text(
    new_docs: list[dict],
    failures: list[dict],
    site_url: str,
    day: date,
    arrivals: list[dict] | None = None,
) -> str:
    """The same thing as plain text.

    Sent alongside the HTML, not instead of it. Some clients prefer it, some people choose it, and a mail
    with no text part scores worse with spam filters -- which matters when sending from a shared domain.
    """
    site = site_url.rstrip("/")
    lines = [f"As Amended - {day.strftime('%d %b %Y')}", ""]
    for a in arrivals or []:
        n = int(a.get("n") or 0)
        lines += [
            f"NOW TRACKING: {_arrival_name(a)}",
            f"  {n:,} documents added to the archive."
            + (f" Published between {_human_date(a.get('oldest'))} and {_human_date(a.get('newest'))}."
               if a.get("oldest") and a.get("newest") else ""),
            "  Everything this regulator publishes from now on arrives in this digest.",
            f"  {site}/documents?regulator={a.get('code')}",
            "",
        ]
    lines.append(f"{_found_phrase(len(new_docs))}.")
    if new_docs:
        budget = MAX_LISTED
        for code, items in _by_regulator(new_docs).items():
            lines += ["", f"{code} ({len(items)})"]
            shown, hidden = items[:budget], items[budget:]
            budget -= len(shown)
            if hidden:
                lines.append(f"  ... and {len(hidden)} more: {site}/documents?regulator={code}")
            for d in shown:
                lines.append(f"  * {d.get('title')}")
                meta = " - ".join(x for x in [str(d.get("number") or ""), _human_date(d.get("date_issued"))] if x)
                if meta:
                    lines.append(f"    {meta}")
                if d.get("affects"):
                    lines.append(f"    Affects: {d['affects']}")
                lines.append(f"    {site}/documents/{d['id']}")
                pdf = _pdf_url(d)
                if pdf:
                    lines.append(f"    Official PDF: {pdf}")
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
        if settings.digest_reply_to:
            payload["reply_to"] = settings.digest_reply_to
        if settings.digest_unsubscribe:
            # RFC 8058: the -Post header is what lets a client offer one-click unsubscribe rather than
            # sending the reader off to a page. Both or neither -- the header alone does nothing.
            payload["headers"] = {
                "List-Unsubscribe": f"<{settings.digest_unsubscribe}>",
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            }
        resend.Emails.send(payload)
        return True
    except Exception as exc:
        log.error("Resend failed: %s", exc)
        return False
