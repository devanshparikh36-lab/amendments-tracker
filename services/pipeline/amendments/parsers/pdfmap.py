"""Locate each provision inside the official PDF, so the site can open the regulator's own file at that page.

The pipeline stores the regulator's PDF verbatim in object storage; this module answers "which page does
section 80C start on?" so a reader is taken straight there instead of being asked to trust our transcription.
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
    pages: list[str]                       # normalised text per page (index 0 = page 1)


def _norm(text: str) -> str:
    text = text.replace(" ", " ").replace("–", "-").replace("—", "-")
    text = re.sub(r"[‘’]", "'", text)
    text = re.sub(r"[“”]", '"', text)
    return re.sub(r"\s+", " ", text).strip()


def build_index(data: bytes) -> PdfIndex:
    doc = fitz.open(stream=data, filetype="pdf")
    pages = [_norm(page.get_text("text")) for page in doc]
    count = len(pages)
    doc.close()
    return PdfIndex(page_count=count, pages=pages)


def _candidates(number: str, heading: str | None, level: str) -> list[re.Pattern]:
    """Patterns that mark the *start* of a provision as printed in the official PDF."""
    num = re.escape(number.strip())
    pats: list[str] = []
    if level == "chapter":
        pats.append(rf"\b{num}\b")
    else:
        # "80C." / "80C " / "Section 80C" / "Regulation 17" / "Rule 8" / "Para 4.2"
        pats.append(rf"(?<![\w.]){num}\s*[.)]\s")
        pats.append(rf"\b(?:Section|Regulation|Rule|Para(?:graph)?|Clause)\s+{num}\b")
        pats.append(rf"(?<![\w.]){num}\s*[.)]?\s*[-–—]\s")
    if heading:
        h = _norm(heading)[:60]
        if len(h) > 12:
            pats.append(re.escape(h))
    return [re.compile(p, re.I) for p in pats]


def find_pages(index: PdfIndex, provisions: list, *, start_hint: int = 0) -> int:
    """Set `pdf_page` on each provision (in document order). Returns how many were located.

    Provisions appear in order in the PDF, so the search for the next one starts where the last was found.
    That keeps "17" from matching a cross-reference on page 3 when regulation 17 begins on page 40.
    """
    found = 0
    cursor = start_hint
    for prov in provisions:
        page = _locate(index, prov, cursor)
        if page is None:                      # allow one backward look for out-of-order numbering
            page = _locate(index, prov, max(0, cursor - 3))
        if page is not None:
            prov.pdf_page = page + 1          # 1-based for PDF viewers
            cursor = page
            found += 1
    return found


def _locate(index: PdfIndex, prov, from_page: int) -> int | None:
    patterns = _candidates(prov.number, prov.heading, prov.level)
    if not patterns:
        return None
    heading_pat = patterns[-1] if prov.heading and len(_norm(prov.heading)) > 12 else None
    for page_no in range(from_page, index.page_count):
        text = index.pages[page_no]
        if not text:
            continue
        for pat in patterns:
            if pat.search(text):
                # A heading match alone is strong; a bare number match is accepted too, in order.
                return page_no
        if heading_pat and heading_pat.search(text):
            return page_no
    return None
