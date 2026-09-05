"""CBIC GST source: notifications, circulars, orders and instructions, plus the consolidated GST Acts and Rules.

cbic-gst.gov.in's own "GST Acts / Notifications" menu points at CBIC's tax-information portal
(https://taxinformation.cbic.gov.in, a cbic.gov.in host). The portal is an Angular app over a JSON API; listing pages
render nothing without JavaScript, so this adapter talks to the same API the browser uses:

- POST api/authenticate-token           anonymous "home page" token, sent as `Authorization1: homeToken <jwt>`
- GET  api/cbic-notification-msts/fetchNotificationByYearAndCategory?year=&category=&taxId=1000001&page=&size=
- GET  api/cbic-circular-msts/fetchCircularByYearCategory?...          (categories from fetchCircularCategory)
- GET  api/cbic-order-msts/fetch-orders-year-category?...              (categories from order-category/<taxId>)
- GET  api/cbic-instruction-msts/fetch-instructions-year-category?year=&taxId=   (no category for GST)
- GET  api/cbic-<kind>-msts/<id>                                       one record (no token needed)
- GET  content/pdf/<docFilePath>                                       {"data": base64 PDF, "fileName": ...}
- GET  api/cbic-act-section-msts/findByActId/<actId>, api/cbic-rule-section-msts/findSectionByRuleId/<ruleId>
- GET  content/html/<contentFilePath>                                  one section / rule as HTML (as amended)

Text is stored verbatim; nothing here calls an AI model.
"""
from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import date, datetime
from urllib.parse import quote

from bs4 import BeautifulSoup, Tag

from .. import http
from .base import Adapter, DiscoveredDocument, FetchedAttachment, FetchedDocument

log = logging.getLogger(__name__)

HOST = "https://taxinformation.cbic.gov.in"
TAX_ID_GST = 1000001

# Fallbacks if the category endpoints fail; the live lists are preferred.
NOTIFICATION_SERIES = [
    "Central Tax",
    "Central Tax (Rate)",
    "Integrated Tax",
    "Integrated Tax (Rate)",
    "Union Territory Tax",
    "Union Territory Tax (Rate)",
    "Compensation Cess",
    "Compensation Cess (Rate)",
]
CIRCULAR_CATEGORIES = ["Circulars CGST", "Circulars -IGST", "Circulars - Compensation Cess"]
ORDER_CATEGORIES = ["Order-CGST", "Order-UTSGT", "Removal of Difficulty - CGST", "Removal of Difficulty - UTGST"]

GST_START_YEAR = 2017
PAGE_SIZE = 1000

# kind -> (API entity, number field, name field, date field, category field, public route segment)
KINDS = {
    "notification": ("cbic-notification-msts", "notificationNo", "notificationName", "notificationDt", "notificationCategory", "explore-notification"),
    "circular": ("cbic-circular-msts", "circularNo", "circularName", "circularDt", "circularCategory", "explore-circulars"),
    "order": ("cbic-order-msts", "orderNo", "orderName", "orderDt", "orderCategory", "explore-orders"),
    "instruction": ("cbic-instruction-msts", "instructionNo", "instructionName", "instructionDt", "instructionCategory", "explore-instructions"),
}
_SOURCE_URL = re.compile(r"/content-page/(?P<route>explore-(?:notification|circulars|orders|instructions))/(?P<id>\d+)")
_ROUTE_TO_KIND = {v[5]: k for k, v in KINDS.items()}


# ----------------------------------------------------------------------------- API plumbing

class _Portal:
    """Anonymous session against the tax-information API (token cached for its lifetime)."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._token_at = 0.0

    def _headers(self) -> dict[str, str]:
        if not self._token or time.monotonic() - self._token_at > 20 * 60:
            resp = http.post(f"{HOST}/api/authenticate-token", {}, headers={"Accept": "application/json"})
            self._token = resp.json().get("id_token")
            self._token_at = time.monotonic()
        return {"Authorization1": f"homeToken {self._token}", "language": "en", "Accept": "application/json, text/plain, */*"}

    def get_json(self, path: str, *, auth: bool = True):
        headers = self._headers() if auth else {"Accept": "application/json, text/plain, */*"}
        resp = http.get(f"{HOST}/{path}", headers=headers)
        return resp.json()


portal = _Portal()


def content_url(kind: str, file_path: str) -> str:
    """`content/pdf/...` or `content/html/...` URL for a repository path like `tax_repository\\gst\\...`."""
    rel = file_path.replace("\\", "/").strip("/")
    return f"{HOST}/content/{kind}/" + "/".join(quote(seg) for seg in rel.split("/"))


def public_url(kind: str, doc_id: int | str) -> str:
    return f"{HOST}/content-page/{KINDS[kind][5]}/{doc_id}"


def parse_source_url(url: str) -> tuple[str, int] | None:
    m = _SOURCE_URL.search(url)
    if not m:
        return None
    return _ROUTE_TO_KIND[m.group("route")], int(m.group("id"))


def parse_api_date(value: str | None) -> date | None:
    """`2026-05-07T05:30:00+05:30` / `25-Jul-2026` / `07.05.2026`."""
    if not value:
        return None
    v = value.strip()
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", v)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    for fmt in ("%d-%b-%Y", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%d %B %Y", "%d %B, %Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    return None


def format_number(kind: str, raw: str | None, series: str | None) -> str | None:
    """`02/2026-Central Tax` -> `Notification No. 02/2026-Central Tax`; circulars/orders/instructions as printed."""
    if not raw:
        return None
    raw = re.sub(r"\s+", " ", raw).strip()
    if kind == "notification":
        if re.match(r"^\d+\s*/\s*\d{4}", raw):
            return f"Notification No. {raw}"
        return raw  # e.g. "Corrigendum"
    return raw


def _years(since_year: int | None) -> list[int]:
    this_year = date.today().year
    if since_year:
        return list(range(max(since_year, GST_START_YEAR), this_year + 1))
    return [this_year]


# ----------------------------------------------------------------------------- listing rows -> documents

def row_to_document(kind: str, row: dict, doc_type: str) -> DiscoveredDocument | None:
    _, num_f, name_f, date_f, cat_f, _ = KINDS[kind]
    doc_id = row.get("id")
    if not doc_id:
        return None
    series = row.get(cat_f) or None
    pdfs = []
    for key in ("docFilePath", "docFilePathAOD", "docFilePathAod"):
        p = row.get(key)
        if p and p.lower().endswith(".pdf"):
            pdfs.append(content_url("pdf", p))
    title = re.sub(r"\s+", " ", row.get(name_f) or "").strip() or (row.get(num_f) or f"{kind} {doc_id}")
    return DiscoveredDocument(
        source_url=public_url(kind, doc_id),
        title=title,
        doc_type=doc_type,
        number=format_number(kind, row.get(num_f), series),
        date_issued=parse_api_date(row.get(date_f)),
        pdf_urls=pdfs,
        extra={"series": series, "kind": kind, "cbic_id": doc_id, "content_id": row.get("contentId"), "doc_file_path": row.get("docFilePath")},
    )


def parse_listing(rows: list[dict], kind: str, doc_type: str) -> list[DiscoveredDocument]:
    out: list[DiscoveredDocument] = []
    for row in rows or []:
        d = row_to_document(kind, row, doc_type)
        if d is not None:
            out.append(d)
    return out


def _year_category(entity: str, action: str, year: int, category: str | None, page: int = 0) -> list[dict]:
    q = f"page={page}&size={PAGE_SIZE}&year={year}&taxId={TAX_ID_GST}"
    if category is not None:
        q += f"&category={quote(category)}"
    rows = portal.get_json(f"api/{entity}/{action}?{q}")
    return rows if isinstance(rows, list) else []


def _categories(path: str, field: str, fallback: list[str]) -> list[str]:
    try:
        rows = portal.get_json(path)
        cats = [r.get(field) for r in rows if isinstance(r, dict) and r.get(field)]
        if cats:
            return cats
    except Exception as exc:  # the category endpoints are flaky (HTTP 500 at times)
        log.warning("category list %s failed (%s); using built-in list", path, exc)
    return fallback


# ----------------------------------------------------------------------------- fetch

def fetch_record(kind: str, doc_id: int) -> dict:
    entity = KINDS[kind][0]
    rec = portal.get_json(f"api/{entity}/{doc_id}", auth=False)
    if not isinstance(rec, dict) or not rec.get("id"):
        raise RuntimeError(f"no {kind} record {doc_id} on {HOST}")
    return rec


def _attachments_from_record(kind: str, rec: dict) -> list[FetchedAttachment]:
    atts: list[FetchedAttachment] = []
    seen: set[str] = set()

    def add(path: str | None, name: str | None, primary: bool) -> None:
        if not path:
            return
        url = content_url("pdf", path)
        if url in seen:
            return
        seen.add(url)
        atts.append(FetchedAttachment(source_url=url, filename=name or path.replace("\\", "/").rsplit("/", 1)[-1], is_primary=primary))

    add(rec.get("docFilePath"), rec.get("docFileName"), True)
    add(rec.get("docFilePathAOD") or rec.get("docFilePathAod"), rec.get("docFileNameAOD") or rec.get("docFileNameAod"), False)
    if (rec.get("isAttachment") or "").upper() == "Y":
        try:
            rows = portal.get_json(f"api/cbic-attachment-dtls/fetchAttachmentList/{rec['id']}/{kind.capitalize()}")
            for r in rows or []:
                add(r.get("docFilePath") or r.get("attachmentFilePath") or r.get("filePath"), r.get("docFileName") or r.get("attachmentFileName"), False)
        except Exception as exc:
            log.warning("attachment list for %s %s failed: %s", kind, rec.get("id"), exc)
    return atts


def fetch_document(doc: DiscoveredDocument) -> FetchedDocument:
    parsed = parse_source_url(doc.source_url)
    if parsed is None:
        raise RuntimeError(f"not a tax-information document URL: {doc.source_url}")
    kind, doc_id = parsed
    rec = fetch_record(kind, doc_id)
    _, num_f, name_f, date_f, cat_f, _ = KINDS[kind]
    raw = json.dumps(rec, ensure_ascii=False, indent=1)
    title = re.sub(r"\s+", " ", rec.get(name_f) or "").strip() or doc.title
    number = format_number(kind, rec.get(num_f), rec.get(cat_f)) or doc.number
    issued = parse_api_date(rec.get(date_f)) or doc.date_issued
    attachments = _attachments_from_record(kind, rec)
    for url in doc.pdf_urls:
        if not any(a.source_url == url for a in attachments):
            attachments.append(FetchedAttachment(source_url=url, filename=url.rsplit("/", 1)[-1], is_primary=not attachments))
    # The portal has no HTML detail page: the record is the "page" and the PDF carries the text (extracted downstream).
    return FetchedDocument(raw_html=raw, body_text="", attachments=attachments, date_issued=issued, number=number, title=title)


# ----------------------------------------------------------------------------- adapters

class CbicGstNotifications(Adapter):
    name = "cbic_gst_notifications"
    regulator_code = "CBIC"

    def discover(self, *, since_year: int | None = None) -> list[DiscoveredDocument]:
        series = _categories(f"api/cbic-notification-msts/fetchCategory/{TAX_ID_GST}", "notificationCategory", NOTIFICATION_SERIES)
        out: dict[str, DiscoveredDocument] = {}
        for year in _years(since_year):
            for cat in series:
                try:
                    rows = _year_category("cbic-notification-msts", "fetchNotificationByYearAndCategory", year, cat)
                except Exception as exc:
                    log.warning("notifications %s %s failed: %s", cat, year, exc)
                    continue
                for d in parse_listing(rows, "notification", "notification"):
                    out.setdefault(d.source_url, d)
        return list(out.values())

    def fetch(self, doc: DiscoveredDocument) -> FetchedDocument:
        return fetch_document(doc)


class CbicGstCirculars(Adapter):
    """Circulars, orders (incl. removal-of-difficulty orders) and instructions, all stored as doc_type 'circular'."""

    name = "cbic_gst_circulars"
    regulator_code = "CBIC"

    def discover(self, *, since_year: int | None = None) -> list[DiscoveredDocument]:
        circ_cats = _categories(f"api/cbic-circular-msts/fetchCircularCategory/{TAX_ID_GST}", "circularCategory", CIRCULAR_CATEGORIES)
        order_cats = _categories(f"api/cbic-order-msts/order-category/{TAX_ID_GST}", "orderCategory", ORDER_CATEGORIES)
        out: dict[str, DiscoveredDocument] = {}
        for year in _years(since_year):
            for cat in circ_cats:
                self._collect(out, "circular", "cbic-circular-msts", "fetchCircularByYearCategory", year, cat)
            for cat in order_cats:
                self._collect(out, "order", "cbic-order-msts", "fetch-orders-year-category", year, cat)
            # GST instructions carry no category on the portal; the endpoint accepts year + taxId alone.
            self._collect(out, "instruction", "cbic-instruction-msts", "fetch-instructions-year-category", year, None)
        return list(out.values())

    @staticmethod
    def _collect(out: dict, kind: str, entity: str, action: str, year: int, cat: str | None) -> None:
        try:
            rows = _year_category(entity, action, year, cat)
        except Exception as exc:
            log.warning("%s %s %s failed: %s", kind, cat, year, exc)
            return
        for d in parse_listing(rows, kind, "circular"):
            out.setdefault(d.source_url, d)

    def fetch(self, doc: DiscoveredDocument) -> FetchedDocument:
        return fetch_document(doc)


# ----------------------------------------------------------------------------- official text (Acts / Rules)

_BLOCK_TAGS = {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "blockquote", "body", "html"}
_BLOCK_LIST = sorted(_BLOCK_TAGS - {"body", "html"})


def _is_block(el: Tag) -> bool:
    """Block element, or an inline wrapper (the pages nest <p> inside <span>) that contains block elements."""
    return el.name in _BLOCK_TAGS or el.find(_BLOCK_LIST) is not None


_BR = " "  # U+2029 PARAGRAPH SEPARATOR: stands in for <br> until lines are split


def html_to_text(html: str) -> str:
    """Verbatim text of a portal section page: block elements and <br> become lines; the soft line wraps of the
    HTML source and runs of spaces/nbsp are collapsed to single spaces. A leading footnote asterisk on the
    "Section N." heading line is dropped so the heading starts with its label (the footnote text itself is kept)."""
    page = BeautifulSoup(html, "lxml")
    for bad in page.select("script, style, noscript, title, head"):
        bad.decompose()
    for br in page.find_all("br"):
        br.replace_with(_BR)
    root = page.body or page
    lines: list[str] = []

    def emit(text: str) -> None:
        for part in text.split(_BR):
            # nbsp and zero-width characters (the footnote paragraphs start with U+200B) count as whitespace
            t = re.sub(r"\s+", " ", re.sub(r"[\xa0\u200b\u200c\u200d\ufeff]", " ", part)).strip()
            if t:
                lines.append(t)

    def walk(el: Tag) -> None:
        buf: list[str] = []
        for child in el.children:
            if isinstance(child, Tag):
                if _is_block(child):
                    if buf:
                        emit("".join(buf))
                        buf = []
                    if child.name == "tr":
                        cells = [re.sub(r"\s+", " ", td.get_text(" ", strip=True)) for td in child.find_all(["td", "th"])]
                        cells = [c for c in cells if c]
                        if cells:
                            lines.append(" | ".join(cells))
                    else:
                        walk(child)
                else:
                    buf.append(child.get_text(" "))
            else:
                buf.append(str(child))
        if buf:
            emit("".join(buf))

    walk(root)
    text = "\n".join(lines)
    text = re.sub(r"^\*+\s*(?=(?:Section|Rule)\s+\d)", "", text, flags=re.M)
    return text.strip()


def section_text(label: str, html: str) -> str:
    """One section/rule page as text, prefixed with the portal's label ("Rule 31C") when the page omits it."""
    text = html_to_text(html)
    if not text:
        return ""
    if label and not text.lower().startswith(label.lower()) and not re.match(r"^(Section|Rule)\s+\d", text):
        text = f"{label}\n{text}"
    return text


@dataclass
class SectionPage:
    label: str          # "Section 16" / "Rule 31C" / "Introduction"
    heading: str
    path: str
    amend_dt: date | None


def _section_pages(rows: list[dict]) -> list[SectionPage]:
    pages = []
    for r in rows or []:
        if (r.get("isActive") or "Y") != "Y":
            continue
        path = r.get("contentFilePath")
        if not path:
            continue
        pages.append(SectionPage(
            label=re.sub(r"\s+", " ", r.get("sectionNo") or "").strip(),
            heading=re.sub(r"\s+", " ", r.get("sectionName") or "").strip(),
            path=path,
            amend_dt=parse_api_date(r.get("amendDt")),
        ))
    return pages


def assemble_text(pages: list[SectionPage]) -> tuple[str, date | None]:
    """Download every section page in the portal's order and join them (order = document order on the portal)."""
    parts: list[str] = []
    latest: date | None = None
    for p in pages:
        try:
            html = http.get_text(content_url("html", p.path))
        except Exception as exc:
            log.warning("section %s (%s) failed: %s", p.label, p.path, exc)
            continue
        text = section_text(p.label, html)
        if not text:
            continue
        parts.append(text)
        d = p.amend_dt
        if d is None:
            m = re.search(r"Last Updated:\s*(\d{1,2}-[A-Za-z]+-\d{4})", text)
            if m:
                try:
                    d = datetime.strptime(m.group(1), "%d-%B-%Y").date()
                except ValueError:
                    d = None
        if d and (latest is None or d > latest):
            latest = d
    return "\n\n".join(parts), latest


def official_text(instrument: dict, cfg: dict) -> tuple[str, date | None, str]:
    """Consolidated (as amended) text of a GST Act or Rules from the section-wise pages of the tax-information portal.

    cfg: {"act_id": 1000006} or {"rule_id": 1000006}. The portal's single-file "consolidated" PDF/HTML lags years
    behind (CGST Act file says "Last Updated: 28-September-2022"); the section pages carry later amendments, so they
    are the source of truth here.
    """
    if cfg.get("act_id"):
        list_path = f"api/cbic-act-section-msts/findByActId/{cfg['act_id']}"
        meta_path, meta_id = f"api/cbic-act-msts/fetchActs/{TAX_ID_GST}", int(cfg["act_id"])
    elif cfg.get("rule_id"):
        list_path = f"api/cbic-rule-section-msts/findSectionByRuleId/{cfg['rule_id']}"
        meta_path, meta_id = f"api/cbic-rule-msts/fetchRules/{TAX_ID_GST}", int(cfg["rule_id"])
    else:
        raise RuntimeError(f"cbic_gst seed for {instrument.get('slug')} needs act_id or rule_id")
    rows = portal.get_json(list_path, auth=False)
    pages = _section_pages(rows)
    if not pages:
        raise RuntimeError(f"{list_path} returned no sections")
    text, latest = assemble_text(pages)
    if len(text) < 5000:
        raise RuntimeError(f"{list_path} produced too little text ({len(text)} chars)")
    if latest is None:
        try:
            for r in portal.get_json(meta_path, auth=False) or []:
                if r.get("id") == meta_id:
                    latest = parse_api_date(r.get("amendDt"))
        except Exception as exc:
            log.warning("metadata %s failed: %s", meta_path, exc)
    return text, latest, f"{HOST}/{list_path}"
