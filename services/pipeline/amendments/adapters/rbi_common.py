"""Shared scraping helpers for rbi.org.in listing and detail pages (ASP.NET WebForms site)."""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date, datetime
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from .. import http

log = logging.getLogger(__name__)

RBI_BASE = "https://www.rbi.org.in/Scripts/"

# Attachments are downloaded through a real browser anchored here. RBI sits behind Imperva, which answers a
# scripted PDF request with an HTML interstitial -- "Please enable JavaScript to view the page content" --
# carrying HTTP 200 and a .pdf name. 545 of those were stored as if they were documents before anything
# noticed, so listing pages may be fetched plainly but files must come through the browser session.
RBI_HOME = "https://www.rbi.org.in/"

# PDFs linked from every RBI page (site chrome), never document attachments.
_SITEWIDE_PDF = re.compile(r"/(Accessibility\d*|Utkarsh\d*|GS1093_\d+|GazetteNotification16072019)\.pdf$", re.I)

_DATE_FORMATS = ("%b %d, %Y", "%B %d, %Y", "%d.%m.%Y", "%d-%m-%Y", "%d/%m/%Y", "%B %d %Y", "%d %B %Y", "%d %B, %Y")


def parse_rbi_date(text: str | None) -> date | None:
    if not text:
        return None
    t = re.sub(r"\s+", " ", text).strip().strip("()")
    t = re.sub(r"^(Updated (as on|upto|up to)|Dated|dated)\s*:?\s*", "", t, flags=re.I).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            continue
    m = re.search(r"([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})", t)
    if m:
        for fmt in ("%B %d %Y", "%b %d %Y"):
            try:
                return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", fmt).date()
            except ValueError:
                pass
    m = re.search(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})", t)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


def updated_as_on(text: str) -> date | None:
    """Latest 'Updated as on <date>' found in a title or body."""
    dates = [parse_rbi_date(m) for m in re.findall(r"Updated (?:as on|upto|up to)\s*:?\s*([A-Za-z]+ \d{1,2},? \d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4})", text, flags=re.I)]
    dates = [d for d in dates if d]
    return max(dates) if dates else None


def canonical(url: str, base: str = RBI_BASE) -> str:
    url = urljoin(base, url.strip().strip("'\""))
    url = url.replace("http://", "https://").replace("https://rbi.org.in/", "https://www.rbi.org.in/")
    url = re.sub(r"/scripts/", "/Scripts/", url)
    return url


def soup(html: str) -> BeautifulSoup:
    return BeautifulSoup(html, "lxml")


# ----------------------------------------------------------------------------- archive postback

def hidden_fields(page: BeautifulSoup) -> dict[str, str]:
    fields = {}
    for inp in page.select("input[type=hidden]"):
        name = inp.get("name")
        if name:
            fields[name] = inp.get("value", "")
    return fields


def fetch_archive_year(listing_url: str, year: int, month: int = 0) -> str:
    """Replicate GetYearMonth(year, month): set hdnYear/hdnMonth and submit the hidden button."""
    with http.client() as c:
        first = http.get(listing_url, http=c)
        page = soup(first.text)
        data = hidden_fields(page)
        data["hdnYear"] = str(year)
        data["hdnMonth"] = str(month)
        btn = page.select_one("input#btn")
        if btn is not None and btn.get("name"):
            data[btn["name"]] = btn.get("value", "")
        else:
            data["UsrFontCntr$btn"] = ""
        resp = http.post(listing_url, data, http=c, headers={"Referer": listing_url})
        return resp.text


# ----------------------------------------------------------------------------- listings

@dataclass
class ListingRow:
    title: str
    detail_url: str
    number: str | None
    date_issued: date | None
    pdf_urls: list[str]
    cells: list[str]


def _row_date(tr: Tag) -> date | None:
    header = tr.find(["th", "td"])
    if header is None:
        return None
    classes = header.get("class") or []
    if header.name == "th" or "tableheader" in classes:
        d = parse_rbi_date(header.get_text(" ", strip=True))
        return d
    return None


def parse_listing(html: str, detail_pattern: str) -> list[ListingRow]:
    """Rows of an RBI listing table. Date header rows apply to the rows that follow them."""
    page = soup(html)
    rows: list[ListingRow] = []
    current_date: date | None = None
    for tr in page.find_all("tr"):
        d = _row_date(tr)
        if d and len(tr.find_all(["td", "th"])) <= 1:
            current_date = d
            continue
        link = None
        for a in tr.find_all("a", href=True):
            if detail_pattern.lower() in a["href"].lower():
                link = a
                break
        if link is None:
            continue
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        title = re.sub(r"\s+", " ", link.get_text(" ", strip=True)).strip()
        if not title and link.parent is not None:
            title = re.sub(r"\s+", " ", link.parent.get_text(" ", strip=True)).strip()
        pdfs = [
            canonical(a["href"]) for a in tr.find_all("a", href=True)
            if a["href"].lower().endswith(".pdf") and not _SITEWIDE_PDF.search(a["href"])
        ]
        number = cells[1].strip() if len(cells) > 1 and cells[1].strip() and not cells[1].lower().endswith(".pdf") else None
        rows.append(ListingRow(title=title, detail_url=canonical(link["href"]), number=number, date_issued=current_date, pdf_urls=pdfs, cells=cells))
    return rows


# ----------------------------------------------------------------------------- detail pages

def _render_block(el: Tag) -> list[str]:
    """Flatten a content block to text lines, keeping table rows readable."""
    lines: list[str] = []
    if el.name == "table":
        for tr in el.find_all("tr"):
            cells = [re.sub(r"\s+", " ", td.get_text(" ", strip=True)) for td in tr.find_all(["td", "th"])]
            cells = [c for c in cells if c]
            if cells:
                lines.append(" | ".join(cells))
        return lines
    text = re.sub(r"[ \t\xa0]+", " ", el.get_text(" ", strip=True)).strip()
    if text:
        lines.append(text)
    return lines


def content_container(page: BeautifulSoup) -> Tag | None:
    head = page.select_one("p.head")
    if head is not None:
        for anc in head.parents:
            if isinstance(anc, Tag) and anc.name == "table" and "td" in (anc.get("class") or []):
                return anc
    best = None
    for t in page.select("table.tablebg, table.td"):
        n = len(t.get_text(" ", strip=True))
        if best is None or n > best[0]:
            best = (n, t)
    return best[1] if best else None


def extract_detail(html: str, page_url: str) -> tuple[str, list[str], str | None]:
    """Return (verbatim body text, attachment PDF urls inside the content, heading)."""
    page = soup(html)
    for bad in page.select("script, style, noscript"):
        bad.decompose()
    container = content_container(page)
    if container is None:
        return "", [], None

    heading_el = container.select_one("p.head")
    heading = re.sub(r"\s+", " ", heading_el.get_text(" ", strip=True)) if heading_el else None

    lines: list[str] = []
    seen_tables: set[int] = set()
    for el in container.descendants:
        if not isinstance(el, Tag):
            continue
        if el.name in ("p", "li", "h1", "h2", "h3", "h4", "h5", "h6"):
            # skip text that belongs to a nested table handled separately
            if el.find_parent("table") is not container and el.find_parent("table") is not None and el.find_parent("table") is not container.find_parent("table"):
                inner = el.find_parent("table")
                if inner is not container and id(inner) in seen_tables:
                    continue
            lines.extend(_render_block(el))
        elif el.name == "table" and el is not container:
            # nested data tables (limits, formats): render as rows once, and mark so their <p> are skipped
            if el.find("p") and len(el.find_all("tr")) < 3:
                continue
            seen_tables.add(id(el))
            lines.extend(_render_block(el))

    # De-duplicate consecutive identical lines (nested table rendering can repeat a paragraph)
    out: list[str] = []
    for ln in lines:
        if out and out[-1] == ln:
            continue
        out.append(ln)
    text = "\n".join(out).strip()

    pdfs: list[str] = []
    for a in container.find_all("a", href=True):
        href = a["href"]
        if re.search(r"\.pdf(\?|$)", href, re.I) and not _SITEWIDE_PDF.search(href):
            url = canonical(href, page_url)
            if url not in pdfs:
                pdfs.append(url)
    return text, pdfs, heading


def filename_from_url(url: str) -> str:
    name = url.rsplit("/", 1)[-1].split("?")[0]
    return name or "file.pdf"
