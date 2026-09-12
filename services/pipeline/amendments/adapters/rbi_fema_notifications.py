"""RBI > Notifications > FEMA: FEM Regulations issued by RBI and Central Government GSR notifications (FEM Rules)."""
from __future__ import annotations

import logging
import re
from datetime import date

from .. import http
from .base import Adapter, DiscoveredDocument, FetchedAttachment, FetchedDocument
from .rbi_common import (
    RBI_HOME,
    RBI_BASE,
    canonical,
    extract_detail,
    fetch_archive_year,
    filename_from_url,
    parse_listing,
    parse_rbi_date,
)

log = logging.getLogger(__name__)

LISTING_URL = RBI_BASE + "BS_FemaNotifications.aspx"
DETAIL_PATTERN = "BS_FemaNotifications.aspx?Id="

_NUMBER_RES = [
    re.compile(r"(?:Notification\s+No\.?\s*)?(FEMA\.?\s*[\dA-Z()/.\- ]*?\d{4}\s*-\s*RB)", re.I),
    re.compile(r"(G\.?\s*S\.?\s*R\.?\s*\d+\s*\(E\))", re.I),
    re.compile(r"(No\.\s*FEMA[^\n,;]*)", re.I),
]
_DATE_LINE = re.compile(r"(?:Dated|dated)?\s*:?\s*([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}(?:st|nd|rd|th)? [A-Z][a-z]+,? \d{4})")
_EFFECTIVE = re.compile(
    r"(?:come into force|shall be effective|w\.e\.f\.|with effect from)\s*(?:on|from|the)?\s*"
    r"([A-Z][a-z]+ \d{1,2}, \d{4}|\d{1,2}(?:st|nd|rd|th)? [A-Z][a-z]+,? \d{4}|the date of (?:their|its) publication in the Official Gazette)",
    re.I,
)


def classify(title: str, number: str | None) -> str:
    blob = f"{title} {number or ''}"
    if re.search(r"G\.?\s*S\.?\s*R\.?|Rules,? \d{4}|Central Government|Ministry of Finance", blob, re.I):
        return "gsr"
    if re.search(r"Corrigendum", blob, re.I):
        return "notification"
    return "notification"


def clean_number(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = re.sub(r"\s+", " ", raw).strip()
    raw = re.sub(r"^Notification No\.?\s*", "", raw, flags=re.I)
    return raw or None


class RbiFemaNotifications(Adapter):
    name = "rbi_fema_notifications"
    regulator_code = "RBI"
    # Files only: discovery still uses plain HTTP. See RBI_HOME in rbi_common.
    needs_browser = True
    browser_home = RBI_HOME

    def discover(self, *, since_year: int | None = None) -> list[DiscoveredDocument]:
        pages = [http.get_text(LISTING_URL)]
        if since_year:
            for year in range(since_year, date.today().year):
                try:
                    pages.append(fetch_archive_year(LISTING_URL, year))
                except Exception as exc:
                    log.warning("archive year %s failed: %s", year, exc)
        out: dict[str, DiscoveredDocument] = {}
        for html in pages:
            for row in parse_listing(html, DETAIL_PATTERN):
                number = clean_number(row.number)
                # the listing sometimes puts junk like 'rbi' or 'RBI10R' in the number column
                if number and not re.search(r"\d", number):
                    number = None
                d = DiscoveredDocument(
                    source_url=row.detail_url,
                    title=row.title,
                    doc_type=classify(row.title, number),
                    number=number,
                    date_issued=row.date_issued,
                    pdf_urls=row.pdf_urls,
                )
                out.setdefault(d.source_url, d)
        return list(out.values())

    def fetch(self, doc: DiscoveredDocument) -> FetchedDocument:
        html = http.get_text(doc.source_url)
        text, pdfs, heading = extract_detail(html, doc.source_url)
        number = doc.number
        if not number:
            for rx in _NUMBER_RES:
                m = rx.search(text[:3000])
                if m:
                    number = clean_number(m.group(1))
                    break
        issued = doc.date_issued
        if not issued:
            m = _DATE_LINE.search(text[:2000])
            if m:
                issued = parse_rbi_date(re.sub(r"(\d)(st|nd|rd|th)", r"\1", m.group(1)))
        effective = None
        m = _EFFECTIVE.search(text)
        if m and "publication" not in m.group(1).lower():
            effective = parse_rbi_date(re.sub(r"(\d)(st|nd|rd|th)", r"\1", m.group(1)))
        attachments = []
        primary_marked = False
        for url in list(doc.pdf_urls) + pdfs:
            url = canonical(url, doc.source_url)
            if any(a.source_url == url for a in attachments):
                continue
            is_primary = (not primary_marked) and "/rdocs/notification/" in url.lower()
            if is_primary:
                primary_marked = True
            attachments.append(FetchedAttachment(source_url=url, filename=filename_from_url(url), is_primary=is_primary))
        if attachments and not primary_marked:
            attachments[0].is_primary = True
        return FetchedDocument(
            raw_html=html, body_text=text, attachments=attachments, date_issued=issued, date_effective=effective,
            number=number, title=doc.title or heading,
        )
