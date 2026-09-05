"""Rule-based tagging (no AI, no cost).

FEMA documents are formulaic:
- an amending notification says "...makes the following amendment in the Foreign Exchange Management (Deposit)
  Regulations, 2016 (Notification No. FEMA 5(R)/2016-RB ...)" and then "In Regulation 5, ... shall be substituted";
- an original notification is titled "Foreign Exchange Management (Guarantees) Regulations, 2026";
- an A.P. (DIR Series) circular names the Master Direction and paragraphs it changes.

This module turns those patterns into instrument tags and provision-level effects. It never rewrites text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

FEM_NAME = r"Foreign\s+Exchange\s+Management\s*\((?P<subject>[^)]{2,140})\)"
_TITLE = re.compile(
    rf"^(?P<name>{FEM_NAME})\s*(?P<amend>\((?:[A-Za-z\- ]*?Amendment)\)\s*)?(?P<kind>Regulations|Rules|Directions),?\s*(?P<year>\d{{4}})?",
    re.I,
)
_PRINCIPAL = re.compile(
    rf"(?:amendments?|modifications?|changes?)\s+(?:in|to)\s+the\s+(?P<name>{FEM_NAME})\s*(?P<kind>Regulations|Rules),?\s*(?P<year>\d{{4}})",
    re.I,
)
_PRINCIPAL_NUMBER = re.compile(r"Notification\s+No\.?\s*(?P<num>FEMA\.?\s*[\dA-Z()/.\- ]*?\d{4}\s*-\s*RB)", re.I)
_SUPERSESSION = re.compile(r"supersession|supersede", re.I)
_REG_REF = re.compile(r"\b(?:Regulation|Rule)s?\s+(?P<num>\d{1,3}[A-Z]{0,2})\b(?!\s*of\s+the\s+Foreign\s+Exchange\s+Management\s+Act)", re.I)
_PARA_REF = re.compile(r"\b(?:Para|Paragraph)s?\.?\s+(?P<num>(?:[A-Z]\.)?\d{1,3}(?:\.\d{1,3})*)", re.I)
_SCHEDULE_REF = re.compile(r"\bSchedule\s+(?P<num>[IVX]+|\d+)\b", re.I)
_SECTION_REF = re.compile(r"\bsections?\s+(?P<num>\d{1,3}[A-Z]?)\b[^.;]{0,120}?Foreign\s+Exchange\s+Management\s+Act", re.I)
_MD_UPDATED = re.compile(r"Master\s+Directions?[^.]{0,250}?(updated|amended|modified|revised|being\s+updated)", re.I)
_CHANGE_VERBS = (
    ("omit", re.compile(r"\b(omitted|deleted|shall\s+be\s+omitted|stands?\s+deleted)\b", re.I)),
    ("insert", re.compile(r"\b(inserted|added|shall\s+be\s+inserted|shall\s+be\s+added|after\s+(?:the\s+)?(?:clause|sub-regulation|regulation|paragraph|words?))\b", re.I)),
    ("renumber", re.compile(r"\brenumbered\b", re.I)),
    ("substitute", re.compile(r"\b(substituted|replaced|shall\s+be\s+substituted|shall\s+read\s+as)\b", re.I)),
)


def norm_key(name: str, year: str | None = None) -> str:
    key = re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()
    return f"{key} {year}".strip() if year else key


def slug_for(name: str, kind: str, year: str | None) -> str:
    m = re.search(FEM_NAME, name, re.I)
    subject = m.group("subject") if m else name
    base = re.sub(r"[^a-z0-9]+", "-", f"fem {subject} {kind} {year or ''}".lower()).strip("-")
    return base[:80]


@dataclass
class NewInstrument:
    slug: str
    title: str
    kind: str                 # regulations | rules
    regulator: str            # RBI for Regulations, DEA (Central Government) for Rules
    official_document: bool   # this document IS the instrument's original text


@dataclass
class Effect:
    instrument_slug: str
    provision_number: str
    change_type: str
    excerpt: str


@dataclass
class RuleResult:
    is_amending: bool = False
    tags: list[tuple[str, str]] = field(default_factory=list)          # (instrument slug, relation)
    new_instruments: list[NewInstrument] = field(default_factory=list)
    effects: list[Effect] = field(default_factory=list)


def _change_type(text: str) -> str:
    for ct, rx in _CHANGE_VERBS:
        if rx.search(text):
            return ct
    return "substitute"


def _paragraphs(text: str) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n|\n(?=\(?[0-9ivx]+[.)]\s)|\n(?=In\s)", text) if p.strip()]
    return paras or [text]


def _excerpt(paras: list[str], i: int, limit: int = 2000) -> str:
    """The amending paragraph plus following quoted text (the new wording) up to a limit."""
    out = paras[i]
    j = i + 1
    while j < len(paras) and len(out) < limit and (paras[j].startswith(("“", '"', "'", "(", "“")) or not _REG_REF.search(paras[j])):
        out += "\n" + paras[j]
        j += 1
        if len(paras[j - 1]) > 0 and re.match(r"^(In|For|After)\s", paras[j - 1]):
            break
    return out[:limit]


def _find_instrument(instruments: list[dict], name: str, year: str | None) -> dict | None:
    want = norm_key(name, year)
    want_noyear = norm_key(name)
    for inst in instruments:
        k = inst.get("_key") or norm_key(inst["title"])
        if k == want:
            return inst
    for inst in instruments:
        k = inst.get("_key") or norm_key(inst["title"])
        if re.sub(r"\s\d{4}$", "", k) == want_noyear:
            return inst
    return None


def tag_notification(doc: dict, text: str, instruments: list[dict]) -> RuleResult:
    """FEMA notification (RBI regulations) or Central Government GSR (rules)."""
    res = RuleResult()
    title = re.sub(r"\s+", " ", doc.get("title") or "").strip()
    mt = _TITLE.match(title)
    head = text[:6000]

    # Which principal instrument does this document belong to?
    principal_name = principal_kind = principal_year = None
    is_amendment = bool(mt and mt.group("amend")) or bool(re.search(r"\bAmendment\b", title))
    mp = _PRINCIPAL.search(head)
    if mp:
        principal_name, principal_kind, principal_year = mp.group("name"), mp.group("kind").title(), mp.group("year")
        is_amendment = True
    elif mt:
        principal_name, principal_kind, principal_year = mt.group("name"), mt.group("kind").title(), (None if mt.group("amend") else mt.group("year"))
    if not principal_name:
        # references to the Act only
        for m in _SECTION_REF.finditer(head):
            res.tags.append(("fema-1999", "references"))
            break
        return res

    principal_title = f"{principal_name} {principal_kind}" + (f", {principal_year}" if principal_year else "")
    kind = "rules" if principal_kind.lower() == "rules" else "regulations"
    regulator = "DEA" if kind == "rules" else "RBI"
    inst = _find_instrument(instruments, f"{principal_name} {principal_kind}", principal_year)
    if inst:
        slug = inst["slug"]
    else:
        slug = slug_for(principal_name, kind, principal_year)
        res.new_instruments.append(NewInstrument(slug=slug, title=principal_title, kind=kind, regulator=regulator, official_document=not is_amendment))

    if not is_amendment:
        # the original text of the instrument; tag as supersedes when it replaces earlier regulations
        res.tags.append((slug, "supersedes" if _SUPERSESSION.search(head) else "references"))
        if _SECTION_REF.search(head):
            res.tags.append(("fema-1999", "references"))
        return res

    res.is_amending = True
    res.tags.append((slug, "amends"))
    if _SECTION_REF.search(head):
        res.tags.append(("fema-1999", "references"))

    paras = _paragraphs(text)
    seen: set[tuple[str, str]] = set()
    for i, p in enumerate(paras):
        # Only the instruction sentence ("In regulation 5, ... shall be substituted ...:-"), not the quoted new text.
        instruction = re.split(r"namely|:-|:\s|[“\"]", p, maxsplit=1)[0]
        refs = [m.group("num") for m in _REG_REF.finditer(instruction)]
        refs += [f"Schedule {m.group('num')}" for m in _SCHEDULE_REF.finditer(instruction)]
        if not refs:
            continue
        if not re.search(r"\b(shall|substitut|insert|omit|delet|renumber|added|replac)", p, re.I):
            continue
        ct = _change_type(instruction)
        for num in refs[:3]:
            key = (num, ct)
            if key in seen:
                continue
            seen.add(key)
            res.effects.append(Effect(instrument_slug=slug, provision_number=num, change_type=ct, excerpt=_excerpt(paras, i)))
    return res


def _md_keywords(title: str) -> list[str]:
    t = re.sub(r"\(\s*[Uu]pdated[^)]*\)", "", title)
    t = re.sub(r"^Master Directions?\s*[-–—:]?\s*", "", t)
    t = re.sub(r"Reserve Bank of India|Foreign Exchange Management|Directions?,?\s*\d{4}|\bunder\b|\bof\b|\band\b|\bthe\b|\bin\b|\bby\b|\bto\b|\bor\b", " ", t, flags=re.I)
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z\-]{3,}", t)]
    return [w.lower() for w in words]


def tag_circular(doc: dict, text: str, instruments: list[dict]) -> RuleResult:
    """A.P. (DIR Series) circular: link to Master Directions / regulations it names."""
    res = RuleResult()
    low = text.lower()
    mentions_md = "master direction" in low
    md_amended = bool(_MD_UPDATED.search(text))

    for inst in instruments:
        if inst["kind"] == "master_direction":
            kws = _md_keywords(inst["title"])
            if not kws:
                continue
            hits = sum(1 for k in kws if k in low)
            title_phrase = re.sub(r"\(\s*[Uu]pdated[^)]*\)", "", inst["title"]).split("-", 1)[-1].strip().lower()
            if (mentions_md and hits >= max(2, int(0.7 * len(kws)))) or (title_phrase and len(title_phrase) > 12 and title_phrase in low):
                relation = "amends" if md_amended else "clarifies"
                res.tags.append((inst["slug"], relation))
                if relation == "amends":
                    res.is_amending = True
                    paras = _paragraphs(text)
                    seen: set[str] = set()
                    for i, p in enumerate(paras):
                        for m in _PARA_REF.finditer(p):
                            num = m.group("num")
                            if num in seen:
                                continue
                            seen.add(num)
                            res.effects.append(Effect(inst["slug"], num, _change_type(p), _excerpt(paras, i)))
        elif inst["kind"] in ("regulations", "rules"):
            if norm_key(re.sub(r",\s*\d{4}$", "", inst["title"])) in norm_key(text):
                res.tags.append((inst["slug"], "references"))
        elif inst["kind"] == "act" and _SECTION_REF.search(text):
            res.tags.append((inst["slug"], "references"))
    return res


# ---------------------------------------------------------------- Income Tax (CBDT)

_ITR_AMEND = re.compile(
    r"further to amend the Income-?tax Rules,?\s*(?P<year>19\d{2}|20\d{2})", re.I
)
_ITR_RULE_REF = re.compile(r"\b(?:in the principal rules,?\s*)?in rule\s+(?P<num>\d{1,3}[A-Z]{0,3})\b", re.I)
_ITR_NEW_RULE = re.compile(r"\bafter rule\s+(?P<num>\d{1,3}[A-Z]{0,3}),?\s*the following rule", re.I)
_FORM_REF = re.compile(r"\bin Form No\.?\s*(?P<num>[0-9A-Z\-]+)", re.I)
_ITA_SECTION_REF = re.compile(
    r"\b(?:under |of )?section[s]?\s+(?P<num>\d{1,3}[A-Z]{0,3})(?:\s*\(\d+\))?\s*(?:of the Income-?tax Act)?", re.I
)
_ITA_ACT_YEAR = re.compile(r"Income-?tax Act,?\s*(?P<year>1961|2025)", re.I)


def _cbdt_instruments(instruments: list[dict]) -> dict[str, dict]:
    return {i["slug"]: i for i in instruments if i["slug"] in ("ita-1961", "ita-2025", "itr-1962", "itr-2026")}


def tag_cbdt(doc: dict, text: str, instruments: list[dict]) -> RuleResult:
    """Income Tax notifications and circulars: link to the Act/Rules and the rules or sections they touch."""
    res = RuleResult()
    known = _cbdt_instruments(instruments)
    head = text[:8000]
    title = doc.get("title") or ""
    blob = f"{title}\n{head}"

    rules_year = None
    m = _ITR_AMEND.search(blob)
    if m:
        rules_year = m.group("year")
    elif re.search(r"Income-?tax \((?:[A-Za-z\- ]*?Amendment)\) Rules,?\s*(20\d{2})", blob, re.I):
        rules_year = "2026" if re.search(r"Rules,?\s*2026", blob, re.I) else "1962"

    if rules_year:
        slug = "itr-2026" if rules_year == "2026" else "itr-1962"
        if slug in known:
            res.is_amending = True
            res.tags.append((slug, "amends"))
            paras = _paragraphs(text)
            seen: set[tuple[str, str]] = set()
            for i, p in enumerate(paras):
                instruction = re.split(r"namely|:-|:\s|[“\"]", p, maxsplit=1)[0]
                refs = [mm.group("num") for mm in _ITR_RULE_REF.finditer(instruction)]
                refs += [mm.group("num") for mm in _ITR_NEW_RULE.finditer(instruction)]
                if not refs or not re.search(r"\b(shall|substitut|insert|omit|delet|renumber|added|replac)", p, re.I):
                    continue
                ct = _change_type(instruction)
                for num in refs[:3]:
                    if (num, ct) in seen:
                        continue
                    seen.add((num, ct))
                    res.effects.append(Effect(slug, num, ct, _excerpt(paras, i)))
            for mm in list(_FORM_REF.finditer(head))[:3]:
                res.effects.append(Effect(slug, f"Form {mm.group('num')}", "substitute", _excerpt([head], 0)[:1200]))

    # Which Act does it operate under / refer to?
    acts = {m.group("year") for m in _ITA_ACT_YEAR.finditer(blob)}
    for year in acts:
        slug = "ita-2025" if year == "2025" else "ita-1961"
        if slug in known and not any(s == slug for s, _ in res.tags):
            relation = "clarifies" if doc.get("doc_type") == "circular" else "references"
            res.tags.append((slug, relation))
    if doc.get("doc_type") == "circular":
        # circulars explain sections: record the sections they discuss
        target = "ita-1961" if "ita-1961" in known else next(iter(known), None)
        if target:
            seen_secs: set[str] = set()
            for mm in list(_ITA_SECTION_REF.finditer(head))[:8]:
                num = mm.group("num")
                if num in seen_secs or len(num) > 6:
                    continue
                seen_secs.add(num)
    return res


# ----------------------------------------------------------------------------- GST (CBIC)
#
# GST documents are formulaic too:
# - a Central Tax notification amending the rules opens "In exercise of the powers conferred by section 164 of the
#   Central Goods and Services Tax Act, 2017 ... makes the following rules further to amend the Central Goods and
#   Services Tax Rules, 2017" and then lists "in rule 46, ..." / "in rule 86, in sub-rule (4), ... shall be inserted";
# - a rate notification amends an earlier rate notification: "the following further amendments in the notification of
#   the Government of India ... No. 1/2017-Central Tax (Rate), dated the 28th June, 2017";
# - a circular clarifies provisions: "sub-section (4) of section 16 of the CGST Act" / "rule 36(4) of the CGST Rules".

_GST_ACT_SLUGS = [
    (re.compile(r"Central\s+Goods\s+and\s+Services\s+Tax\s+Act,?\s*2017|\bCGST\s+Act\b|\bsaid\s+Act\b", re.I), "cgst-act-2017"),
    (re.compile(r"Integrated\s+Goods\s+and\s+Services\s+Tax\s+Act,?\s*2017|\bIGST\s+Act\b", re.I), "igst-act-2017"),
    (re.compile(r"Union\s+Territory\s+Goods\s+and\s+Services\s+Tax\s+Act,?\s*2017|\bUTGST\s+Act\b", re.I), "utgst-act-2017"),
    (re.compile(r"Goods\s+and\s+Services\s+Tax\s+\(Compensation\s+to\s+States\)\s+Act,?\s*2017|\bCompensation\s+Cess\s+Act\b", re.I), "gst-compensation-act-2017"),
]
_GST_RULES_SLUGS = [
    (re.compile(r"Central\s+Goods\s+and\s+Services\s+Tax\s+Rules,?\s*2017|\bCGST\s+Rules\b", re.I), "cgst-rules-2017"),
    (re.compile(r"Integrated\s+Goods\s+and\s+Services\s+Tax\s+Rules,?\s*2017|\bIGST\s+Rules\b", re.I), "igst-rules-2017"),
]
_GST_TITLES = {
    "cgst-act-2017": ("Central Goods and Services Tax Act, 2017", "act"),
    "igst-act-2017": ("Integrated Goods and Services Tax Act, 2017", "act"),
    "utgst-act-2017": ("Union Territory Goods and Services Tax Act, 2017", "act"),
    "gst-compensation-act-2017": ("Goods and Services Tax (Compensation to States) Act, 2017", "act"),
    "cgst-rules-2017": ("Central Goods and Services Tax Rules, 2017", "rules"),
    "igst-rules-2017": ("Integrated Goods and Services Tax Rules, 2017", "rules"),
}
# Which Act a notification series is issued under (for rate notifications amending earlier notifications).
_GST_SERIES_ACT = [
    (re.compile(r"Integrated\s+Tax", re.I), "igst-act-2017"),
    (re.compile(r"Union\s+Territory\s+Tax|\bUT\s+Tax|UTGST", re.I), "utgst-act-2017"),
    (re.compile(r"Compensation\s+Cess", re.I), "gst-compensation-act-2017"),
    (re.compile(r"Central\s+Tax|CGST", re.I), "cgst-act-2017"),
]
_GST_AMEND_RULES = re.compile(
    r"makes?\s+the\s+following\s+rules\s+(?:further\s+)?to\s+amend\s+the\s+(?P<name>(?:Central|Integrated|Union\s+Territory)\s+Goods\s+and\s+Services\s+Tax\s+Rules,?\s*2017)",
    re.I,
)
_GST_AMEND_NOTIFICATION = re.compile(
    r"amendments?\s+in\s+the\s+notification[^.;]{0,400}?(?:No\.?|Number)\s*(?P<num>\d{1,3}\s*/\s*20\d\d\s*[-–—]\s*(?:Central|Integrated|Union\s+Territory)\s+Tax(?:\s*\(Rate\))?|\d{1,3}\s*/\s*20\d\d\s*[-–—]\s*Compensation\s+Cess(?:\s*\(Rate\))?)",
    re.I,
)
_GST_RULE_REF = re.compile(r"\b(?:in|after|before|for|to)\s+rules?\s+(?P<num>\d{1,3}[A-Z]{0,2})\b", re.I)
_GST_SECTION_REF = re.compile(r"\bsections?\s+(?P<num>\d{1,3}[A-Z]{0,2})\b(?:\s*\((?P<sub>\d{1,2}[a-z]?)\))?", re.I)
_GST_SECTION_REF_SUB = re.compile(r"sub-section\s*\((?P<sub>\d{1,2}[a-z]?)\)\s+of\s+section\s+(?P<num>\d{1,3}[A-Z]{0,2})\b", re.I)
_GST_RULE_CITE = re.compile(r"\brules?\s+(?P<num>\d{1,3}[A-Z]{0,2})\b(?:\s*\((?P<sub>\d{1,2}[a-z]?)\))?", re.I)
_GST_SECTION_HEAD = re.compile(r"\bsection\s+(?P<num>\d{1,3}[A-Z]{0,2})\b", re.I)
_GST_CHANGE_VERB = re.compile(r"\b(shall\s+be\s+(?:inserted|substituted|omitted|added|renumbered)|inserted|substituted|omitted|deleted|renumbered|added)\b", re.I)


def _gst_slug_in(text: str, table: list[tuple[re.Pattern, str]]) -> list[str]:
    hits: list[str] = []
    for rx, slug in table:
        if rx.search(text) and slug not in hits:
            hits.append(slug)
    return hits


def _gst_instrument(res: RuleResult, instruments: list[dict], slug: str) -> str:
    """Return the slug to tag; register a NewInstrument when the Act/Rules are not tracked yet."""
    if any(i["slug"] == slug for i in instruments) or any(n.slug == slug for n in res.new_instruments):
        return slug
    title, kind = _GST_TITLES.get(slug, (slug, "act"))
    for inst in instruments:
        if (inst.get("_key") or norm_key(inst["title"])) == norm_key(title):
            return inst["slug"]
    res.new_instruments.append(NewInstrument(slug=slug, title=title, kind=kind, regulator="CBIC", official_document=False))
    return slug


def _gst_series(doc: dict) -> str | None:
    blob = " ".join(str(doc.get(k) or "") for k in ("number", "title", "series"))
    for rx, slug in _GST_SERIES_ACT:
        if rx.search(blob):
            return slug
    return None


def _unquoted(line: str) -> str:
    """The instruction part of a line: quoted new wording is removed, an unclosed opening quote cuts the rest."""
    s = re.sub(r"[“\"][^”\"]*[”\"]", " ", line)
    return re.split(r"[“\"]", s, maxsplit=1)[0]


_GST_RULE_BLOCK = re.compile(r"^(?:\(?[a-z0-9ivx]{1,4}[.)]\s*)?(?:in|after|before|for|to)\s+rules?\s+\d", re.I)


def _gst_rule_effects(text: str, slug: str) -> list[Effect]:
    """Walk the amending text line by line: "in rule 164, -" opens a block, change verbs inside it become effects."""
    lines = [ln.strip() for ln in text.replace("\r", "").split("\n")]
    effects: list[Effect] = []
    seen: set[tuple[str, str]] = set()
    current: str | None = None
    block_start = 0
    pending_verb: str | None = None

    def flush(end: int) -> None:
        nonlocal pending_verb
        if current and pending_verb:
            key = (current, pending_verb)
            if key not in seen:
                seen.add(key)
                excerpt = "\n".join(l for l in lines[block_start:end] if l)[:2000]
                effects.append(Effect(instrument_slug=slug, provision_number=current, change_type=pending_verb, excerpt=excerpt))
        pending_verb = None

    for i, ln in enumerate(lines):
        instruction = _unquoted(ln)
        m = _GST_RULE_REF.search(instruction)
        if m and _GST_RULE_BLOCK.match(instruction):
            flush(i)
            current = m.group("num").upper()
            block_start = i
        if current and _GST_CHANGE_VERB.search(instruction):
            pending_verb = _change_type(instruction)
    flush(len(lines))
    return effects


def tag_gst_notification(doc: dict, text: str, instruments: list[dict]) -> RuleResult:
    """CBIC GST notification: rules amendments (provision-level), rate-notification amendments, Act references."""
    res = RuleResult()
    head = text[:6000]
    title = doc.get("title") or ""

    # 1. "makes the following rules further to amend the Central Goods and Services Tax Rules, 2017"
    m = _GST_AMEND_RULES.search(head)
    if m:
        slug = _gst_slug_in(m.group("name"), _GST_RULES_SLUGS)
        rules_slug = _gst_instrument(res, instruments, slug[0] if slug else "cgst-rules-2017")
        res.is_amending = True
        res.tags.append((rules_slug, "amends"))
        res.effects.extend(_gst_rule_effects(text, rules_slug))
    elif re.search(r"\bAmendment\)?\s+Rules,?\s*20\d\d", title, re.I) and "Goods and Services Tax" in title:
        # title says "(Amendment) Rules" but the opening formula was not found (e.g. scanned copy): instrument-level tag
        slug = _gst_slug_in(title + " " + head, _GST_RULES_SLUGS)
        res.is_amending = True
        res.tags.append((_gst_instrument(res, instruments, slug[0] if slug else "cgst-rules-2017"), "amends"))

    # 2. rate / exemption notifications amending an earlier notification of the same series
    m = _GST_AMEND_NOTIFICATION.search(head)
    if m:
        target_num = re.sub(r"\s+", " ", m.group("num")).strip()
        target_key = norm_key(re.sub(r"\s*[-–—]\s*", "-", target_num))
        target = None
        for inst in instruments:
            k = inst.get("_key") or norm_key(inst["title"])
            if target_key and target_key in k:
                target = inst["slug"]
                break
        res.is_amending = True
        if target:
            res.tags.append((target, "amends"))
        else:
            # the earlier notification is not a tracked instrument: record the amendment on the Act it is issued under
            act_slug = _gst_series(doc) or next(iter(_gst_slug_in(head, _GST_ACT_SLUGS)), "cgst-act-2017")
            res.tags.append((_gst_instrument(res, instruments, act_slug), "amends"))

    # 3. the enabling provision: "In exercise of the powers conferred by section 164 of the CGST Act"
    for slug in _gst_slug_in(head, _GST_ACT_SLUGS):
        if slug == "cgst-act-2017" and not re.search(r"Central\s+Goods\s+and\s+Services\s+Tax\s+Act|\bCGST\s+Act\b", head, re.I):
            continue  # "said Act" alone is ambiguous
        t = (_gst_instrument(res, instruments, slug), "references")
        if t not in res.tags and (t[0], "amends") not in res.tags:
            res.tags.append(t)
    if not res.tags and not res.is_amending:
        act = _gst_series(doc)
        if act:
            res.tags.append((_gst_instrument(res, instruments, act), "references"))
    return res


def tag_gst_circular(doc: dict, text: str, instruments: list[dict]) -> RuleResult:
    """CBIC GST circular / order / instruction: clarifies the Acts and Rules whose provisions it cites."""
    res = RuleResult()
    body = text[:60000]
    cited_acts = _gst_slug_in(body, _GST_ACT_SLUGS)
    cited_rules = _gst_slug_in(body, _GST_RULES_SLUGS)
    has_section = bool(_GST_SECTION_REF.search(body) or _GST_SECTION_REF_SUB.search(body))
    has_rule = bool(_GST_RULE_CITE.search(body))
    if "cgst-act-2017" in cited_acts and not re.search(r"Central\s+Goods\s+and\s+Services\s+Tax\s+Act|\bCGST\s+Act\b", body, re.I):
        cited_acts.remove("cgst-act-2017")
    for slug in cited_acts:
        res.tags.append((_gst_instrument(res, instruments, slug), "clarifies" if has_section else "references"))
    for slug in cited_rules:
        res.tags.append((_gst_instrument(res, instruments, slug), "clarifies" if has_rule else "references"))
    if not res.tags:
        # "section 16(4)" cited without naming the Act: a GST circular means the CGST Act.
        if has_section:
            res.tags.append((_gst_instrument(res, instruments, "cgst-act-2017"), "clarifies"))
        elif has_rule:
            res.tags.append((_gst_instrument(res, instruments, "cgst-rules-2017"), "clarifies"))
    return res


def is_gst_document(doc: dict) -> bool:
    if (doc.get("regulator_code") or "").upper() == "CBIC":
        return True
    if "cbic" in (doc.get("source_url") or "").lower():
        return True
    return bool(re.search(r"(Central|Integrated|Union Territory) Tax(?:\s*\(Rate\))?$|Compensation Cess(?:\s*\(Rate\))?$|/\d{4}-GST\b", doc.get("number") or "", re.I))



# ---------------------------------------------------------------- SEBI

# "Securities and Exchange Board of India (Listing Obligations and Disclosure Requirements) Regulations, 2015"
SEBI_REG_NAME = r"(?:Securities and Exchange Board of India|SEBI)\s*\(\s*(?P<subject>[^)]{2,160}?)\s*\)?\s*Regulations,?\s*(?P<year>\d{4})"
_SEBI_TITLE = re.compile(
    r"^(?:Securities and Exchange Board of India|SEBI)\s*\(\s*(?P<subject>[^)]{2,160})\s*\)\s*"
    r"(?P<amend>\((?:[A-Za-z\- ]*?Amendment)\)\s*)?Regulations,?\s*(?P<year>\d{4})",
    re.I,
)
# "makes the following regulations to further amend the SEBI (...) Regulations, 2015"
_SEBI_PRINCIPAL = re.compile(
    r"(?:further\s+to\s+amend|to\s+further\s+amend|further\s+amend|amendments?\s+to)\s+the\s+" + SEBI_REG_NAME,
    re.I,
)
_SEBI_ANY_REG = re.compile(SEBI_REG_NAME, re.I)
# "In exercise of the powers conferred by section 30 of the Securities and Exchange Board of India Act, 1992"
_SEBI_ACT_SECTION = re.compile(
    r"\bsections?\s+(?P<num>\d{1,3}[A-Z]{0,2})\b[^.;]{0,160}?"
    r"(?P<act>Securities and Exchange Board of India Act,?\s*1992|Securities Contracts \(Regulation\) Act,?\s*1956|Depositories Act,?\s*1996)",
    re.I,
)
_SEBI_ACT_SLUGS = {
    "securities and exchange board of india act": "sebi-act-1992",
    "securities contracts": "scra-1956",
    "depositories act": "depositories-act-1996",
}
# "in regulation 17, in sub-regulation (1)" -> 17 ; "in Schedule II, Part A" -> Schedule II
_SEBI_REG_REF = re.compile(r"\bregulations?\s+(?P<num>\d{1,3}[A-Z]{0,3})\b", re.I)
_SEBI_SCHEDULE_REF = re.compile(r"\bSchedule\s+(?P<num>[IVXL]+|\d{1,2})\b")
_SEBI_CHANGE = re.compile(r"\b(shall|substitut|insert|omit|delet|renumber|added|replac|amend)", re.I)
# short names circulars use instead of the full title
_SEBI_ALIASES: list[tuple[str, str]] = [
    (r"\bLODR\b|Listing Obligations and Disclosure Requirements", "sebi-lodr-2015"),
    (r"\bICDR\b|Issue of Capital and Disclosure Requirements", "sebi-icdr-2018"),
    (r"\bSAST\b|Takeover Regulations|Substantial Acquisition of Shares and Takeovers", "sebi-sast-2011"),
    (r"\bPIT\b|Insider Trading Regulations|Prohibition of Insider Trading", "sebi-pit-2015"),
    (r"\bAIF\b|Alternative Investment Funds", "sebi-aif-2012"),
    (r"Mutual Funds\)?\s*Regulations", "sebi-mutual-funds"),
    (r"Portfolio Managers", "sebi-portfolio-managers-2020"),
    (r"Buy-?back of Securities", "sebi-buyback-2018"),
    (r"Delisting of Equity Shares", "sebi-delisting-2021"),
]


def _sebi_subject(title: str) -> str | None:
    """Normalised subject of a SEBI Regulation title, ignoring '[Last amended ...]' and the amendment marker."""
    t = re.sub(r"\[[^\]]*\]", " ", title or "")
    m = _SEBI_ANY_REG.search(t)
    if not m:
        return None
    subject = re.sub(r"\((?:[A-Za-z\- ]*?Amendment)\)", " ", m.group("subject"), flags=re.I)
    return norm_key(subject)


def _sebi_index(instruments: list[dict]) -> dict[str, dict]:
    """Subject key -> instrument, for every SEBI Regulation we track."""
    out: dict[str, dict] = {}
    for inst in instruments:
        key = _sebi_subject(inst.get("title") or "")
        if key:
            out.setdefault(key, inst)
    return out


def tag_sebi(doc: dict, text: str, instruments: list[dict]) -> RuleResult:
    """SEBI amendment regulations, circulars and master circulars."""
    res = RuleResult()
    by_slug = {i["slug"]: i for i in instruments}
    by_subject = _sebi_index(instruments)
    title = re.sub(r"\s+", " ", doc.get("title") or "").strip()
    # SEBI's gazette PDFs carry the full Hindi version before the English one, so the operative English wording can
    # start tens of thousands of characters in: search the whole document, not just its opening.
    head = text[:200_000]
    blob = f"{title}\n{head}"

    def add_tag(slug: str, relation: str) -> None:
        if slug and not any(s == slug for s, _ in res.tags):
            res.tags.append((slug, relation))

    # The enabling Act(s): "In exercise of the powers conferred by section 30 of the SEBI Act, 1992 ..."
    for m in _SEBI_ACT_SECTION.finditer(blob):
        act = m.group("act").lower()
        for needle, slug in _SEBI_ACT_SLUGS.items():
            if needle in act and slug in by_slug:
                add_tag(slug, "clarifies" if doc.get("doc_type") in ("circular", "master_circular") else "references")

    # Which principal Regulation does this amend?
    mt = _SEBI_TITLE.match(title)
    mp = _SEBI_PRINCIPAL.search(head)
    is_amendment = bool(mt and mt.group("amend")) or bool(re.search(r"\bAmendment\b", title, re.I)) or bool(mp)
    principal = mp or (mt if mt else None)

    if is_amendment and principal is not None:
        subject = re.sub(r"\((?:[A-Za-z\- ]*?Amendment)\)", " ", principal.group("subject"), flags=re.I)
        year = principal.group("year")
        inst = by_subject.get(norm_key(subject))
        if inst is None:
            for pattern, slug in _SEBI_ALIASES:
                if re.search(pattern, subject, re.I) and slug in by_slug:
                    inst = by_slug[slug]
                    break
        if inst is not None:
            slug = inst["slug"]
        else:
            slug = "sebi-" + re.sub(r"[^a-z0-9]+", "-", f"{subject} {year}".lower()).strip("-")[:70]
            res.new_instruments.append(
                NewInstrument(
                    slug=slug,
                    title=f"Securities and Exchange Board of India ({subject.strip()}) Regulations, {year}",
                    kind="regulations",
                    regulator="SEBI",
                    official_document=False,
                )
            )
        res.is_amending = True
        add_tag(slug, "amends")
        res.effects.extend(_sebi_effects(slug, text))
        return res

    # Circulars, master circulars and anything that only cites regulations: clarification, never an amendment.
    relation = "clarifies" if doc.get("doc_type") in ("circular", "master_circular") else "references"
    for m in _SEBI_ANY_REG.finditer(head):
        inst = by_subject.get(norm_key(m.group("subject")))
        if inst is not None:
            add_tag(inst["slug"], relation)
    for pattern, slug in _SEBI_ALIASES:
        if slug in by_slug and re.search(pattern, blob):
            add_tag(slug, relation)
    return res


def _sebi_effects(slug: str, text: str) -> list[Effect]:
    """Provision-level effects from "in regulation 17, in sub-regulation (1) ... shall be substituted"."""
    effects: list[Effect] = []
    paras = _paragraphs(text)
    seen: set[tuple[str, str]] = set()
    for i, p in enumerate(paras):
        instruction = re.split(r"namely|:-|:\s|[“\"]", p, maxsplit=1)[0]
        refs = [m.group("num") for m in _SEBI_REG_REF.finditer(instruction)]
        refs += [f"Schedule {m.group('num')}" for m in _SEBI_SCHEDULE_REF.finditer(instruction)]
        if not refs or not _SEBI_CHANGE.search(p):
            continue
        ct = _change_type(instruction)
        for num in refs[:3]:
            if (num, ct) in seen:
                continue
            seen.add((num, ct))
            effects.append(Effect(instrument_slug=slug, provision_number=num, change_type=ct, excerpt=_excerpt(paras, i)))
    return effects


# ---------------------------------------------------------------- Companies Act (MCA)
#
# MCA documents are formulaic too:
# - amending rules open "In exercise of the powers conferred by section 469 of the Companies Act, 2013 ... the
#   Central Government hereby makes the following rules further to amend the Companies (Incorporation) Rules, 2014"
#   and then list "in rule 8, in sub-rule (2), ..." / "in the said rules, in Form INC-9, ...";
# - a commencement notification says "the Central Government hereby appoints the 1st day of April, 2014 as the date
#   on which the provisions of section 135 of the said Act shall come into force";
# - a General Circular clarifies sections of the Act.

_MCA_RULES_NAME = r"(?:The\s+)?Companies\s*\((?P<subject>[^)]{2,140})\)\s*Rules,?\s*(?P<year>\d{4})"
_MCA_AMEND_RULES = re.compile(rf"(?:further\s+)?to\s+amend\s+the\s+{_MCA_RULES_NAME}", re.I)
_MCA_AMEND_TITLE = re.compile(
    r"(?:The\s+)?Companies\s*\((?P<subject>[^)]{2,140})\)\s*(?:[A-Za-z0-9\- ]*?)Amendment\s*Rules,?\s*(?P<year>\d{4})", re.I
)
_MCA_RULE_REF = re.compile(r"\b(?:in|after|before|for)\s+rules?\s+(?P<num>\d{1,3}[A-Z]{0,3})\b", re.I)
_MCA_FORM_REF = re.compile(
    r"\b(?:in|for|after|the)\s+(?:the\s+)?(?:said\s+rules,?\s*)?(?:in\s+)?e?\s?-?\s?Form\s+(?:No\.?\s*)?"
    r"(?P<num>[A-Z]{2,6}\s?-?\s?\d{1,3}[A-Z]{0,3})\b",
    re.I,
)
_MCA_CHANGE_VERB = re.compile(
    r"\b(shall\s+be\s+(?:inserted|substituted|omitted|added|renumbered)|inserted|substituted|omitted|deleted|renumbered|added)\b",
    re.I,
)
# "I. in rule 3,_" / "III. in rule 7,-" - an amending clause that opens a block of changes to one rule.
_MCA_OPENER_TAIL = re.compile(r"(?:[,;]\s*[-–—_]?\s*|\bfollowing\b)$|\bfollowing\b", re.I)
_MCA_COMMENCEMENT = re.compile(
    r"appoints?\s+the[^.;]{0,120}?as\s+the\s+dates?\s+on\s+which\s+the\s+provisions?\s+of\s+(?P<body>[^.;]{0,400})",
    re.I,
)
_MCA_SECTION_REF = re.compile(r"\bsections?\s+(?P<num>\d{1,3}[A-Z]{0,3})\b", re.I)
_MCA_ACT = re.compile(r"Companies\s+Act,?\s*2013|\bthe\s+said\s+Act\b", re.I)
_MCA_ACT_SLUG = "companies-act-2013"


def _mca_key(name: str) -> str:
    """Normalised name of a Rules set, without the leading "The" and without the year."""
    k = norm_key(re.sub(r"^\s*the\s+", "", name.strip(), flags=re.I))
    return re.sub(r"\s+\d{4}$", "", k).strip()


def _mca_rules_slug(instruments: list[dict], name: str) -> str | None:
    want = _mca_key(name)
    for inst in instruments:
        if inst.get("kind") == "rules" and _mca_key(inst["title"]) == want:
            return inst["slug"]
    return None


def _mca_form_number(raw: str) -> str:
    return "Form " + re.sub(r"[\s.]*-[\s.]*|\s+", "-", raw.strip().upper())


def _mca_unquoted(line: str) -> str:
    """The instruction part of a line. Gazette PDFs quote new wording with ― ‖ as well as “ ”."""
    s = re.sub(r"[“\"―][^”\"‖]*[”\"‖]", " ", line)
    return re.split(r"[“\"―]", s, maxsplit=1)[0]


def _mca_effects(text: str, slug: str) -> list[Effect]:
    """Walk the amending text: "in rule 3,_" opens a block, the change verbs inside it become effects.

    Amending rules are laid out as numbered clauses ("I. in rule 3,_", "II. for rule 6, the following rule shall be
    substituted", "in the said rules, in Form INC-9, ..."), each followed by its own sub-clauses, so a paragraph-level
    match misses the rule the sub-clauses belong to.
    """
    lines = [ln.strip() for ln in text.replace("\r", "").split("\n")]
    effects: list[Effect] = []
    seen: set[tuple[str, str]] = set()
    current: str | None = None
    block_start = 0
    verbs: list[str] = []

    def flush(end: int) -> None:
        if not current or not verbs:
            return
        excerpt = "\n".join(ln for ln in lines[block_start:end] if ln)[:2000]
        for ct in verbs:
            if (current, ct) in seen:
                continue
            seen.add((current, ct))
            effects.append(Effect(instrument_slug=slug, provision_number=current, change_type=ct, excerpt=excerpt))

    for i, raw in enumerate(lines):
        instruction = _mca_unquoted(raw)
        opener = None
        if len(instruction) < 400:
            m = _MCA_RULE_REF.search(instruction)
            if m and m.start() < 200:
                opener = m.group("num").upper()
            elif _MCA_CHANGE_VERB.search(instruction) or _MCA_OPENER_TAIL.search(instruction.strip()):
                mf = _MCA_FORM_REF.search(instruction)
                if mf and mf.start() < 200:
                    opener = _mca_form_number(mf.group("num"))
        if opener:
            flush(i)
            current, block_start, verbs = opener, i, []
        if current and _MCA_CHANGE_VERB.search(instruction):
            ct = _change_type(instruction)
            if ct not in verbs:
                verbs.append(ct)
    flush(len(lines))
    return effects[:40]


def tag_mca(doc: dict, text: str, instruments: list[dict]) -> RuleResult:
    """Companies Act notifications (amendment rules, commencement) and General Circulars."""
    res = RuleResult()
    known = {i["slug"] for i in instruments}
    title = re.sub(r"\s+", " ", doc.get("title") or "").strip()
    # Gazette copies carry the Hindi text first and the English text after it, so the opening formula can sit deep
    # into the document; scan the whole notification rather than a short head.
    head = text[:200_000]
    blob = f"{title}\n{head}"
    doc_type = doc.get("doc_type") or ""

    if doc_type in ("circular", "apdir_circular"):
        if _MCA_ACT.search(text) and _MCA_ACT_SLUG in known:
            relation = "clarifies" if _MCA_SECTION_REF.search(text) else "references"
            res.tags.append((_MCA_ACT_SLUG, relation))
        for inst in instruments:
            if inst.get("kind") == "rules" and _mca_key(inst["title"]) in _mca_key(text[:60000]):
                res.tags.append((inst["slug"], "clarifies"))
        return res

    # 1. amending rules: "makes the following rules further to amend the Companies (Incorporation) Rules, 2014"
    slug = None
    m = _MCA_AMEND_RULES.search(blob)
    if m:
        slug = _mca_rules_slug(instruments, f"Companies ({m.group('subject')}) Rules, {m.group('year')}")
    if slug is None:
        mt = _MCA_AMEND_TITLE.search(blob)
        if mt:
            slug = _mca_rules_slug(instruments, f"Companies ({mt.group('subject')}) Rules")
    if slug:
        res.is_amending = True
        res.tags.append((slug, "amends"))
        res.effects.extend(_mca_effects(text, slug))

    # 2. commencement notification: brings sections of the Act into force
    mc = _MCA_COMMENCEMENT.search(head)
    if mc and _MCA_ACT_SLUG in known and re.search(r"come\s+into\s+force", head, re.I):
        excerpt = head[max(0, mc.start() - 300):mc.end() + 300]
        seen: set[str] = set()
        for ms in _MCA_SECTION_REF.finditer(mc.group("body")):
            num = ms.group("num").upper()
            if num in seen:
                continue
            seen.add(num)
            res.is_amending = True
            res.effects.append(
                Effect(instrument_slug=_MCA_ACT_SLUG, provision_number=num, change_type="insert", excerpt=excerpt)
            )
        if seen:
            res.tags.append((_MCA_ACT_SLUG, "amends"))

    # 3. the enabling provision: every rule is made under the Companies Act, 2013
    if _MCA_ACT_SLUG in known and not any(s == _MCA_ACT_SLUG for s, _ in res.tags) and _MCA_ACT.search(blob):
        res.tags.append((_MCA_ACT_SLUG, "references"))
    return res


def is_mca_document(doc: dict) -> bool:
    if (doc.get("regulator_code") or "").upper() == "MCA":
        return True
    if "mca.gov.in" in (doc.get("source_url") or "").lower():
        return True
    return (doc.get("source_adapter") or "").startswith("mca")


def tag(doc: dict, text: str, instruments: list[dict]) -> RuleResult:
    """Route a document to the rule set for its regulator."""
    for inst in instruments:
        inst["_key"] = norm_key(inst["title"])
    if is_gst_document(doc):
        if doc.get("doc_type") in ("notification", "gsr"):
            return tag_gst_notification(doc, text, instruments)
        if doc.get("doc_type") in ("circular", "apdir_circular"):
            return tag_gst_circular(doc, text, instruments)
        return RuleResult()
    if (
        doc.get("regulator_code") == "SEBI"
        or "sebi.gov.in" in (doc.get("source_url") or "")
        or doc.get("source_adapter", "").startswith("sebi")
    ):
        return tag_sebi(doc, text, instruments)
    if (
        doc.get("regulator_code") == "MCA"
        or "mca.gov.in" in (doc.get("source_url") or "")
        or doc.get("source_adapter", "").startswith("mca")
    ):
        return tag_mca(doc, text, instruments)
    if doc.get("regulator_code") == "CBDT" or doc.get("source_adapter", "").startswith("cbdt"):
        return tag_cbdt(doc, text, instruments)
    if doc.get("doc_type") in ("notification", "gsr", "rules", "regulations"):
        return tag_notification(doc, text, instruments)
    if doc.get("doc_type") == "apdir_circular":
        return tag_circular(doc, text, instruments)
    return RuleResult()
