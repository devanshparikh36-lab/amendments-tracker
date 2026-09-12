"""RBI > Notifications (circular index): A.P. (DIR Series) circulars issued by the Foreign Exchange Department."""
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
    parse_rbi_date,
    soup,
)

log = logging.getLogger(__name__)

LISTING_URL = RBI_BASE + "BS_CircularIndexDisplay.aspx"
DETAIL_PATTERN = "BS_CircularIndexDisplay.aspx?Id="
_APDIR = re.compile(r"A\.?\s*P\.?\s*\(DIR Series\)\s*Circular\s*No\.?\s*\d+[A-Z]?", re.I)
_DATE_LINE = re.compile(r"([A-Z][a-z]+ \d{1,2}, \d{4})")


def _parse_rows(html: str) -> list[DiscoveredDocument]:
    page = soup(html)
    docs: list[DiscoveredDocument] = []
    for tr in page.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 4:
            continue
        link = tds[0].find("a", href=True)
        if link is None or DETAIL_PATTERN.lower() not in link["href"].lower():
            continue
        number_blob = tds[0].get_text(" ", strip=True)
        department = tds[2].get_text(" ", strip=True) if len(tds) > 2 else ""
        if not _APDIR.search(number_blob) and "Foreign Exchange" not in department:
            continue
        m = _APDIR.search(number_blob)
        number = re.sub(r"\s+", " ", m.group(0)) if m else number_blob
        rbi_ref = re.search(r"RBI/\d{4}-\d{2,4}/\d+", number_blob)
        pdfs = [canonical(a["href"]) for a in tr.find_all("a", href=True) if a["href"].lower().endswith(".pdf")]
        docs.append(
            DiscoveredDocument(
                source_url=canonical(link["href"]),
                title=tds[3].get_text(" ", strip=True),
                doc_type="apdir_circular",
                number=number,
                date_issued=parse_rbi_date(tds[1].get_text(" ", strip=True)),
                pdf_urls=pdfs,
                extra={"rbi_ref": rbi_ref.group(0) if rbi_ref else None, "meant_for": tds[4].get_text(" ", strip=True) if len(tds) > 4 else None},
            )
        )
    return docs


class RbiApDirCirculars(Adapter):
    name = "rbi_apdir"
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
            for d in _parse_rows(html):
                out.setdefault(d.source_url, d)
        return list(out.values())

    def fetch(self, doc: DiscoveredDocument) -> FetchedDocument:
        html = http.get_text(doc.source_url)
        text, pdfs, heading = extract_detail(html, doc.source_url)
        number = doc.number
        if not number:
            m = _APDIR.search(text[:1500])
            number = re.sub(r"\s+", " ", m.group(0)) if m else None
        issued = doc.date_issued
        if not issued:
            m = _DATE_LINE.search(text[:1500])
            issued = parse_rbi_date(m.group(1)) if m else None
        attachments = []
        for i, url in enumerate(list(doc.pdf_urls) + pdfs):
            url = canonical(url, doc.source_url)
            if any(a.source_url == url for a in attachments):
                continue
            attachments.append(FetchedAttachment(source_url=url, filename=filename_from_url(url), is_primary=(i == 0)))
        return FetchedDocument(
            raw_html=html, body_text=text, attachments=attachments, date_issued=issued, number=number, title=heading or doc.title
        )
