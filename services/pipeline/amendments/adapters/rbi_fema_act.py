"""FEMA Act, 1999 baseline text.

RBI's Act page (https://www.rbi.org.in/scripts/Act.aspx) does not host the FEMA text; it links to the Government of
India's India Code repository. This seeder follows RBI's link to wherever RBI points (official by RBI's own reference),
downloads the Act as PDF or HTML, and returns the text. `text_url` in the seed config overrides the link.
"""
from __future__ import annotations

import json

import logging
import re
from datetime import date

from .. import http
from ..parsers.pdf import extract_pdf_text
from .base import SeedResult
from .rbi_common import canonical, soup

log = logging.getLogger(__name__)

RBI_ACT_PAGE = "https://www.rbi.org.in/scripts/Act.aspx"


def _find_fema_link(html: str) -> str | None:
    page = soup(html)
    for a in page.find_all("a", href=True):
        if re.search(r"Foreign Exchange Management Act", a.get_text(" ", strip=True), re.I):
            return canonical(a["href"], RBI_ACT_PAGE)
    return None


_ITEM_UUID = re.compile(r"/(?:items|handle)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", re.I)

_ARRANGEMENT = re.compile(r"ARRANGEMENT\s+OF\s+SECTIONS", re.I)
# "1. Short title, extent, application and commencement.—(1) This Act may be called ..." -- a numbered
# heading followed by actual provision text, which is what the body has and the contents list does not.
_BODY_START = re.compile(r"\n\s*1\.\s+[A-Z][^\n]{8,120}?[.—–-]{1,2}\s*\(1\)", re.S)


def _drop_arrangement_of_sections(text: str) -> str:
    """Cut the contents listing off the front of an Act.

    India Code prints an ARRANGEMENT OF SECTIONS before the Act itself: every section number and heading,
    one per line, with no text under any of them. A section splitter reads that first and takes it, so the
    Act seeds as 150 provisions whose entire content is "2. Definitions." -- which looks like a complete Act
    and is a table of contents. That is worse than having no text, because it is wrong rather than absent.

    The body is found by the thing that distinguishes it: section 1 followed by a sub-section, not by the
    next heading. If the text does not look like it has a contents block, or the body cannot be located, it
    is returned untouched -- a wrong cut would silently delete the opening sections.
    """
    if not _ARRANGEMENT.search(text[:4000]):
        return text
    body = _BODY_START.search(text)
    if not body:
        log.warning("FEMA Act: an arrangement of sections is present but the body could not be located; keeping all of it")
        return text
    # Back up to the chapter heading that introduces the body, so Chapter I is not lost with the contents.
    start = body.start()
    chapter = text.rfind("CHAPTER", max(0, start - 400), start)
    cut = chapter if chapter != -1 else start
    log.info("FEMA Act: dropped %d characters of arrangement-of-sections before the text", cut)
    return text[cut:]


def _indiacode_api(url: str, path: str) -> dict:
    base = re.sub(r"^(https?://[^/]+).*$", r"\1", url)
    import json

    return json.loads(http.get_text(f"{base}/server/api/core/{path}"))


def _act_text_from_indiacode(url: str) -> tuple[str, bytes | None, str | None]:
    """India Code item -> the Act's text, through the repository's own API.

    India Code was rebuilt as a DSpace 7 front end, which is an Angular application: the item page is a
    6.7 KB shell carrying ten characters of visible text, and the bitstream links the old scrape looked for
    are not in the HTML at all because the page builds itself in the browser. That is why this returned
    "too little text (0 chars)" and the FEMA Act has never had any text, while 730 documents cite it.

    DSpace publishes a REST API underneath, and it answers plainly. An item has bundles; the bundles hold
    bitstreams; ORIGINAL is the scanned Act and TEXT is the repository's own extraction of it.

    TEXT is preferred over running the PDF through our own OCR. Both end up as extracted text rather than a
    natively published Act, so neither is the regulator's rendering -- but one of them is the government
    repository's own extraction and the other is ours. Where the choice is between somebody else's errors
    in statutory text and our own, the source's win.
    """
    m = _ITEM_UUID.search(url)
    if not m:
        # Not an item URL: fall back to reading whatever the page holds.
        page = soup(http.get_text(url))
        body = page.select_one("#main, .main, body")
        return (body.get_text("\n", strip=True) if body else page.get_text("\n", strip=True)), None

    uuid = m.group(1)
    bundles = _indiacode_api(url, f"items/{uuid}/bundles").get("_embedded", {}).get("bundles", [])
    wanted: dict[str, str] = {}
    for b in bundles:
        name = (b.get("name") or "").upper()
        href = (b.get("_links", {}).get("bitstreams") or {}).get("href")
        if not href or name not in ("TEXT", "ORIGINAL"):
            continue
        listed = json.loads(http.get_text(href)).get("_embedded", {}).get("bitstreams", [])
        for bit in listed:
            content = (bit.get("_links", {}).get("content") or {}).get("href")
            if content:
                wanted.setdefault(name, content)
                break

    # The official file is what is served, so it is always fetched. The text comes back alongside it for
    # the page index and for search; it is never shown as the Act.
    pdf_bytes = pdf_url = None
    if "ORIGINAL" in wanted:
        pdf_bytes, _ = http.get_bytes(wanted["ORIGINAL"])
        pdf_url = wanted["ORIGINAL"]

    text = ""
    if "TEXT" in wanted:
        raw, _ = http.get_bytes(wanted["TEXT"])
        text = _drop_arrangement_of_sections(raw.decode("utf-8", "replace"))
        log.info("FEMA Act: %d characters from India Code's own text bundle", len(text))
    elif pdf_bytes:
        parsed = extract_pdf_text(pdf_bytes)
        text = parsed.text
        log.info("FEMA Act: %d characters read from the official PDF (ocr=%s)", len(text), parsed.ocr_used)

    if not text and not pdf_bytes:
        raise RuntimeError(f"India Code item {uuid} exposes neither a TEXT nor an ORIGINAL bitstream")
    return text, pdf_bytes, pdf_url


def official_text(instrument: dict, cfg: dict) -> SeedResult:
    """The Act as the Government publishes it: the official file, with its text alongside for searching.

    Served as a PDF (`pdf_only` in the seed config), for the same reason SEBI's Acts are. India Code holds
    this as a scan whose pages interleave footnotes with the body, so a section splitter reads
    "3. Ins. by Act 20 of 2015, s. 138" as section 3 and files a footnote about one section under the number
    of another. Ninety provisions came out of a forty-nine-section Act, several holding the wrong text.
    Publishing that would be worse than publishing nothing, because it would look right.

    The text still matters -- it is what the page index is built from, so the Act is searchable and its
    definitions findable -- it is simply never presented as the Act itself.
    """
    url = cfg.get("text_url")
    if not url:
        url = _find_fema_link(http.get_text(RBI_ACT_PAGE))
        if not url:
            raise RuntimeError("RBI Act page no longer links to the Foreign Exchange Management Act")

    pdf_bytes: bytes | None = None
    pdf_url: str | None = None
    if url.lower().endswith(".pdf"):
        pdf_bytes, _ = http.get_bytes(url)
        pdf_url = url
        text = extract_pdf_text(pdf_bytes).text
    elif "indiacode" in url:
        text, pdf_bytes, pdf_url = _act_text_from_indiacode(url)
    else:
        text = soup(http.get_text(url)).get_text("\n", strip=True)

    if len(text) < 5000 and not pdf_bytes:
        raise RuntimeError(f"FEMA Act source {url} returned too little text ({len(text)} chars)")
    m = re.search(r"as (?:amended|on|updated)\s*(?:up to|upto|as on)?\s*([A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4})", text[:5000], re.I)
    from .rbi_common import parse_rbi_date

    return SeedResult(
        text=text,
        updated_as_on=parse_rbi_date(m.group(1)) if m else None,
        source_url=url,
        pdf_bytes=pdf_bytes,
        pdf_url=pdf_url,
    )
