"""Split consolidated legal text into numbered provisions.

Handles the layout of an RBI Master Direction (cover letter, INDEX, ACRONYMS, PART headings, numbered paras
"13." / "15.1" / "A.1" / "B.2", APPENDIX, then numbered footnotes), FEM Regulations ("Regulation 5" / "5.") and an
Act ("6." / "6A."). Text that cannot be attributed to a numbered provision is attached to the preceding one, so
nothing is lost. Footnote markers such as "4[Deleted]" stay verbatim and the footnote text is attached.

Numbering that restarts in each PART (common in Master Directions) is disambiguated as "3.2 (Part II)".
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# "15.1" / "15.1.2" (dotted hierarchy, trailing dot optional) or "13." (top level needs the dot)
_PARA_DOTTED = re.compile(r"^(?P<num>\d{1,3}(?:\.\d{1,3}){1,3})\.?\s+(?=\S)")
_PARA_TOP = re.compile(r"^(?P<num>\d{1,3})\.\s+(?=\S)")
# "A.1" / "B.12" / "C.2.1" (letter-prefixed parts)
_PARA_LETTER = re.compile(r"^(?P<num>[A-Z]\.\d{1,3}(?:\.\d{1,3})?)\.?\s+(?=\S)")
# "Section 6." / "Regulation 5." / "Rule 4."
_LABELLED = re.compile(r"^(?:Section|Regulation|Rule|Paragraph|Para|Clause)\s+(?P<num>\d{1,3}[A-Z]{0,2})\.?\s*[-:.]?\s*", re.I)
# "6A. Heading" (Acts)
_ACT_SEC = re.compile(r"^(?P<num>\d{1,3}[A-Z]{1,2})\.\s+(?=[A-Z(\"'“])")
_CHAPTER = re.compile(r"^(?:PART|CHAPTER|SCHEDULE|ANNEX(?:URE)?)\b[\s\-:–—]*(?P<num>[IVXLC]+|\d+|[A-Z])?\b.*$", re.I)
_APPENDIX = re.compile(r"^(APPENDIX|List of (Notifications|Circulars)|Annex\s*[-–—:]?\s*List)", re.I)
_INDEX = re.compile(r"^(INDEX|CONTENTS|TABLE OF CONTENTS|ACRONYMS|ABBREVIATIONS|DEFINITIONS OF TERMS)\b", re.I)
_DELETED_RANGE = re.compile(r"^(?P<a>\d{1,3}(?:\.\d{1,3})*)\s+to\s+(?P<b>\d{1,3}(?:\.\d{1,3})*)\s+\d*\s*\[Deleted\]", re.I)
_FOOTNOTE_LINE = re.compile(r"^(?P<n>\d{1,3})\s+(?=[A-Z“\"'(])")
_FOOTNOTE_VERB = re.compile(r"^\d{1,3}\s+(Inserted|Deleted|Substituted|Amended|Modified|Omitted|Renumbered|Prior to|Replaced|Updated|Added)\b", re.I)
# "1. Inserted by section 118 of ..." / "5. Omitted “or section 43A” (w.e.f. ...) by s. 100 of ..." - a footnote printed
# under its own section (CBIC section pages). A real section heading never starts with one of these verbs.
_INLINE_FOOTNOTE = re.compile(r"^\d{1,3}\.\s+(Inserted|Deleted|Substituted|Amended|Modified|Omitted|Renumbered|Replaced|Updated|Added)\b", re.I)


@dataclass
class ParsedProvision:
    number: str
    heading: str | None
    text: str
    level: str = "para"             # chapter | section | para | annex
    parent_number: str | None = None
    footnotes: list[str] = field(default_factory=list)
    # internal
    raw_number: str = ""
    chapter_idx: int = -1
    chapter_label: str | None = None


def _parent_of(num: str) -> str | None:
    return num.rsplit(".", 1)[0] if "." in num and not re.match(r"^[A-Z]\.\d+$", num) else None


def _heading_from(body: str) -> str | None:
    m = re.match(r"^(?P<h>[A-Z][^:.]{2,80}):\s", body)
    if m:
        return m.group("h").strip()
    if len(body) <= 80 and not body.endswith((".", ";", ",")):
        return body
    return None


def _norm_label(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", label.lower())


def _chapter_short(label: str) -> str:
    m = re.match(r"^(PART|CHAPTER|SCHEDULE|ANNEX(?:URE)?)\s*[-–—:]?\s*([A-Z0-9IVX]+)?", label, re.I)
    if not m:
        return label[:20]
    return f"{m.group(1).title()} {m.group(2) or ''}".strip()


def _is_chapter(line: str) -> bool:
    return bool(_CHAPTER.match(line)) and len(line) < 140 and " | " not in line


def _match_number(line: str, style: str):
    m = None
    if style in ("auto", "regulations", "act"):
        m = _LABELLED.match(line)
    if m is None and style in ("auto", "master_direction"):
        m = _PARA_DOTTED.match(line) or _PARA_LETTER.match(line) or _PARA_TOP.match(line)
    if m is None and style in ("auto", "act", "regulations"):
        m = _ACT_SEC.match(line) or _PARA_TOP.match(line)
    return m


def _is_real_para(line: str, style: str) -> bool:
    if " | " in line:
        return False
    if _DELETED_RANGE.match(line):
        return True
    return bool(_match_number(line, style)) and len(line) > 40


def _find_body_start(lines: list[str], style: str) -> int | None:
    """Index of the first body line in a document that has an INDEX/CONTENTS block.

    Two signals: a PART heading already listed in the index appears again; or the first numbered line that reads
    like a paragraph, backing up over the short headings immediately before it ("Part I", "1. Introduction").
    """
    first_index = next((i for i, ln in enumerate(lines) if ln and _INDEX.match(ln) and len(ln) < 60), None)
    if first_index is None:
        return None
    seen_chapters: set[str] = set()
    cand_repeat: int | None = None
    cand_para: int | None = None
    for i in range(first_index + 1, len(lines)):
        ln = lines[i]
        if not ln:
            continue
        if _is_chapter(ln):
            key = _norm_label(ln)
            if key in seen_chapters:
                cand_repeat = i
                break
            seen_chapters.add(key)
            continue
        if _is_real_para(ln, style):
            j = i - 1
            while j > first_index:
                prev = lines[j]
                if not prev:
                    j -= 1
                    continue
                is_short_num = " | " not in prev and bool(_match_number(prev, style)) and len(prev) <= 40
                if _is_chapter(prev) or is_short_num:
                    j -= 1
                    continue
                break
            cand_para = j + 1
            break
    cands = [c for c in (cand_repeat, cand_para) if c is not None]
    return min(cands) if cands else None


def split_provisions(text: str, *, style: str = "auto") -> list[ParsedProvision]:
    lines = [ln.strip() for ln in text.replace("\r", "").split("\n")]
    has_chapters = any(_is_chapter(ln) for ln in lines if ln)
    has_index = any(_INDEX.match(ln) and len(ln) < 60 for ln in lines if ln)
    body_start = _find_body_start(lines, style) if has_index else None

    provisions: list[ParsedProvision] = []
    footnote_lines: list[str] = []
    current: ParsedProvision | None = None
    region = "preamble" if (has_chapters or has_index) else "body"
    body_paras = 0
    chapter_idx = -1
    chapter_label: str | None = None

    def start(p: ParsedProvision) -> None:
        nonlocal current
        p.chapter_idx = chapter_idx
        p.chapter_label = chapter_label
        provisions.append(p)
        current = p

    def append(line: str) -> None:
        if current is None:
            start(ParsedProvision(number="Preamble", heading="Preamble", text=line, level="section", raw_number="Preamble"))
        else:
            current.text = (current.text + "\n" + line) if current.text else line

    for i, line in enumerate(lines):
        if not line:
            if current is not None and current.text and not current.text.endswith("\n"):
                current.text += "\n"
            continue

        if region == "appendix":
            footnote_lines.append(line)
            continue

        is_chapter = _is_chapter(line)
        is_index = bool(_INDEX.match(line)) and len(line) < 60
        is_appendix = bool(_APPENDIX.match(line)) and len(line) < 120

        if body_start is not None and i >= body_start and region in ("preamble", "front"):
            region = "body"

        if region in ("front", "body") and is_appendix and body_paras >= 3:
            region = "appendix"
            footnote_lines.append(line)
            continue

        if is_index and region in ("preamble", "front"):
            region = "front"
            start(ParsedProvision(number=line[:40].title(), heading=line, text=line, level="section", raw_number=line[:40].title()))
            continue

        if region == "front":
            # INDEX / ACRONYMS contents up to body_start: never provisions.
            append(line)
            continue

        if is_chapter:
            region = "body"
            chapter_idx += 1
            chapter_label = _chapter_short(line)
            start(ParsedProvision(number=line[:60], heading=line, text=line, level="chapter", raw_number=line[:60]))
            continue

        if region == "preamble":
            if body_start is None and not has_index and _is_real_para(line, style):
                region = "body"  # documents without an index: the numbered text simply begins
            else:
                append(line)
                continue

        # ---- body ----
        m_del = _DELETED_RANGE.match(line)
        if m_del:
            num = f"{m_del.group('a')} to {m_del.group('b')}"
            start(ParsedProvision(number=num, heading=None, text=line, level="para", raw_number=num))
            body_paras += 1
            continue

        if current is not None and style != "master_direction" and _INLINE_FOOTNOTE.match(line):
            # CBIC section pages print each section's footnotes right after it ("1. Inserted by section 118 of ...");
            # they stay with that section instead of opening a provision numbered "1".
            current.footnotes.append(line)
            append(line)
            continue

        if body_paras >= 5 and _FOOTNOTE_VERB.match(line):
            region = "appendix"
            footnote_lines.append(line)
            continue

        m = _match_number(line, style)
        if m:
            num = m.group("num").rstrip(".")
            body = line[m.end():].strip()
            start(
                ParsedProvision(
                    number=num,
                    heading=_heading_from(body),
                    text=line,
                    level="para" if ("." in num or style == "master_direction") else "section",
                    parent_number=_parent_of(num),
                    raw_number=num,
                )
            )
            body_paras += 1
            continue

        append(line)

    # ---- disambiguate numbers that restart in each PART, and resolve parents within the same chapter ----
    paras = [p for p in provisions if p.level not in ("chapter", "section", "annex")]
    chapters_by_number: dict[str, set[int]] = {}
    for p in paras:
        chapters_by_number.setdefault(p.raw_number, set()).add(p.chapter_idx)
    scoped = any(len(s) > 1 for s in chapters_by_number.values())
    display: dict[tuple[int, str], str] = {}
    taken: dict[str, int] = {}
    for p in paras:
        cand = f"{p.raw_number} ({p.chapter_label})" if (scoped and p.chapter_label) else p.raw_number
        if cand in taken:
            taken[cand] += 1
            cand = f"{cand} ({taken[cand]})"
        else:
            taken[cand] = 1
        p.number = cand
        display[(p.chapter_idx, p.raw_number)] = p.number
    for p in provisions:
        if p.parent_number:
            p.parent_number = display.get((p.chapter_idx, p.parent_number))
    seen_any: dict[str, int] = {}
    for p in provisions:
        if p.number in seen_any:
            seen_any[p.number] += 1
            p.number = f"{p.number} ({seen_any[p.number]})"
        else:
            seen_any[p.number] = 1

    # ---- footnotes ----
    footnotes: list[str] = []
    for fn in footnote_lines:
        m = _FOOTNOTE_LINE.match(fn)
        if not m:
            if footnotes:
                footnotes[-1] += " " + fn
            continue
        footnotes.append(fn)
    for fn in footnotes:
        marker = _FOOTNOTE_LINE.match(fn).group("n")
        for p in provisions:
            if p.level in ("chapter", "section", "annex"):
                continue
            if re.search(rf"(?<![\d.]){marker}\s*\[|\]\s*{marker}(?!\d)|(?<=[a-z.)\]])\s*{marker}$", p.text, re.M):
                p.footnotes.append(fn)
                break

    if footnote_lines:
        provisions.append(
            ParsedProvision(number="Appendix and Footnotes", heading="Appendix and Footnotes", text="\n".join(footnote_lines), level="annex", raw_number="Appendix and Footnotes")
        )
    for p in provisions:
        p.text = re.sub(r"\n{3,}", "\n\n", p.text).strip()
    return [p for p in provisions if p.text]
