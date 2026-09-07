"""Locate each provision inside the official PDF, so the site can open the regulator's own file at that page.

A wrong page is worse than no page: a reader who lands on the wrong regulation loses trust in everything else
on the site. So this matcher is deliberately conservative. It anchors on the provision's *heading* next to its
number ("17. Board of Directors"), which is how these documents actually print a provision, and it refuses to
guess from a bare number: page furniture (the page number itself, cross-references, tables of contents) is full
of bare numbers and that is exactly what produced wrong answers before.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass

import fitz  # PyMuPDF

log = logging.getLogger(__name__)


@dataclass
class PdfIndex:
    page_count: int
    pages: list[str]        # text per page, line structure preserved (index 0 = page 1)
    flat: list[str]         # same text collapsed to one line, for heading searches


def _norm(text: str) -> str:
    text = text.replace("\xa0", " ").replace("–", "-").replace("—", "-")
    text = re.sub(r"[‘’]", "'", text)
    text = re.sub(r"[“”]", '"', text)
    text = re.sub(r"\[\d{1,3}\]|\b\d{1,3}\[", " ", text)      # amendment footnote markers: 109[and]
    return text


def _strip_page_furniture(text: str) -> str:
    """Drop the printed page number that starts most official PDFs' pages, plus running headers."""
    lines = text.split("\n")
    while lines and (not lines[0].strip() or re.fullmatch(r"\s*\d{1,4}\s*", lines[0])):
        lines = lines[1:]
    if lines and re.match(r"^\s*\d{1,4}\s+\S", lines[0]):
        lines[0] = re.sub(r"^\s*\d{1,4}\s+", "", lines[0])
    return "\n".join(lines)


def build_index(data: bytes) -> PdfIndex:
    doc = fitz.open(stream=data, filetype="pdf")
    pages, flat = [], []
    for page in doc:
        raw = _strip_page_furniture(_norm(page.get_text("text")))
        pages.append(raw)
        flat.append(re.sub(r"\s+", " ", raw).strip())
    doc.close()
    return PdfIndex(page_count=len(pages), pages=pages, flat=flat)


def _heading_words(heading: str | None) -> str | None:
    """First few words of the heading, as a loose regex, or None when the heading is too generic to anchor on."""
    if not heading:
        return None
    words = re.findall(r"[A-Za-z][A-Za-z'-]+", heading)
    if len(words) < 2:
        return None
    take = words[:6]
    if sum(len(w) for w in take) < 12:
        return None
    return r"\s+".join(re.escape(w) for w in take)


_STOP_PREFIX = re.compile(r"^\s*(?:Regulation|Rule|Section|Para(?:graph)?|Clause)?\s*[\dA-Z().\- ]{0,12}\.?\s*", re.I)


def _text_anchor(text: str | None, *, words: int = 12) -> re.Pattern | None:
    """A distinctive phrase from the provision's own text.

    The text we hold was extracted from this very document, so a phrase from its opening is the most reliable
    way back to the page it sits on - far safer than a bare provision number, which appears all over the file.
    """
    if not text:
        return None
    body = _STOP_PREFIX.sub("", re.sub(r"\s+", " ", _norm(text)).strip(), count=1)
    tokens = re.findall(r"[A-Za-z][A-Za-z'-]+|\d+", body)
    if len(tokens) < 5:
        return None
    take = tokens[:words]
    if sum(len(t) for t in take) < 25:
        return None
    return re.compile(r"\s*".join(re.escape(t) for t in take), re.I)


def _anchors(number: str, heading: str | None) -> list[re.Pattern]:
    """Patterns that mark a provision actually beginning, strongest first."""
    num = re.escape(number.strip())
    words = _heading_words(heading)
    out: list[re.Pattern] = []
    if words:
        # "17. Board of Directors" / "17 Board of Directors" / "Regulation 17. Board of Directors"
        out.append(re.compile(rf"(?:^|\n)\s*(?:Regulation|Rule|Section|Para(?:graph)?)?\s*{num}\s*[.)]?\s*{words}", re.I | re.M))
        # heading on its own line (some documents print the number on the previous line)
        out.append(re.compile(rf"(?:^|\n)\s*{words}", re.I | re.M))
    # A numbered provision opening a line and continuing into a sentence: "17. (1) The board of directors..."
    out.append(re.compile(rf"(?:^|\n)\s*{num}\s*\.\s*(?=\(|[A-Z])", re.M))
    return out


def find_pages(index: PdfIndex, provisions: list) -> int:
    """Set `pdf_page` (1-based) on provisions we can locate confidently. Returns how many were set.

    Provisions run in order through the document, so each search starts where the previous one matched and only
    the strongest anchor is trusted. Anything not found keeps `pdf_page` unset rather than being guessed at.
    """
    found = 0
    cursor = 0
    for prov in provisions:
        anchors: list[re.Pattern] = []
        # The provision's own words are the strongest anchor; the number alone is the weakest and is only
        # consulted when the text gives us nothing.
        text_anchor = _text_anchor(getattr(prov, "text", None))
        if text_anchor is not None:
            anchors.append(text_anchor)
        anchors.extend(_anchors(prov.number, getattr(prov, "heading", None)))
        page = _locate(index, anchors, cursor)
        if page is None and cursor:                     # allow a short look back for out-of-order numbering
            page = _locate(index, anchors, 0, limit=cursor)
        if page is None:
            continue
        prov.pdf_page = page + 1
        cursor = page
        found += 1
    return found


def _locate(index: PdfIndex, anchors: list[re.Pattern], from_page: int, limit: int | None = None) -> int | None:
    end = index.page_count if limit is None else min(limit, index.page_count)
    for i, anchor in enumerate(anchors):                # strongest anchor across the whole range first
        for page_no in range(from_page, end):
            # A phrase can straddle a page break, so search the flattened text of this page and the next.
            haystack = index.flat[page_no]
            if i == 0 and page_no + 1 < index.page_count:
                haystack = haystack + " " + index.flat[page_no + 1][:400]
            if haystack and anchor.search(haystack):
                return page_no
    return None


def verify(index: PdfIndex, provisions: list, sample: int = 12) -> list[tuple[str, int, bool]]:
    """Spot-check that a located page really does contain the provision's heading. For tests and diagnostics."""
    checked: list[tuple[str, int, bool]] = []
    for prov in [p for p in provisions if getattr(p, "pdf_page", None)][:sample]:
        words = _heading_words(getattr(prov, "heading", None))
        if not words:
            continue
        page_text = index.flat[prov.pdf_page - 1]
        checked.append((prov.number, prov.pdf_page, bool(re.search(words, page_text, re.I))))
    return checked
