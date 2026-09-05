"""Ministry of Corporate Affairs (MCA) - mca.gov.in.

Official Government of India source for the Companies Act, 2013 and the rules made under it.

The portal is an Adobe AEM site behind bot protection: a plain HTTP client gets 403 on every URL, a real browser
gets 200, so every request goes through `amendments.browser`. A second trap is `clientlib-devtool.js`, which sends
the *rendered* page to the home page whenever it thinks devtools are open (which is what an automated Chromium looks
like). Fetching a URL with `fetch()` from inside an already-loaded page is unaffected, so this adapter never
navigates - it only calls MCA's own JSON/document endpoints from the warm home page:

  GET /bin/ebook/service/documentMetadata?docCategory=Notifications&flag=initial&status=Current
  GET /bin/ebook/service/documentMetadata?docCategory=Circulars&flag=initial&status=Current
      -> the whole listing in one response (no pagination); `docGroup` says which Act each item belongs to
  GET /bin/ebook/service/documentMetadata?docCategory=Acts&status=Current&Level=1
      -> the 10 Acts MCA administers ("The Companies Act, 2013" -> docId J105_D, link 668275747)
  GET /bin/ebook/service/documentMetadata?docCategory=Rules&status=Current&Root=..&Parent=..&Level=2|3
      -> the Rules sets under an Act, then the individual rules of one set
  GET /bin/ebook/dms/getdocument?doc=<base64(link)>&docCategory=<category>
      -> the document itself: a PDF for a notification / circular, verbatim HTML for an Act section or a rule

MCA publishes notifications and circulars only as PDFs, so `fetch()` downloads the PDF, extracts its text with
`parsers/pdf.py` and keeps the same PDF as the primary attachment.
"""
from __future__ import annotations

import base64
import html as html_mod
import json
import logging
import re
import urllib.parse
from datetime import date, datetime

from ..browser import session
from ..parsers.pdf import extract_pdf_text
from ..parsers.provisions import ParsedProvision
from .base import Adapter, DiscoveredDocument, FetchedAttachment, FetchedDocument

log = logging.getLogger(__name__)

BASE = "https://www.mca.gov.in"
HOME = BASE + "/content/mca/global/en/home.html"
META = BASE + "/bin/ebook/service/documentMetadata"
GETDOC = BASE + "/bin/ebook/dms/getdocument"
ACTS_PAGE = BASE + "/content/mca/global/en/acts-rules/ebooks/acts.html"
RULES_PAGE = BASE + "/content/mca/global/en/acts-rules/ebooks/rules.html"

COMPANIES_ACT = "The Companies Act, 2013"

_GSR = re.compile(r"^\s*G\.?\s*S\.?\s*R\.?\s*[\d\-]", re.I)


def _sess():
    s = session(HOME)
    s.delay = max(s.delay, 1.1)   # MCA throttles bursts; keep about one request a second
    return s


def _b64(value: str | int) -> str:
    return base64.b64encode(str(value).encode("utf-8")).decode("ascii")


def document_url(link: str | int, category: str) -> str:
    """The canonical URL of one MCA e-Book document (also the URL the PDF is downloaded from)."""
    return f"{GETDOC}?doc={urllib.parse.quote(_b64(link))}&docCategory={category}"


def parse_document_url(url: str) -> tuple[str, str]:
    """(link, docCategory) back out of a canonical document URL."""
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    doc = (q.get("doc") or [""])[0]
    try:
        link = base64.b64decode(doc + "=" * (-len(doc) % 4)).decode("utf-8")
    except Exception:
        link = ""
    return link, (q.get("docCategory") or ["Notifications"])[0]


def parse_mca_date(value: str | None) -> date | None:
    """MCA's metadata dates are US-ordered ("01/24/2024", sometimes with a time)."""
    if not value:
        return None
    v = value.strip().split(" ")[0]
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            continue
    return None


def _metadata(**params) -> list[dict]:
    q = urllib.parse.urlencode({k: v for k, v in params.items() if v not in (None, "")})
    raw = _sess().get_text(f"{META}?{q}")
    if not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("mca: documentMetadata returned non-JSON for %s", q)
        return []
    return data.get("data") or []


# ----------------------------------------------------------------------------- listings

def split_number(short_description: str, doc_name: str) -> tuple[str | None, str]:
    """MCA writes "<number>-<subject>" in shortDescription and repeats the number in docName."""
    subject = re.sub(r"\s+", " ", (short_description or "")).strip()
    number = re.sub(r"\s+", " ", (doc_name or "")).strip() or None
    if number and subject.lower().startswith(number.lower()):
        subject = subject[len(number):].lstrip(" -–—:")
    elif number is None:
        m = re.match(r"^((?:G\.?\s*S\.?\s*R\.?|S\.?\s*O\.?|General Circular)[^-–]{0,60}?)\s*[-–]\s*(.+)$", subject, re.I)
        if m:
            number, subject = m.group(1).strip(), m.group(2).strip()
    return number, subject.strip()


def classify(number: str | None, default: str) -> str:
    """Amendment rules and commencement notifications are published as G.S.R. / S.O. gazette numbers."""
    if default == "notification" and number and _GSR.match(number):
        return "gsr"
    return default


def parse_listing(rows: list[dict], category: str, doc_type: str, *, since_year: int | None = None) -> list[DiscoveredDocument]:
    out: list[DiscoveredDocument] = []
    seen: set[str] = set()
    for row in rows:
        link = str(row.get("link") or "").strip()
        if not link:
            continue
        issued = parse_mca_date(row.get("notificationdate"))
        if since_year and issued and issued.year < since_year:
            continue
        url = document_url(link, category)
        if url in seen:
            continue
        seen.add(url)
        number, subject = split_number(row.get("shortDescription") or "", row.get("docName") or "")
        out.append(
            DiscoveredDocument(
                source_url=url,
                title=(subject or number or "")[:500],
                doc_type=classify(number, doc_type),
                number=number,
                date_issued=issued,
                pdf_urls=[url],
                extra={"doc_group": row.get("docGroup") or "", "doc_id": row.get("docId") or ""},
            )
        )
    return out


_NUMBER_IN_TEXT = [
    re.compile(r"(G\.?\s?S\.?\s?R\.?\s*\d+\s*\(\s*E\s*\))", re.I),
    re.compile(r"(S\.?\s?O\.?\s*\d+\s*\(\s*E\s*\))", re.I),
    re.compile(r"(General Circular No\.?\s*[\dA-Z/\-]+)", re.I),
]
_DATE_IN_TEXT = re.compile(
    r"(?:dated|Dated|New Delhi,? the)\s*:?\s*(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+,?\s+\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4})",
)
_EFFECTIVE_IN_TEXT = re.compile(
    r"(?:come into force|shall come into force|comes? into force)\s*(?:on|from|with effect from|w\.e\.f\.)?\s*"
    r"(?:the\s*)?(\d{1,2}(?:st|nd|rd|th)?\s+(?:day of\s+)?[A-Z][a-z]+,?\s+\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4})",
    re.I,
)


def _loose_date(raw: str) -> date | None:
    t = re.sub(r"(\d)(st|nd|rd|th)", r"\1", raw).replace("day of ", "").strip().rstrip(",")
    for fmt in ("%d %B %Y", "%d %B, %Y", "%d %b %Y", "%d.%m.%Y", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(t, fmt).date()
        except ValueError:
            continue
    return None


def _filename(number: str | None, link: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9]+", "-", (number or f"mca-{link}")).strip("-") or f"mca-{link}"
    return f"{stem[:80]}.pdf"


class _McaBase(Adapter):
    regulator_code = "MCA"
    needs_browser = True
    browser_home = HOME
    category = ""
    doc_type = ""

    def discover(self, *, since_year: int | None = None) -> list[DiscoveredDocument]:
        cutoff = since_year or 2014
        rows = _metadata(docCategory=self.category, flag="initial", status="Current")
        docs = parse_listing(rows, self.category, self.doc_type, since_year=cutoff)
        log.info("%s: %d documents since %d (of %d published)", self.name, len(docs), cutoff, len(rows))
        return docs

    def fetch(self, doc: DiscoveredDocument) -> FetchedDocument:
        link, _ = parse_document_url(doc.source_url)
        text = ""
        try:
            data, _ = _sess().get_bytes(doc.source_url)
            text = extract_pdf_text(data).text
        except Exception as exc:
            log.warning("%s: could not read %s: %s", self.name, doc.source_url, str(exc)[:160])

        # Gazette copies print the Hindi text first and the English text after it, so look well past the start.
        head = text[:20000]
        number = doc.number
        if not number:
            for rx in _NUMBER_IN_TEXT:
                m = rx.search(head)
                if m:
                    number = re.sub(r"\s+", " ", m.group(1)).strip()
                    break
        issued = doc.date_issued
        if not issued:
            m = _DATE_IN_TEXT.search(head)
            if m:
                issued = _loose_date(m.group(1))
        effective = None
        m = _EFFECTIVE_IN_TEXT.search(text)
        if m:
            effective = _loose_date(m.group(1))

        attachments = [
            FetchedAttachment(source_url=doc.source_url, filename=_filename(number, link), is_primary=True)
        ]
        return FetchedDocument(
            raw_html="", body_text=text, attachments=attachments, date_issued=issued, date_effective=effective,
            number=number, title=doc.title,
        )


class McaNotifications(_McaBase):
    """Companies Act notifications: amendment rules published as G.S.R., commencement notifications as S.O."""

    name = "mca_notifications"
    category = "Notifications"
    doc_type = "notification"


class McaCirculars(_McaBase):
    """MCA General Circulars (clarifications issued under the Companies Act)."""

    name = "mca_circulars"
    category = "Circulars"
    doc_type = "circular"


# ----------------------------------------------------------------- official text (Act and Rules)

_BLOCK_END = re.compile(r"</(p|div|tr|h[1-6]|li)>|<br\s*/?>", re.I)


def html_to_text(fragment: str) -> str:
    """Verbatim text of one e-Book HTML fragment: block tags become newlines, nothing is rewritten."""
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", fragment, flags=re.S | re.I)
    t = _BLOCK_END.sub("\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    t = html_mod.unescape(t)
    t = t.replace("\xa0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r" *\n *", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def slice_by_anchor(fragment: str, doc_identifier: str) -> str:
    """A document may carry the Act preamble or a neighbouring provision: keep only this one's block."""
    if not doc_identifier:
        return fragment
    m = re.search(rf'<[^>]*\sid="{re.escape(doc_identifier)}"', fragment, re.I)
    if not m:
        return fragment
    rest = fragment[m.start():]
    nxt = re.search(r'<[^>]*\sid="(?:D\d|S\d)[^"]*"', rest[1:], re.I)
    return rest[: nxt.start() + 1] if nxt else rest


_NUMBER_HEAD = re.compile(r"^\s*(\d{1,3}[A-Z]{0,3})\s*(?:[.)]\s*|\s+)(.+)$")
_ANNEX_HEAD = re.compile(r"^\s*(Schedule|Annexure|Chapter)\b", re.I)
# Amended provisions are printed with their footnote marker: "2[6. Conversion of ...", "1.1[Form No: INC-1]".
_FOOTNOTE_MARK = re.compile(r"^\s*\d{1,3}(?:\.\d{1,3})?\s*\[\s*")
# An inserted provision is printed inside the quotation marks of the notification that inserted it: "“30. Shifting
# of Registered office …", "*20. Voting Through Electronic Means".
_LEAD_MARK = re.compile(r"^[\s“”\"'‘’*\[―]+")
_FORM_HEAD = re.compile(r"^(?:e-?)?Form\s*(?:No\.?|No:)?\s*([A-Z]{2,6}\s?-?\s?\d{1,3}[A-Z]{0,3})\b(.*)$", re.I)


def _number_and_heading(label: str) -> tuple[str, str | None, str]:
    """("2. Definitions") -> ("2", "Definitions", "section"). Schedules and forms keep their name as the number."""
    label = re.sub(r"\s+", " ", label).strip()
    label = _LEAD_MARK.sub("", label)
    label = _LEAD_MARK.sub("", _FOOTNOTE_MARK.sub("", label)).rstrip("]").strip()
    mf = _FORM_HEAD.match(label)
    if mf:
        number = "Form " + re.sub(r"[\s.]*-[\s.]*|\s+", "-", mf.group(1).strip().upper())
        return number, (mf.group(2).strip(" .:-") or None), "annex"
    m = _NUMBER_HEAD.match(label)
    if m and not _ANNEX_HEAD.match(label):
        return m.group(1).upper(), (m.group(2).strip(" .") or None), "section"
    return label[:60], (label[:200] or None) if _ANNEX_HEAD.match(label) else None, "annex"


def _act_record(name: str) -> dict:
    for a in _metadata(docCategory="Acts", status="Current", Level="1"):
        if name.lower() in (a.get("docName") or "").lower():
            return a
    raise LookupError(f"Act not published in MCA's e-Book: {name}")


_TOC_ITEM = re.compile(
    r'<h4[^>]*>\s*(?P<chapter>[^<]{3,160}?)\s*</h4>'
    r'|<a[^>]*data-docIdentifier="(?P<ident>[^"]+)"[^>]*data-docindex="(?P<link>[^"]+)"[^>]*>(?P<label>.*?)</a>',
    re.I | re.S,
)


def act_toc(toc_html: str) -> list[dict]:
    """Chapters and their sections from the e-Book's table of contents (one request for the whole Act)."""
    items: list[dict] = []
    chapter: str | None = None
    seen: set[str] = set()
    for m in _TOC_ITEM.finditer(toc_html):
        if m.group("chapter"):
            chapter = html_mod.unescape(re.sub(r"\s+", " ", m.group("chapter"))).strip()
            continue
        ident = m.group("ident")
        if ident in seen:
            continue
        seen.add(ident)
        label = html_mod.unescape(re.sub(r"<[^>]+>", " ", m.group("label")))
        items.append({"ident": ident, "link": m.group("link"), "label": re.sub(r"\s+", " ", label).strip(), "chapter": chapter})
    return items


def _act_provisions(act_name: str) -> tuple[list[ParsedProvision], date | None]:
    act = _act_record(act_name)
    s = _sess()
    toc = act_toc(s.get_text(document_url(act["link"], "Acts")))
    if len(toc) < 10:
        raise RuntimeError(f"{act_name}: e-Book table of contents listed only {len(toc)} sections")
    provisions: list[ParsedProvision] = []
    for item in toc:
        try:
            body = s.get_text(document_url(item["link"], "Acts"))
        except Exception as exc:
            log.warning("mca: section %s failed: %s", item["label"], str(exc)[:120])
            continue
        text = html_to_text(slice_by_anchor(body, item["ident"]))
        if not text:
            continue
        number, heading, level = _number_and_heading(item["label"])
        provisions.append(
            ParsedProvision(
                number=number, heading=heading, text=text, level=level, raw_number=number,
                chapter_label=item["chapter"],
            )
        )
    return provisions, parse_mca_date(act.get("lastAmendmentDate"))


def _rules_root(group: str) -> str:
    for r in _metadata(docCategory="Rules", status="Current", Level="1", docGroup=group):
        if r.get("root"):
            return str(r["root"])
    raise LookupError(f"no Rules published under {group}")


def _rules_set(root: str, match: str) -> dict:
    sets = {}
    for r in _metadata(docCategory="Rules", status="Current", Root=root, Parent=root, Level="2"):
        sets.setdefault(r["docId"], r)
    key = re.sub(r"[^a-z0-9]+", " ", match.lower()).strip()
    for r in sets.values():
        if key in re.sub(r"[^a-z0-9]+", " ", (r.get("docName") or "").lower()):
            return r
    raise LookupError(f"Rules set not found in MCA's e-Book: {match}")


def _rule_provisions(group: str, match: str) -> tuple[list[ParsedProvision], date | None]:
    root = _rules_root(group)
    rule_set = _rules_set(root, match)
    rows = {}
    for r in _metadata(docCategory="Rules", status="Current", Root=root, Parent=rule_set["docId"], Level="3", flag="initial"):
        rows.setdefault(r["docId"], r)
    s = _sess()
    label = re.sub(r"^\s*Chapter\s+[IVXLC]+\s*(?:Part\s+[IVXLC]+\s*)?", "", rule_set.get("docName") or "").strip()
    provisions: list[ParsedProvision] = []
    for r in sorted(rows.values(), key=lambda x: _ident_key(x.get("docIdentifier") or "")):
        try:
            body = s.get_text(document_url(r["link"], "Rules"))
        except Exception as exc:
            log.warning("mca: rule %s failed: %s", r.get("docIdentifier"), str(exc)[:120])
            continue
        text = html_to_text(slice_by_anchor(body, r.get("docIdentifier") or ""))
        if not text:
            continue
        number, heading, level = _number_and_heading(text.split("\n", 1)[0])
        provisions.append(
            ParsedProvision(
                number=number, heading=heading, text=text, level=level, raw_number=number, chapter_label=label or None,
            )
        )
    provisions.sort(key=lambda p: _number_key(p.number))
    return provisions, parse_mca_date(rule_set.get("notificationdate"))


def _ident_key(ident: str) -> tuple:
    m = re.search(r"R(\d+)$", ident)
    return (int(m.group(1)), ident) if m else (10**6, ident)


def _number_key(number: str) -> tuple:
    """Rules read in number order; forms, schedules and annexures come after them."""
    m = re.match(r"^(\d{1,3})([A-Z]{0,3})$", number.strip())
    return (0, int(m.group(1)), m.group(2)) if m else (1, 0, number)


def official_text(instrument: dict, cfg: dict) -> tuple[list[ParsedProvision], date | None, str]:
    """Seeder for the Companies Act, 2013 and the Rules made under it (verbatim, section/rule-wise, as amended)."""
    if cfg.get("kind") == "rules":
        provisions, updated = _rule_provisions(cfg.get("group", COMPANIES_ACT), cfg["match"])
        page = RULES_PAGE
    else:
        provisions, updated = _act_provisions(cfg.get("match", COMPANIES_ACT))
        page = ACTS_PAGE
    # Numbers repeat across schedules/forms; make them unique so the provision upsert stays stable.
    seen: dict[str, int] = {}
    for p in provisions:
        if p.number in seen:
            seen[p.number] += 1
            p.number = f"{p.number} ({seen[p.number]})"
        else:
            seen[p.number] = 1
    if len(provisions) < 5:
        raise RuntimeError(f"{instrument['slug']}: MCA returned only {len(provisions)} provisions")
    log.info("%s: %d provisions from MCA's e-Book", instrument["slug"], len(provisions))
    return provisions, updated or date.today(), instrument.get("official_url") or page
