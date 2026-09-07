"""SEBI - www.sebi.gov.in > Legal (Acts, Regulations, Master Circulars, Circulars).

The public site is a Struts app. Two things matter:

  * `/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=<N>&smid=0` renders a listing page. `ssid` selects the
    Legal sub-section: 1 Acts, 2 Rules, 3 Regulations, 4 General Orders, 5 Guidelines, 6 Master Circulars,
    7 Circulars. Only the first 25 rows are on that page.
  * the page's own pagination calls `POST /sebiweb/ajax/home/getnewslistinfo.jsp` (see `js/entry.js`,
    `searchFormNewsList`) and renders the reply. That is the endpoint this adapter uses: `doDirect` is the
    zero-based page index and `fromDate`/`toDate` (dd-mm-yyyy) filter by issue date.

Detail pages (`/legal/<section>/<mon-yyyy>/<slug>_<entryId>.html`) are plain HTML: `<h1>` title,
`div.date_value` date, `div.id_area` circular number, and the document itself in an `<iframe>` pointing at
`/web/?file=<pdf>`. Almost everything SEBI publishes is a PDF, so `body_text` is usually empty and the pipeline
falls back to the primary PDF's extracted text.

SEBI publishes each Regulation as one consolidated "[Last amended on <date>]" PDF, so a Regulation (and an Act) is
both a document and the instrument's official text; `official_text()` re-reads it for the seeder / self-check.
"""
from __future__ import annotations

import logging
import re
from datetime import date
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup

from .. import http
from .base import Adapter, DiscoveredDocument, FetchedAttachment, FetchedDocument, SeedResult
from .rbi_common import parse_rbi_date as parse_date  # generic "Aug 24, 2026" / "24-08-2026" parser

log = logging.getLogger(__name__)

BASE = "https://www.sebi.gov.in"
LISTING_URL = BASE + "/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid={ssid}&smid=0"
AJAX_URL = BASE + "/sebiweb/ajax/home/getnewslistinfo.jsp"

SSID = {"acts": 1, "rules": 2, "regulations": 3, "guidelines": 5, "master_circulars": 6, "circulars": 7}
PAGE_SIZE = 25
MAX_PAGES = 400

# Well-known instruments get a stable slug so tagging and the seed list agree. First match wins.
INSTRUMENT_SLUGS: list[tuple[str, str, str]] = [
    (r"^Securities and Exchange Board of India Act,?\s*1992", "sebi-act-1992", "SEBI-ACT"),
    (r"^Securities Contracts \(Regulation\) Act,?\s*1956", "scra-1956", "SCRA"),
    (r"^Depositories Act,?\s*1996", "depositories-act-1996", "DEP-ACT"),
    (r"Listing Obligations and Disclosure Requirements", "sebi-lodr-2015", "SEBI-LODR"),
    (r"Issue of Capital and Disclosure Requirements", "sebi-icdr-2018", "SEBI-ICDR"),
    (r"Substantial Acquisition of Shares and Takeovers", "sebi-sast-2011", "SEBI-SAST"),
    (r"Prohibition of Insider Trading", "sebi-pit-2015", "SEBI-PIT"),
    # SEBI's own titles sometimes drop the closing bracket ("(Alternative Investment Funds Regulations, 2012")
    (r"\(Mutual Funds\b", "sebi-mutual-funds", "SEBI-MF"),
    (r"\(Alternative Investment Funds\b", "sebi-aif-2012", "SEBI-AIF"),
    (r"\(Portfolio Managers\b", "sebi-portfolio-managers-2020", "SEBI-PMS"),
    (r"Buy-?Back of Securities", "sebi-buyback-2018", "SEBI-BUYBACK"),
    (r"Delisting of Equity Shares", "sebi-delisting-2021", "SEBI-DELISTING"),
]

_LAST_AMENDED = re.compile(
    r"\[?\s*[Ll]ast amended (?:on|as on)?\s*(?:on\s*)?(?P<d>[A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4})",
)
_CIRCULAR_NO = re.compile(r"(?:Circular|Notification)\s*No\.?\s*:?\s*(?P<num>\S.{0,120}?)\s*$", re.I)
_EFFECTIVE = re.compile(
    r"(?:shall come into force|come into force|shall be effective|with effect from|w\.e\.f\.)\s*"
    r"(?:on|from|the)?\s*(?P<d>[A-Z][a-z]+ \d{1,2},? \d{4}|\d{1,2}(?:st|nd|rd|th)? [A-Z][a-z]+,? \d{4})",
    re.I,
)


# ----------------------------------------------------------------------------- helpers

def clean_title(title: str) -> str:
    return re.sub(r"\s*\.pdf$", "", re.sub(r"\s+", " ", title or "").strip(), flags=re.I)


def strip_amendment_note(title: str) -> str:
    """'... Regulations, 2015 [Last amended on July 14, 2026]' -> '... Regulations, 2015'."""
    t = re.sub(r"\[+[^\]]*\]+", " ", clean_title(title))
    t = re.sub(r"\(\s*[Ll]ast amended[^)]*\)", " ", t)
    return re.sub(r"\s+", " ", t).strip(" -–—,")


def updated_as_on(title: str) -> date | None:
    m = _LAST_AMENDED.search(title or "")
    return parse_date(m.group("d")) if m else None


def is_consolidated(title: str, doc_type: str) -> bool:
    """True when the row is a full "as amended" text (an instrument), not an amending regulation or a corrigendum."""
    t = clean_title(title)
    if doc_type == "act":
        # Only the principal Acts; "The Finance Act, 2015" and "Securities Laws (Amendment) Act, 2014" amend them.
        return any(re.search(p, t, re.I) for p, _, _ in INSTRUMENT_SLUGS[:3])
    if _LAST_AMENDED.search(t):
        return True
    if re.match(r"^\s*(Corrigendum|Notice|Draft)\b", t, re.I):
        return False
    if re.search(r"\bAmendment\b\s*\)?\s*Regulations", t, re.I):
        return False
    return bool(re.search(r"Regulations,?\s*\d{4}", t))


def instrument_for(title: str, doc_type: str) -> tuple[str, str, str, str]:
    """(slug, short_code, title, kind) for a Regulation / Act / Master Circular row."""
    clean = strip_amendment_note(title)
    kind = {"act": "act", "regulations": "regulations", "master_circular": "master_direction"}.get(doc_type, "regulations")
    for pattern, slug, short in INSTRUMENT_SLUGS:
        if re.search(pattern, clean, re.I):
            return slug, short, clean, kind
    prefix = "sebi-mc-" if doc_type == "master_circular" else "sebi-"
    base = re.sub(r"^(?:Securities and Exchange Board of India|SEBI)\s*", "", clean, flags=re.I)
    slug = prefix + re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")[:70]
    return slug, slug.upper()[:24], clean, kind


def canonical(url: str, base: str = BASE) -> str:
    url = urljoin(base, (url or "").strip().strip("'\""))
    return url.replace("http://www.sebi.gov.in", "https://www.sebi.gov.in")


def pdf_from_viewer(src: str, page_url: str) -> str | None:
    """`../../../web/?file=https://www.sebi.gov.in/sebi_data/attachdocs/.../123.pdf` -> the PDF url."""
    if not src:
        return None
    absolute = urljoin(page_url, src)
    q = parse_qs(urlparse(absolute).query)
    target = (q.get("file") or [None])[0]
    if target:
        return canonical(target)
    return canonical(absolute) if re.search(r"\.pdf(\?|$)", absolute, re.I) else None


def filename_from_url(url: str) -> str:
    name = url.rsplit("/", 1)[-1].split("?")[0]
    return name or "document.pdf"


def _ddmmyyyy(d: date) -> str:
    return d.strftime("%d-%m-%Y")


# ----------------------------------------------------------------------------- listings

def parse_listing(html: str) -> list[dict]:
    """Rows of a SEBI listing table: {title, url, date_issued, year}."""
    page = BeautifulSoup(html, "lxml")
    table = page.select_one("table.table") or page.find("table")
    if table is None:
        return []
    rows: list[dict] = []
    for tr in table.find_all("tr"):
        link = tr.find("a", href=True)
        if link is None:
            continue
        cells = [re.sub(r"\s+", " ", td.get_text(" ", strip=True)) for td in tr.find_all("td")]
        first = cells[0] if cells else ""
        year = int(first) if re.fullmatch(r"(19|20)\d{2}", first) else None
        rows.append(
            {
                "title": clean_title(link.get_text(" ", strip=True)) or (cells[1] if len(cells) > 1 else ""),
                "url": canonical(link["href"]),
                "date_issued": None if year else parse_date(first),
                "year": year,
            }
        )
    return rows


def current_texts(section: str) -> dict[str, str]:
    """{url: title} from the plain `HomeAction.do` listing: the texts SEBI presents as current. (The AJAX archive
    also carries every superseded consolidation and every amending regulation, so it cannot answer this.)"""
    try:
        html = http.get_text(LISTING_URL.format(ssid=SSID[section]))
    except Exception as exc:
        log.warning("sebi: current %s listing failed: %s", section, str(exc)[:150])
        return {}
    return {r["url"]: r["title"] for r in parse_listing(html)}


def total_records(html: str) -> int | None:
    m = re.search(r"(\d[\d,]*)\s+to\s+(\d[\d,]*)\s+of\s+(\d[\d,]*)\s+records", html)
    return int(m.group(3).replace(",", "")) if m else None


def _ajax_page(ssid: int, page_index: int, from_date: str = "", to_date: str = "", *, client=None) -> str:
    body = {
        "nextValue": "1",
        "next": "n",
        "search": "",
        "fromDate": from_date,
        "toDate": to_date,
        "fromYear": "",
        "toYear": "",
        "deptId": "",
        "sid": "1",
        "ssid": str(ssid),
        "smid": "0",
        "ssidhidden": str(ssid),
        "intmid": "-1",
        "sText": "Legal",
        "ssText": "",
        "smText": "",
        "doDirect": str(page_index),
    }
    headers = {
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": LISTING_URL.format(ssid=ssid),
    }
    resp = http.post(AJAX_URL, body, http=client, headers=headers)
    # the reply is "<listing html>#@#<breadcrumb html>"
    return resp.text.split("#@#")[0]


def list_section(ssid: int, *, from_date: date | None = None, to_date: date | None = None, max_pages: int = MAX_PAGES) -> list[dict]:
    """Every row of one Legal sub-section, following the site's own AJAX pagination."""
    fd = _ddmmyyyy(from_date) if from_date else ""
    td = _ddmmyyyy(to_date) if to_date else ""
    out: list[dict] = []
    seen: set[str] = set()
    total: int | None = None
    with http.client() as c:
        for page_index in range(max_pages):
            try:
                html = _ajax_page(ssid, page_index, fd, td, client=c)
            except Exception as exc:
                log.warning("sebi ssid=%s page %d failed: %s", ssid, page_index, str(exc)[:150])
                break
            if total is None:
                total = total_records(html)
            rows = parse_listing(html)
            fresh = [r for r in rows if r["url"] not in seen]
            for r in fresh:
                seen.add(r["url"])
            out.extend(fresh)
            if not fresh or len(rows) < PAGE_SIZE:
                break
            if total is not None and len(out) >= total:
                break
    log.info("sebi ssid=%s: %d rows (site reports %s)", ssid, len(out), total)
    return out


# ----------------------------------------------------------------------------- detail pages

class Detail:
    __slots__ = ("title", "text", "pdf_urls", "number", "date_issued", "raw_html")

    def __init__(self, title, text, pdf_urls, number, date_issued, raw_html):
        self.title, self.text, self.pdf_urls = title, text, pdf_urls
        self.number, self.date_issued, self.raw_html = number, date_issued, raw_html


def parse_detail(html: str, page_url: str) -> Detail:
    """Verbatim body text, attachment PDFs, circular number and date from a SEBI detail page."""
    page = BeautifulSoup(html, "lxml")
    for bad in page.select("script, style, noscript"):
        bad.decompose()

    h1 = page.find("h1")
    title = clean_title(h1.get_text(" ", strip=True)) if h1 else None

    section = page.select_one("section.main_section") or page.select_one("#main-content") or page

    date_issued = None
    dv = section.select_one(".date_value")
    if dv is not None:
        date_issued = parse_date(dv.get_text(" ", strip=True))

    number = None
    id_area = section.select_one(".id_area")
    if id_area is not None:
        raw = re.sub(r"\s+", " ", id_area.get_text(" ", strip=True)).strip()
        m = _CIRCULAR_NO.match(raw)
        if m:
            number = m.group("num").strip(" :")
        elif raw and not re.fullmatch(r"(Circulars?|Regulations?|Acts?|Master Circulars?|Rules?)", raw, re.I):
            number = raw

    pdf_urls: list[str] = []
    for frame in section.find_all("iframe"):
        url = pdf_from_viewer(frame.get("src") or "", page_url)
        if url and url not in pdf_urls:
            pdf_urls.append(url)
    for a in section.find_all("a", href=True):
        url = pdf_from_viewer(a["href"], page_url)
        if url and re.search(r"\.pdf(\?|$)", url, re.I) and url not in pdf_urls:
            pdf_urls.append(url)

    # Body text: only present when SEBI published the document as HTML rather than (as usual) a PDF.
    for junk in section.select(".date_value, .id_area, .rel_art, .social-share-btn"):
        junk.decompose()
    lines: list[str] = []
    for el in section.find_all(["p", "li", "h2", "h3", "h4", "td"]):
        t = re.sub(r"[ \t\xa0]+", " ", el.get_text(" ", strip=True)).strip()
        if t and (not lines or lines[-1] != t):
            lines.append(t)
    text = "\n".join(lines).strip()
    return Detail(title, text, pdf_urls, number, date_issued, html)


def _attachments(pdf_urls: list[str]) -> list[FetchedAttachment]:
    out: list[FetchedAttachment] = []
    for url in pdf_urls:
        if any(a.source_url == url for a in out):
            continue
        out.append(FetchedAttachment(source_url=url, filename=filename_from_url(url), is_primary=not out))
    return out


# ----------------------------------------------------------------------------- adapters

class _SebiBase(Adapter):
    regulator_code = "SEBI"
    ssid = 0
    doc_type = ""

    def fetch(self, doc: DiscoveredDocument) -> FetchedDocument:
        html = http.get_text(doc.source_url)
        d = parse_detail(html, doc.source_url)
        effective = None
        if d.text:
            m = _EFFECTIVE.search(d.text)
            if m:
                effective = parse_date(re.sub(r"(\d)(st|nd|rd|th)", r"\1", m.group("d")))
        return FetchedDocument(
            raw_html=html,
            body_text=d.text,
            attachments=_attachments(list(doc.pdf_urls) + d.pdf_urls),
            date_issued=d.date_issued or doc.date_issued,
            date_effective=effective,
            number=doc.number or d.number,
            title=doc.title or d.title,
            updated_as_on=updated_as_on(doc.title or d.title or ""),
        )


class SebiRegulations(_SebiBase):
    """Legal > Regulations (plus Legal > Acts). Each row is a consolidated text and therefore an instrument."""

    name = "sebi_regulations"
    doc_type = "regulations"

    def discover(self, *, since_year: int | None = None) -> list[DiscoveredDocument]:
        out: dict[str, DiscoveredDocument] = {}
        claimed: set[str] = set()
        for section, doc_type in (("regulations", "regulations"), ("acts", "act")):
            # Instruments come from the "current" listing; the archive (which also holds every superseded
            # consolidation and every amending regulation) supplies the documents and their real dates.
            current = current_texts(section)
            rows = list_section(SSID[section])
            known = {r["url"] for r in rows}
            rows += [{"title": t, "url": u, "date_issued": None, "year": None}
                     for u, t in current.items() if u not in known]
            for row in rows:
                title = row["title"]
                extra: dict = {}
                if row["url"] in current and is_consolidated(title, doc_type):
                    slug, short, inst_title, kind = instrument_for(title, doc_type)
                    if slug not in claimed:
                        claimed.add(slug)
                        extra = {
                            "instrument_slug": slug,
                            "instrument_short_code": short,
                            "instrument_title": inst_title,
                            "instrument_kind": kind,
                            "updated_as_on": updated_as_on(title) or row["date_issued"],
                        }
                out.setdefault(
                    row["url"],
                    DiscoveredDocument(
                        source_url=row["url"],
                        title=title,
                        doc_type=doc_type,
                        number=None,
                        date_issued=row["date_issued"],
                        pdf_urls=[],
                        extra=extra,
                    ),
                )
        return list(out.values())


class SebiMasterCirculars(_SebiBase):
    """Legal > Master Circulars: SEBI's own consolidations, treated like RBI Master Directions."""

    name = "sebi_master_circulars"
    doc_type = "master_circular"

    def discover(self, *, since_year: int | None = None) -> list[DiscoveredDocument]:
        out: list[DiscoveredDocument] = []
        for row in list_section(SSID["master_circulars"]):
            slug, short, inst_title, kind = instrument_for(row["title"], "master_circular")
            out.append(
                DiscoveredDocument(
                    source_url=row["url"],
                    title=row["title"],
                    doc_type=self.doc_type,
                    date_issued=row["date_issued"],
                    extra={
                        "instrument_slug": slug,
                        "instrument_short_code": short,
                        "instrument_title": inst_title,
                        "instrument_kind": kind,
                        "updated_as_on": row["date_issued"],
                    },
                )
            )
        return out


class SebiCirculars(_SebiBase):
    """Legal > Circulars. The full archive reaches back to 1992; discovery asks for 2014 onward."""

    name = "sebi_circulars"
    doc_type = "circular"

    def discover(self, *, since_year: int | None = None) -> list[DiscoveredDocument]:
        start = date(since_year or 2014, 1, 1)
        end = date(date.today().year + 1, 12, 31)
        out: list[DiscoveredDocument] = []
        for row in list_section(SSID["circulars"], from_date=start, to_date=end):
            out.append(
                DiscoveredDocument(
                    source_url=row["url"],
                    title=row["title"],
                    doc_type=self.doc_type,
                    date_issued=row["date_issued"],
                )
            )
        return out


# ----------------------------------------------------------------------------- official text (seeder)

def _resolve_url(instrument: dict, cfg: dict) -> str:
    """The detail page holding the instrument's current consolidated text.

    SEBI mints a new URL every time it republishes a Regulation ("...-last-amended-on-<date>-_<id>.html"), so the
    listing is searched by title first and the stored `official_url` is only the fallback.
    """
    match = cfg.get("match")
    if match:
        section = cfg.get("listing") or ("acts" if cfg.get("style") == "act" else "regulations")
        doc_type = "act" if section == "acts" else "regulations"
        wanted = re.compile(match, re.I)
        hits = [
            url for url, title in current_texts(section).items()
            if is_consolidated(title, doc_type) and wanted.search(strip_amendment_note(title))
        ]
        if hits:
            return hits[0]
        log.warning("sebi: '%s' not on the %s listing; falling back to the stored url", match, section)
    url = instrument.get("official_url")
    if not url:
        raise RuntimeError(f"{instrument.get('slug')}: no SEBI url to read the official text from")
    return url


def official_text(instrument: dict, cfg: dict) -> SeedResult:
    """Seeder / self-check source: SEBI's own consolidated Act, Regulation or Master Circular.

    SEBI publishes each consolidated text as a PDF alongside the web page. We keep that PDF, because it is
    the document a practitioner will cite, and the page mapping lets the site open it at the right place.
    """
    from ..parsers.pdf import extract_pdf_text  # local import keeps the adapter importable without PyMuPDF

    url = _resolve_url(instrument, cfg)
    html = http.get_text(url)
    d = parse_detail(html, url)
    text = d.text
    pdf_bytes: bytes | None = None
    pdf_url: str | None = None
    if d.pdf_urls:
        try:
            data, _ = http.get_bytes(d.pdf_urls[0])
            if data[:4] == b"%PDF":
                pdf_bytes, pdf_url = data, d.pdf_urls[0]
                pdf_text = extract_pdf_text(data).text
                # The PDF is the authoritative layout; prefer it when the page text is thin.
                if len(pdf_text) > len(text):
                    text = pdf_text
        except Exception as exc:
            log.warning("%s: could not fetch the official PDF: %s", instrument.get("slug"), str(exc)[:120])
    if len(text) < 2000:
        raise RuntimeError(f"{instrument.get('slug')}: SEBI page {url} yielded only {len(text)} characters")
    stamp = updated_as_on(d.title or "") or updated_as_on(instrument.get("title") or "") or d.date_issued
    log.info(
        "%s: %d characters of official text (updated %s)%s",
        instrument.get("slug"), len(text), stamp, "" if pdf_bytes is None else f", official PDF {len(pdf_bytes) // 1024} KB",
    )
    return SeedResult(text=text, updated_as_on=stamp, source_url=url, pdf_bytes=pdf_bytes, pdf_url=pdf_url)
