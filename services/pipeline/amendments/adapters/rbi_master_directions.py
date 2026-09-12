"""RBI Master Directions: the regulator's own consolidated text. Used both as documents and as the seed/self-check source."""
from __future__ import annotations

import logging
import re
from datetime import date

from .. import http
from ..instruments import FEMA_MD_TITLE_PATTERNS
from .base import Adapter, DiscoveredDocument, FetchedAttachment, FetchedDocument, SeedResult
from .rbi_common import RBI_BASE, RBI_HOME, canonical, extract_detail, filename_from_url, parse_listing, updated_as_on

log = logging.getLogger(__name__)

LISTING_URL = RBI_BASE + "BS_ViewMasDirections.aspx"
DETAIL_PATTERN = "BS_ViewMasDirections.aspx?id="
_FEMA_TITLE = re.compile("|".join(FEMA_MD_TITLE_PATTERNS), re.I)
_EXCLUDE = re.compile(r"Prudential Norms|Mortgage Guarantee|Commercial Banks|NBFC|Co-operative|Payment|Credit Card|KYC|Know Your Customer|Priority Sector|Gold|Financial Statements|Interest Rate on|Dividend", re.I)


def is_fema_master_direction(title: str) -> bool:
    return bool(_FEMA_TITLE.search(title)) and not _EXCLUDE.search(title)


def md_detail_url(rbi_md_id: int) -> str:
    return f"{LISTING_URL}?id={rbi_md_id}"


class RbiMasterDirections(Adapter):
    name = "rbi_master_directions"
    regulator_code = "RBI"
    # Files only: discovery still uses plain HTTP. See RBI_HOME in rbi_common.
    needs_browser = True
    browser_home = RBI_HOME

    def discover(self, *, since_year: int | None = None) -> list[DiscoveredDocument]:
        html = http.get_text(LISTING_URL)
        out: dict[str, DiscoveredDocument] = {}
        for row in parse_listing(html, DETAIL_PATTERN):
            title = re.sub(r"\s*\(Supersedes.*$", "", row.title).strip()
            if not is_fema_master_direction(title):
                continue
            # the listing can repeat a superseded MD inside the row; keep the row's own detail link
            out.setdefault(
                row.detail_url,
                DiscoveredDocument(
                    source_url=row.detail_url,
                    title=title,
                    doc_type="master_direction",
                    number=None,
                    date_issued=row.date_issued,
                    pdf_urls=row.pdf_urls,
                    extra={"updated_as_on": updated_as_on(title)},
                ),
            )
        return list(out.values())

    def fetch(self, doc: DiscoveredDocument) -> FetchedDocument:
        html = http.get_text(doc.source_url)
        text, pdfs, heading = extract_detail(html, doc.source_url)
        number = None
        m = re.search(r"(RBI/FED/\d{4}-\d{2}/\d+|FED Master Direction No\.?\s*\d+/\d{4}-\d{2})", text[:1500])
        if m:
            number = m.group(1)
        upd = updated_as_on(text[:3000]) or doc.extra.get("updated_as_on")
        attachments = []
        for i, url in enumerate(list(doc.pdf_urls) + pdfs):
            url = canonical(url, doc.source_url)
            if any(a.source_url == url for a in attachments):
                continue
            attachments.append(FetchedAttachment(source_url=url, filename=filename_from_url(url), is_primary=(i == 0)))
        return FetchedDocument(
            raw_html=html, body_text=text, attachments=attachments, date_issued=doc.date_issued, number=number,
            title=doc.title or heading, updated_as_on=upd,
        )


def official_text(instrument: dict, cfg: dict) -> SeedResult:
    """Consolidated text of a Master Direction from its HTML detail page, with RBI's own PDF alongside.

    RBI publishes each Master Direction as both a web page and a PDF. The page parses cleanly, so it supplies
    the provisions; the PDF is kept as the document a reader can open and cite, and as the fallback when a
    particular direction's layout defeats the parser.
    """
    url = md_detail_url(cfg["rbi_md_id"]) if cfg.get("rbi_md_id") else instrument["official_url"]
    html = http.get_text(url)
    text, pdfs, _heading = extract_detail(html, url)
    if len(text) < 2000:
        raise RuntimeError(f"Master Direction page {url} returned too little text ({len(text)} chars)")
    pdf_bytes = pdf_url = None
    for candidate in pdfs:
        try:
            data, _ = http.get_bytes(candidate)
        except Exception as exc:
            log.warning("%s: could not fetch %s: %s", instrument.get("slug"), candidate, str(exc)[:80])
            continue
        if data[:4] == b"%PDF":
            pdf_bytes, pdf_url = data, candidate
            break
    return SeedResult(
        text=text,
        updated_as_on=updated_as_on(text[:3000]) or date.today(),
        source_url=url,
        pdf_bytes=pdf_bytes,
        pdf_url=pdf_url,
    )
