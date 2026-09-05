"""Income Tax Department (CBDT) - incometaxindia.gov.in.

Official Government of India source. The portal was rebuilt on Liferay in 2026 and sits behind bot protection, so
every request goes through `amendments.browser` (a real Chromium). The site exposes clean JSON APIs which its own
pages use; this adapter calls exactly those:

  POST /o/search/v1.0/search   blueprint CIRCULAR_NOTIFICATION_BP_ERC + structure_key -> notifications / circulars
  POST /o/search/v1.0/search   blueprint ACT_SECTIONS_BP_ERC act_id + year_id -> sections of an Act (text inline)
  GET  /o/c/actassetcategories/                              -> Acts and their act_id
  GET  /o/c/yearassetcategories/                             -> "as amended by Finance Act <year>" ids
  GET  /o/c/rules/                                           -> Rule sets and their category id
  GET  /o/c/incometaxactcompares/                            -> official 1961 <-> 2025 section mapping
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime

from ..browser import session
from ..parsers.provisions import ParsedProvision
from .base import Adapter, DiscoveredDocument, FetchedAttachment, FetchedDocument

log = logging.getLogger(__name__)

HOME = "https://www.incometaxindia.gov.in/notifications"
BASE = "https://www.incometaxindia.gov.in"
SEARCH = "/o/search/v1.0/search?nestedFields=embedded&page={page}&pageSize={size}&restrictFields=embedded.actions%2Cembedded.creator"
SEARCH_Q = SEARCH + "&search={query}"

# The portal's search returns at most ~1,900 results for one query, so the listing is sliced by year: every
# notification/circular number carries its year ("No. 12/2024"), which the text search matches.
RESULT_WINDOW_PAGES = 18

# Both listings live in structure 36050; `structure_key` is what separates them (as the portal's own pages do).
STRUCTURE_ID = "36050"
KEY_NOTIFICATION = "NOTIFICATION_KEY"
KEY_CIRCULAR = "CIRCULAR_KEY"


def _sess():
    s = session(HOME)
    s.delay = max(s.delay, 1.1)   # the portal rejects rapid paging; keep about one request a second
    return s


def _fields(item: dict) -> dict[str, str]:
    """Flatten a structured-content item's contentFields into {name: data}."""
    out: dict[str, str] = {}
    for f in (item.get("embedded") or {}).get("contentFields") or []:
        v = f.get("contentFieldValue") or {}
        if isinstance(v, dict):
            if "data" in v and isinstance(v["data"], str):
                out[f["name"]] = v["data"]
            doc = v.get("document")
            if isinstance(doc, dict) and doc.get("contentUrl"):
                out[f["name"] + "__url"] = doc["contentUrl"]
                out[f["name"] + "__name"] = doc.get("title") or doc.get("fileName") or ""
    return out


def _iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _search(structure_key: str, page: int, size: int, query: str | None = None) -> dict:
    body = {
        "attributes": {
            "search.empty.search": True,
            "search.experiences.blueprint.external.reference.code": "CIRCULAR_NOTIFICATION_BP_ERC",
            "search.experiences.structure_id": STRUCTURE_ID,
            "search.experiences.structure_key": structure_key,
        }
    }
    url = SEARCH_Q.format(page=page, size=size, query=query) if query else SEARCH.format(page=page, size=size)
    return _sess().post_json(url, body)


class _CbdtBase(Adapter):
    regulator_code = "CBDT"
    needs_browser = True
    browser_home = HOME
    structure_key = ""
    doc_type = ""
    page_size = 100
    max_pages = 200
    slice_by_year = True

    def discover(self, *, since_year: int | None = None) -> list[DiscoveredDocument]:
        cutoff = since_year or 2014
        out: list[DiscoveredDocument] = []
        seen: set[str] = set()
        this_year = date.today().year
        if self.slice_by_year:
            # One query per year keeps each result set inside the portal's result window.
            for query in [str(y) for y in range(cutoff - 1, this_year + 2)]:
                self._collect(query, cutoff, out, seen)
        else:
            self._collect(None, cutoff, out, seen)
        log.info("%s: %d documents since %d", self.name, len(out), cutoff)
        return out

    def _collect(self, query: str | None, cutoff: int, out: list[DiscoveredDocument], seen: set[str]) -> None:
        for page in range(1, RESULT_WINDOW_PAGES + 1):
            try:
                data = _search(self.structure_key, page, self.page_size, query)
            except Exception as exc:
                log.warning("%s: query %s page %d failed: %s", self.name, query, page, str(exc)[:120])
                return
            items = data.get("items") or []
            if not items:
                return
            for item in items:
                f = _fields(item)
                issued = _iso_date(f.get("circularNotificationDate") or f.get("uploadDate"))
                if issued and issued.year < cutoff:
                    continue
                url = item.get("itemURL") or ""
                if not url or url in seen:
                    continue
                seen.add(url)
                number, _, subject = (f.get("circularNotificationNumber") or item.get("title") or "").partition(" : ")
                title = (subject or "").strip() or (item.get("title") or "").strip()
                pdf = f.get("reportFile__url")
                out.append(
                    DiscoveredDocument(
                        source_url=url,
                        title=re.sub(r"\s+", " ", title)[:500] or number.strip(),
                        doc_type=self.doc_type,
                        number=number.strip() or None,
                        date_issued=issued,
                        pdf_urls=[BASE + pdf] if pdf else [],
                        extra={"content": f.get("documentContent") or "", "summary": f.get("summary") or ""},
                    )
                )
            if len(items) < self.page_size:
                return

    def fetch(self, doc: DiscoveredDocument) -> FetchedDocument:
        item = _sess().get_json(doc.source_url + "?nestedFields=embedded&fields=contentFields,title,datePublished")
        f: dict[str, str] = {}
        for fld in item.get("contentFields") or []:
            v = fld.get("contentFieldValue") or {}
            if isinstance(v, dict):
                if isinstance(v.get("data"), str):
                    f[fld["name"]] = v["data"]
                d = v.get("document")
                if isinstance(d, dict) and d.get("contentUrl"):
                    f[fld["name"] + "__url"] = d["contentUrl"]
                    f[fld["name"] + "__name"] = d.get("title") or d.get("fileName") or ""
        html = f.get("documentContent") or ""
        text = re.sub(r"<[^>]+>", " ", html)
        text = re.sub(r"&nbsp;?", " ", text)
        text = re.sub(r"[ \t]+", " ", text).strip()
        attachments = []
        for key in ("reportFile", "evidenceAttachment", "anyExceptionInHours"):
            url = f.get(key + "__url")
            if url and key == "reportFile":
                attachments.append(
                    FetchedAttachment(source_url=BASE + url, filename=(f.get(key + "__name") or url.rsplit("/", 1)[-1]) + (".pdf" if not url.lower().endswith(".pdf") else ""), is_primary=True)
                )
        for url in doc.pdf_urls:
            if not any(a.source_url == url for a in attachments):
                attachments.append(FetchedAttachment(source_url=url, filename=url.rsplit("/", 1)[-1] + ".pdf", is_primary=not attachments))
        return FetchedDocument(
            raw_html=html,
            body_text=text,
            attachments=attachments,
            date_issued=_iso_date(f.get("circularNotificationDate")) or doc.date_issued,
            number=(f.get("circularNotificationNumber") or "").split(" : ")[0].strip() or doc.number,
            title=doc.title,
        )


class CbdtNotifications(_CbdtBase):
    name = "cbdt_notifications"
    structure_key = KEY_NOTIFICATION
    doc_type = "notification"


class CbdtCirculars(_CbdtBase):
    name = "cbdt_circulars"
    slice_by_year = False
    structure_key = KEY_CIRCULAR
    doc_type = "circular"


# ----------------------------------------------------------------- official text (Acts and Rules)

def _acts() -> list[dict]:
    data = _sess().get_json("/o/c/actassetcategories/?pageSize=-1&fields=id,nameOfAct,assetCategoryID,pageURL")
    return data.get("items") or []


def _latest_year_id() -> tuple[int, str]:
    """Most recent 'as amended by Finance Act <year>' category."""
    data = _sess().get_json("/o/c/yearassetcategories/?pageSize=-1&sort=year:desc&fields=id,year,assetCategoryID")
    items = [i for i in (data.get("items") or []) if str(i.get("year", "")).strip()]
    best = max(items, key=lambda i: (re.sub(r"\D", "", str(i["year"]))[:4] or "0"))
    return int(best["assetCategoryID"]), str(best["year"])


def _act_id(name_contains: str) -> int:
    for a in _acts():
        if name_contains.lower() in (a.get("nameOfAct") or "").lower():
            return int(a["assetCategoryID"])
    raise LookupError(f"Act not found on the portal: {name_contains}")


def _rule_id(name_contains: str) -> int:
    data = _sess().get_json("/o/c/rules/?pageSize=-1&fields=id,nameOfRule,assetCategoryID,pageURL")
    for r in data.get("items") or []:
        if name_contains.lower() in (r.get("nameOfRule") or "").lower():
            return int(r["assetCategoryID"])
    raise LookupError(f"Rules not found on the portal: {name_contains}")


def _clean_text(html_or_text: str) -> str:
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html_or_text, flags=re.S | re.I)
    t = re.sub(r"<br\s*/?>|</p>|</div>|</tr>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    t = t.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def _rule_sections(rule_cat_id: int) -> list[ParsedProvision]:
    """Rules of one Rule set (blueprint used by the portal's own Rules page)."""
    return _sections(
        rule_cat_id,
        0,
        blueprint="RULE_CONTENT_LIST_BP_ERC",
        extra={
            "search.experiences.rule_id": rule_cat_id,
            "search.experiences.rule_category_id": rule_cat_id,
            "search.experiences.year_id": "",
            "search.experiences.free_text": "",
        },
        drop_act_keys=True,
    )


def _sections(
    act_id: int,
    year_id: int,
    *,
    blueprint: str = "ACT_SECTIONS_BP_ERC",
    extra: dict | None = None,
    drop_act_keys: bool = False,
) -> list[ParsedProvision]:
    """Every section/rule of an Act or Rule set, with its text, from the portal's own listing API."""
    provisions: list[ParsedProvision] = []
    seen: set[str] = set()
    page, size = 1, 100
    while page <= 60:
        attrs: dict = {
            "search.empty.search": True,
            "search.experiences.blueprint.external.reference.code": blueprint,
        }
        if not drop_act_keys:
            attrs["search.experiences.act_id"] = act_id
            attrs["search.experiences.year_id"] = year_id
            attrs["search.experiences.free_text"] = ""
        attrs.update(extra or {})
        data = _sess().post_json(SEARCH.format(page=page, size=size), {"attributes": attrs})
        items = data.get("items") or []
        if not items:
            break
        for item in items:
            f = _fields(item)
            number = (f.get("sectionNumber") or f.get("ruleNumber") or "").strip()
            if not number:
                m = re.match(r"^(?:Section|Rule)\s*[-–]?\s*(\S+)", item.get("title") or "")
                number = m.group(1) if m else ""
            if not number or number in seen:
                continue
            seen.add(number)
            heading = (f.get("sectionShortDescription") or f.get("ruleShortDescription") or "").strip()
            # Full text is in documentContent (HTML). Some entries are PDF-only; fall back to the snippet.
            body = _clean_text(f.get("documentContent") or "")
            if not body:
                body = re.sub(r"^\d{15,}\s+\d{4}-\d{2}-\d{2}\s+", "", _clean_text(item.get("description") or ""))
            body = _strip_act_header(body)
            if heading and body.startswith(heading):
                body = body[len(heading):].strip()
            text = f"{number}. {heading}\n{body}".strip() if heading else f"{number}. {body}".strip()
            footnotes = _clean_text(f.get("footnotes") or "")
            if footnotes:
                text += "\n\n" + footnotes
            chapter = (f.get("chapterTitle") or "").strip()
            provisions.append(
                ParsedProvision(
                    number=number,
                    heading=heading or None,
                    text=text,
                    level="section",
                    raw_number=number,
                    chapter_label=chapter or None,
                    footnotes=[footnotes] if footnotes else [],
                )
            )
        if len(items) < size:
            break
        page += 1
    provisions.sort(key=lambda p: _sort_key(p.number))
    return provisions


_ACT_HEADER = re.compile(
    r"^\s*(?:\d{15,}\s+\d{4}-\d{2}-\d{2}\s+)?(?:\S+\s+)?(?:Content\s+)?"
    r"(?:INCOME-TAX (?:ACT|RULES)[^\n]*?\[[^\]]*\]\s*)+",
    re.I,
)


def _strip_act_header(text: str) -> str:
    """Remove the repeated 'INCOME-TAX ACT, 1961* [43 OF 1961] [AS AMENDED BY FINANCE ACT, 2026]' banner."""
    out = re.sub(r"^\s*\d{15,}\s+\d{4}-\d{2}-\d{2}\s+", "", text)
    out = re.sub(r"\bContent\b\s*", "", out, count=1)
    out = re.sub(r"INCOME-TAX (ACT|RULES),?\s*\d{4}\*?\s*(\[[^\]]*\]\s*)*", "", out, flags=re.I)
    return out.strip()


def _sort_key(number: str) -> tuple:
    m = re.match(r"^(\d+)([A-Z]*)", number.strip())
    return (int(m.group(1)), m.group(2)) if m else (10**6, number)


def official_text(instrument: dict, cfg: dict) -> tuple[list[ParsedProvision], date | None, str]:
    """Seeder for the Income-tax Acts and Rules: returns provisions directly (text comes section-wise)."""
    year_id, year_label = _latest_year_id()
    if cfg.get("kind") == "rules":
        provisions = _rule_sections(_rule_id(cfg["match"]))
    else:
        cat = _act_id(cfg["match"])
        provisions = _sections(cat, year_id if cfg.get("use_year", True) else 0)
    if len(provisions) < 5:
        raise RuntimeError(f"{instrument['slug']}: portal returned only {len(provisions)} provisions")
    log.info("%s: %d provisions (as amended, %s)", instrument["slug"], len(provisions), year_label)
    return provisions, date.today(), BASE + (cfg.get("page") or "")


# ----------------------------------------------------------------- 1961 <-> 2025 section map

def section_map() -> list[dict]:
    """CBDT's own mapping between Income-tax Act 1961 / Rules 1962 and Act 2025 / Rules 2026."""
    rows: list[dict] = []
    page = 1
    while page <= 60:
        data = _sess().get_json(f"/o/c/incometaxactcompares/?pageSize=100&page={page}")
        items = data.get("items") or []
        if not items:
            break
        for i in items:
            rows.append(
                {
                    "old_title": i.get("parentSectionTitle") or "",
                    "old_cms_id": i.get("parentSectionCmsId") or "",
                    "old_priority": i.get("parentSectionPriority"),
                    "new_title": i.get("childSectionTitle") or "",
                    "new_cms_id": i.get("childSectionCmsId") or "",
                    "new_priority": i.get("childSectionPriority"),
                    "entity_type": i.get("parentEntityType") or "",
                }
            )
        if len(items) < 100:
            break
        page += 1
    log.info("section map: %d rows", len(rows))
    return rows
