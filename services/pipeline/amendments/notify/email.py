"""Daily digest email, over SMTP with Resend as a fallback.

Written for mail clients, which is a narrower medium than it looks. Every style is inline, because Gmail
strips a <style> block in some views and Outlook in others; layout is tables, because Outlook renders through
Word and does not do flex or grid; widths are fixed at 600px, the figure every client and phone handles
without side-scrolling. None of that is how the website is built, and it is not a mistake that they differ.
"""
from __future__ import annotations

import html
import logging
import smtplib
import ssl
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

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


def _join_names(names: list[str], limit: int = 4) -> str:
    """An English list -- "CBDT, SEBI and RBI" -- rather than a run of delimiters."""
    if not names:
        return ""
    if len(names) > limit:
        return ", ".join(names[: limit - 1]) + f" and {len(names) - (limit - 1)} others"
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


# The long form each regulator puts at the front of its own instruments. Worth removing from the preview
# line and nowhere else: "Securities and Exchange Board of India (Certification of Associated Persons in
# the Securities Markets) (Amendment) Regulations, 2026" spends its first 38 characters on the issuer, and
# an inbox preview is cut around 120 -- so the boilerplate pushed "Regulations, 2026" off the end and the
# reader saw a preview that could have been any SEBI instrument ever made. The subject has already named
# the regulator; the preview's job is the part that differs.
_ISSUER_PREFIXES = (
    "Securities and Exchange Board of India",
    "Reserve Bank of India",
    "Central Board of Direct Taxes",
    "Central Board of Indirect Taxes and Customs",
    "Ministry of Corporate Affairs",
)


def _unwrap_leading_paren(t: str) -> str:
    """Take the brackets off a title that now begins with one.

    SEBI names its instruments "Securities and Exchange Board of India (Certification of Associated
    Persons...) (Amendment) Regulations, 2026". Removing the issuer leaves the line starting on an opening
    bracket, which reads as though the sentence began in the middle -- and every SEBI title in the corpus
    is built this way, so it is the normal case rather than an edge one.

    Only the first pair, and only when it opens the string: the later "(Amendment)" is part of how the
    instrument is actually cited and stays exactly where it is.
    """
    if not t.startswith("("):
        return t
    depth = 0
    for i, ch in enumerate(t):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                # Nothing after the closing bracket means the whole title was one parenthetical; leave it be.
                tail = t[i + 1:].strip()
                return (t[1:i].strip() + " " + tail).strip() if tail else t
    # Unbalanced -- a truncated or malformed title. Better left alone than half-rewritten.
    return t


def _drop_issuer(title: str) -> str:
    t = " ".join(str(title or "").split())
    for prefix in _ISSUER_PREFIXES:
        if t.startswith(prefix):
            rest = t[len(prefix):].lstrip(" ,-–—")
            # Only if something substantial survives. A title that is *only* the issuer's name stays whole.
            if len(rest) > 12:
                return _unwrap_leading_paren(rest)
    return t


def _trim(text: str, limit: int) -> str:
    """Cut to a word boundary, with a real ellipsis. Inbox previews are cut by the client anyway; the point
    is to choose where, so the cut lands between words rather than mid-statute."""
    t = " ".join(str(text or "").split())
    if len(t) <= limit:
        return t
    cut = t[:limit].rsplit(" ", 1)[0].rstrip(" ,;:-—")
    return cut + "…"


def digest_subject(new_docs: list[dict], day: date, arrivals: list[dict] | None = None) -> str:
    """What the inbox shows before anything is opened.

    No "As Amended" prefix. The sender name already says it, and on a phone the subject is cut at roughly
    forty characters -- so a brand repeated there costs a third of everything the reader will see, to tell
    them something the line above already told them.

    The date goes on the end, and is not decoration. Gmail threads by subject, so two days that both found
    two CBIC circulars produced one subject, collapsed into a single conversation, and the newer digest
    arrived hidden underneath the older one. A date makes each day its own thread. On the end rather than
    the front because trailing characters are the ones the phone drops, and threading reads the whole
    subject whether or not the reader can see it -- so it does its work from where it costs nothing.

    Codes, not the subject-matter names used in the body. "SEBI, RBI and CBDT" is both shorter and the
    vocabulary this reader already thinks in; "Securities, FEMA & banking and Income tax" is neither.

    A newly tracked regulator takes the front of the line: it is the rarest thing this mail carries, and the
    only one that changes what the tracker covers rather than what it found.
    """
    stamp = day.strftime("%d %b")
    clauses = []
    if arrivals:
        # Code here, full name in the preview. "Now tracking Securities and Exchange Board of India" is cut
        # to "Now tracking Securities and Exchange Boa" on a phone, which says less than "SEBI" does.
        clauses.append("Now tracking " + _join_names([str(a.get("code") or _arrival_name(a)) for a in arrivals], limit=3))
    if new_docs:
        n = len(new_docs)
        codes = list(_by_regulator(new_docs).keys())
        noun = "notification" if n == 1 else "notifications"
        clauses.append(f"{n} {noun} from {_join_names(codes)}" if not arrivals else f"{n} {noun}")
    if not clauses:
        clauses.append("No new notifications")
    return " · ".join(clauses + [stamp])


def _preheader(new_docs: list[dict], arrivals: list[dict] | None = None) -> str:
    """The grey line the inbox prints beside the subject, and the second line of a phone notification.

    It names the day's lead item. The version before this one printed "SEBI 6 · RBI 2 · CBDT 1 · 5 tagged
    to an Act or Rule" -- counts the subject had already given, in codes and bare numbers, with "tagged"
    borrowed from the schema rather than from anything a reader thinks. It read like a log line, and it
    spent the one piece of inbox space that could have said something on saying the subject again.

    So: the most recently issued document, by title, and how many others are behind it. That is the thing a
    reader wants from a notification they have not opened -- whether today's item is the one they were
    waiting for.

    Left alone entirely, clients scrape this from the top of the body, which here is the masthead, and the
    preview becomes the name of the sender for a third time.

    The trailing run of zero-width spaces stops the client continuing the preview into the body text after
    this div ends, which is the standard trick and looks like nonsense without knowing why.
    """
    if arrivals:
        text = "Now tracking " + ", ".join(_arrival_name(a) for a in arrivals)
        if new_docs:
            text += f" · and {len(new_docs)} notification{'s' if len(new_docs) != 1 else ''} besides"
    elif new_docs:
        # Ordered by date issued, so the first row is the most recent thing any regulator published.
        text = _trim(_drop_issuer(new_docs[0].get("title") or "Untitled"), 120)
        rest = len(new_docs) - 1
        if rest:
            text += f" · and {rest} more"
    else:
        text = "Nothing published by any of the five regulators since the last check."
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
    site_url: str,
    day: date,
    since: datetime | None = None,
    arrivals: list[dict] | None = None,
    unsubscribe_url: str | None = None,
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

    # No section for collector failures, deliberately. A broken adapter already makes the collection run
    # exit non-zero, which reddens that workflow and has GitHub mail about it, and /status carries the same
    # picture on the site. This mail reports what the regulators published; whether the machinery reading
    # them is healthy is a different question with two channels of its own already.
    rows.append(
        f"<tr><td style='padding:22px 24px 24px;background:{CARD}'>"
        f"<a href='{site}' style='display:inline-block;border:1px solid {RULE};border-radius:3px;"
        f"padding:9px 16px;font:500 13px/1 {sans};color:{INK};text-decoration:none;background:{CARD}'>"
        f"Open As Amended</a>"
        f"<div style='font:400 11.5px/1.6 {sans};color:{INK_3};padding-top:16px;border-top:1px solid {RULE};"
        f"margin-top:20px'>Amendments are shown as references and are never applied to the statutory text, so "
        f"what you read is the regulator&rsquo;s own wording. A research aid, not legal advice.</div>"
        # A visible way out, for the reader's copy only.
        #
        # The List-Unsubscribe headers cover Gmail and Outlook, which draw their own control from them. This
        # is for every other client, and for the reader who looks for the word rather than the button. The
        # owner's copy is built without a URL and gets no line: there is nothing for them to unsubscribe
        # from, and an opt-out link on your own digest invites you to break your own alerting.
        + (
            f"<div style='font:400 11.5px/1.6 {sans};color:{INK_3};padding-top:10px'>"
            f"You are getting this because you confirmed this address on As Amended. "
            f"<a href='{unsubscribe_url}' style='color:{INK_3};text-decoration:underline'>Stop these emails</a>"
            f".</div>"
            if unsubscribe_url
            else ""
        )
        + f"</td></tr>"
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
        + _preheader(new_docs, arrivals)
        + f"<div style='background:{PAPER};padding:24px 12px'>"
        f"<table role='presentation' cellpadding='0' cellspacing='0' border='0' width='600' "
        f"style='width:600px;max-width:100%;margin:0 auto;background:{CARD};border:1px solid {RULE};"
        f"border-radius:4px;border-collapse:separate'>"
        + "".join(rows)
        + "</table></div></body></html>"
    )


def build_digest_text(
    new_docs: list[dict],
    site_url: str,
    day: date,
    arrivals: list[dict] | None = None,
    unsubscribe_url: str | None = None,
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
    lines += ["", site, "", "Amendments are shown as references and are never applied to the statutory text.",
              "A research aid, not legal advice."]
    if unsubscribe_url:
        lines += ["", "You are getting this because you confirmed this address on As Amended.",
                  "To stop these emails: " + unsubscribe_url]
    return "\n".join(lines)


def _unsubscribe_headers(url: str | None = None) -> dict[str, str]:
    """RFC 8058, and both headers or neither.

    The -Post header is what lets a client offer one-click unsubscribe in its own interface rather than
    sending the reader off to a page; List-Unsubscribe on its own does nothing in most clients.

    The URL is now per reader, built from their own token, rather than the one DIGEST_UNSUBSCRIBE address
    for everybody -- a shared link cannot tell the sender who pressed it, so it cannot actually unsubscribe
    anyone. DIGEST_UNSUBSCRIBE remains as a fallback for a caller that has no reader to name.

    Empty for the owner's copy. There is nothing for them to unsubscribe from.
    """
    target = url or settings.digest_unsubscribe
    if not target:
        return {}
    return {
        "List-Unsubscribe": f"<{target}>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }


def _smtp_ready() -> bool:
    return bool(settings.smtp_host and settings.smtp_user and settings.smtp_password)


def smtp_from() -> str:
    """Who the mail is from, over SMTP.

    The authenticated account unless DIGEST_FROM says otherwise, because Gmail rewrites a From that is
    neither the account nor one of its verified "Send mail as" aliases -- so inventing one here produces
    mail that silently disagrees with its own configuration.
    """
    return settings.digest_from or f"As Amended <{settings.smtp_user}>"


def build_message(
    subject: str,
    body_html: str,
    body_text: str | None,
    from_addr: str,
    to_addrs: list[str],
    unsubscribe_url: str | None = None,
) -> EmailMessage:
    """The MIME message, kept separate from sending it so its shape can be tested without a password.

    Plain text first and HTML second, which is the whole point of multipart/alternative: a client renders
    the last part it understands. Reversed, every modern client shows the plain text instead.
    """
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    # The server would add both if they were absent, and both are worth setting anyway: a message with no
    # Date is scored as suspicious by several filters, and a Message-ID generated here is one we could log.
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain="as-amended")
    if settings.digest_reply_to:
        msg["Reply-To"] = settings.digest_reply_to
    for k, v in _unsubscribe_headers(unsubscribe_url).items():
        msg[k] = v
    # A text part always, even when the caller passed none. A message with no text alternative scores worse
    # with spam filters, which costs more than these few lines of fallback.
    msg.set_content(body_text or "This digest is formatted as HTML. Open it in a client that renders HTML.")
    msg.add_alternative(body_html, subtype="html")
    return msg


def _send_via_smtp(
    subject: str,
    body_html: str,
    body_text: str | None,
    to: list[str] | None = None,
    unsubscribe_url: str | None = None,
) -> bool:
    msg = build_message(
        subject, body_html, body_text, smtp_from(), to or settings.digest_to, unsubscribe_url=unsubscribe_url
    )
    # A timeout, because this runs unattended. Without one a half-open connection hangs until the job's own
    # 15-minute limit kills it, turning a transient network fault into a quarter-hour of runner time.
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
        smtp.ehlo()
        # STARTTLS with a verifying context: create_default_context checks the certificate and the hostname,
        # which an unverified connection does not -- and the password goes over this immediately after.
        smtp.starttls(context=ssl.create_default_context())
        smtp.ehlo()
        smtp.login(settings.smtp_user or "", settings.smtp_password or "")
        smtp.send_message(msg)
    return True


def _send_via_resend(
    subject: str,
    body_html: str,
    body_text: str | None,
    to: list[str] | None = None,
    unsubscribe_url: str | None = None,
) -> bool:
    import resend

    resend.api_key = settings.resend_api_key
    payload: dict = {
        # Resend's shared sender reaches only the Resend account's own address. Set DIGEST_FROM to an
        # address on a verified domain to reach anyone else, and to lose the visible "via resend.dev".
        "from": settings.digest_from or "As Amended <onboarding@resend.dev>",
        "to": to or settings.digest_to,
        "subject": subject,
        "html": body_html,
    }
    if body_text:
        payload["text"] = body_text
    if settings.digest_reply_to:
        payload["reply_to"] = settings.digest_reply_to
    headers = _unsubscribe_headers(unsubscribe_url)
    if headers:
        payload["headers"] = headers
    resend.Emails.send(payload)
    return True


def send_digest(
    subject: str,
    body_html: str,
    body_text: str | None = None,
    to: list[str] | None = None,
    unsubscribe_url: str | None = None,
) -> bool:
    """Send it, by whichever transport is configured. False means it did not go.

    SMTP wins when it is configured, and Resend stays as a fallback rather than being deleted -- selected
    by which secrets are present, so a Google lockout or an app password that stops being accepted is a
    secret to change rather than a rewrite to do under pressure.

    Returning False rather than raising is load-bearing. The caller records it against the digest
    watermark, which only advances on a send that worked, so a failure leaves today's findings to be
    carried by tomorrow's mail rather than falling into a window that moved on without them. It also exits
    the workflow non-zero, which is what turns a failed digest into mail from GitHub instead of silence.
    """
    recipients = to if to is not None else settings.digest_to
    if not recipients:
        log.info("no recipients for this digest; skipping")
        return False

    if _smtp_ready():
        try:
            ok = _send_via_smtp(subject, body_html, body_text, recipients, unsubscribe_url)
            log.info("digest sent via SMTP (%s)", settings.smtp_host)
            return ok
        except smtplib.SMTPAuthenticationError as exc:
            # Named separately because the cause is almost never a mistyped password. Gmail refuses a plain
            # account password outright, and an app password requires 2-Step Verification to be on first;
            # both arrive here as the same unhelpful "Username and Password not accepted".
            log.error(
                "SMTP auth refused for %s: %s -- this needs an app password with 2-Step Verification "
                "enabled, not the account password",
                settings.smtp_user,
                exc,
            )
            return False
        except Exception as exc:
            log.error("SMTP send failed via %s: %s", settings.smtp_host, exc)
            return False

    if settings.resend_api_key:
        try:
            ok = _send_via_resend(subject, body_html, body_text, recipients, unsubscribe_url)
            log.info("digest sent via Resend")
            return ok
        except Exception as exc:
            log.error("Resend failed: %s", exc)
            return False

    log.info("no mail transport configured (set SMTP_USER and SMTP_PASSWORD, or RESEND_API_KEY)")
    return False
