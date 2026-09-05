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


def tag(doc: dict, text: str, instruments: list[dict]) -> RuleResult:
    for inst in instruments:
        inst["_key"] = norm_key(inst["title"])
    if doc.get("regulator_code") == "CBDT" or doc.get("source_adapter", "").startswith("cbdt"):
        return tag_cbdt(doc, text, instruments)
    if doc.get("doc_type") in ("notification", "gsr", "rules", "regulations"):
        return tag_notification(doc, text, instruments)
    if doc.get("doc_type") == "apdir_circular":
        return tag_circular(doc, text, instruments)
    return RuleResult()
