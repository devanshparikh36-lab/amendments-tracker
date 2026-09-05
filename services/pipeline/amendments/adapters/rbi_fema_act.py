"""FEMA Act, 1999 baseline text.

RBI's Act page (https://www.rbi.org.in/scripts/Act.aspx) does not host the FEMA text; it links to the Government of
India's India Code repository. This seeder follows RBI's link to wherever RBI points (official by RBI's own reference),
downloads the Act as PDF or HTML, and returns the text. `text_url` in the seed config overrides the link.
"""
from __future__ import annotations

import logging
import re
from datetime import date

from .. import http
from ..parsers.pdf import extract_pdf_text
from .rbi_common import canonical, soup

log = logging.getLogger(__name__)

RBI_ACT_PAGE = "https://www.rbi.org.in/scripts/Act.aspx"


def _find_fema_link(html: str) -> str | None:
    page = soup(html)
    for a in page.find_all("a", href=True):
        if re.search(r"Foreign Exchange Management Act", a.get_text(" ", strip=True), re.I):
            return canonical(a["href"], RBI_ACT_PAGE)
    return None


def _act_text_from_indiacode(url: str) -> tuple[str, date | None]:
    """India Code item page -> the Act PDF (bitstream) or section-wise HTML."""
    html = http.get_text(url)
    page = soup(html)
    pdf = None
    for a in page.find_all("a", href=True):
        href = a["href"]
        if re.search(r"\.pdf(\?|$)", href, re.I) and "bitstream" in href:
            pdf = canonical(href, url)
            break
    if pdf:
        data, _ = http.get_bytes(pdf)
        return extract_pdf_text(data).text, None
    body = page.select_one("#main, .main, body")
    return (body.get_text("\n", strip=True) if body else page.get_text("\n", strip=True)), None


def official_text(instrument: dict, cfg: dict) -> tuple[str, date | None, str]:
    url = cfg.get("text_url")
    if not url:
        url = _find_fema_link(http.get_text(RBI_ACT_PAGE))
        if not url:
            raise RuntimeError("RBI Act page no longer links to the Foreign Exchange Management Act")
    if url.lower().endswith(".pdf"):
        data, _ = http.get_bytes(url)
        text = extract_pdf_text(data).text
    elif "indiacode" in url:
        text, _ = _act_text_from_indiacode(url)
    else:
        text = soup(http.get_text(url)).get_text("\n", strip=True)
    if len(text) < 5000:
        raise RuntimeError(f"FEMA Act source {url} returned too little text ({len(text)} chars)")
    m = re.search(r"as (?:amended|on|updated)\s*(?:up to|upto|as on)?\s*([A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4})", text[:5000], re.I)
    from .rbi_common import parse_rbi_date

    return text, (parse_rbi_date(m.group(1)) if m else None), url
