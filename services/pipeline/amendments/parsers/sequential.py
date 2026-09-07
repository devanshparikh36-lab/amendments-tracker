"""Split a consolidated Act or Regulation whose provisions are numbered in a strict sequence.

Legal drafting cross-references constantly ("...as required under regulation 17..."), and a naive parser that
starts a new provision wherever it sees a number produces text filed under the wrong regulation. That is worse
than useless on a site people cite from.

The fix is the one property these documents always have: the numbering only ever moves forward. A line opens a
new provision only when it starts with the number that is actually due next (allowing 17A after 17, and a small
forward jump for numbers that were omitted). Everything else, including every cross-reference, stays inside the
provision it was printed in.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from .provisions import ParsedProvision

# "17.", "17 ", "17A.", "17(1)" at the very start of a line; also "Regulation 17." / "Section 17."
_START = re.compile(
    r"^\s*(?:(?:Regulation|Rule|Section|Para(?:graph)?|Clause)\s+)?(?P<num>\d{1,3}[A-Z]{0,2})\s*[.)]?\s*(?=[(“\"A-Z]|$)",
)
_CHAPTER = re.compile(r"^\s*(CHAPTER|PART|SCHEDULE|ANNEX(?:URE)?)\b[\s\-:.]*(?P<num>[IVXLC]+|\d+|[A-Z])?\b(?P<rest>.*)$", re.I)
_HEADING_ONLY = re.compile(r"^[A-Z][A-Za-z ,'()/&-]{4,90}$")
# SEBI and CBIC print numbered footnotes at the foot of every page ("15 Substituted by the ... Regulations, 2023").
# They look exactly like a numbered provision, so they must be excluded explicitly.
_FOOTNOTE = re.compile(
    r"^\s*\d{1,3}\s+(Inserted|Substituted|Omitted|Deleted|Amended|Modified|Renumbered|Replaced|Added|Prior to|Came into|Notified|Effective|Vide|Ins\.|Subs\.)\b",
    re.I,
)


@dataclass
class _Key:
    number: int
    suffix: str

    @classmethod
    def parse(cls, raw: str) -> "_Key | None":
        m = re.fullmatch(r"(\d{1,3})([A-Z]{0,2})", raw.strip())
        return cls(int(m.group(1)), m.group(2)) if m else None

    def follows(self, previous: "_Key | None", *, max_gap: int = 3) -> bool:
        """True when this number can plausibly come next in the document's own sequence."""
        if previous is None:
            return self.number <= max_gap + 1
        if self.number == previous.number:
            # 17 -> 17A -> 17B, never back to a bare 17
            return bool(self.suffix) and self.suffix > previous.suffix
        return previous.number < self.number <= previous.number + max_gap


def split_sequential(text: str, *, max_gap: int = 3) -> list[ParsedProvision]:
    lines = text.replace("\r", "").split("\n")
    provisions: list[ParsedProvision] = []
    preamble: list[str] = []
    current: ParsedProvision | None = None
    previous: _Key | None = None
    chapter_label: str | None = None
    chapter_idx = -1
    pending_heading: str | None = None

    def flush(line: str) -> None:
        if current is None:
            preamble.append(line)
        else:
            current.text += "\n" + line

    for raw in lines:
        line = raw.rstrip()
        stripped = line.strip()
        if not stripped:
            flush("")
            continue

        m_ch = _CHAPTER.match(stripped)
        if m_ch and len(stripped) < 120:
            chapter_idx += 1
            label = re.sub(r"\s+", " ", stripped)[:70]
            chapter_label = label
            provisions.append(
                ParsedProvision(number=label, heading=label, text=stripped, level="chapter", raw_number=label, chapter_idx=chapter_idx)
            )
            current = provisions[-1]
            pending_heading = None
            continue

        if _FOOTNOTE.match(stripped):
            flush(stripped)
            continue

        m = _START.match(stripped)
        key = _Key.parse(m.group("num")) if m else None
        if key is not None and key.follows(previous, max_gap=max_gap):
            body = stripped[m.end():].strip()
            heading = pending_heading
            if not heading and body and _HEADING_ONLY.match(body):
                heading, body = body, ""
            provisions.append(
                ParsedProvision(
                    number=m.group("num"),
                    heading=heading,
                    text=stripped,
                    level="section",
                    raw_number=m.group("num"),
                    chapter_idx=chapter_idx,
                    chapter_label=chapter_label,
                )
            )
            current = provisions[-1]
            previous = key
            pending_heading = None
            continue

        # A short title line just before a numbered provision is that provision's heading.
        pending_heading = stripped if _HEADING_ONLY.match(stripped) and len(stripped) < 90 else None
        flush(stripped)

    if preamble:
        provisions.insert(
            0,
            ParsedProvision(number="Preamble", heading="Preamble", text="\n".join(preamble).strip(), level="section", raw_number="Preamble"),
        )
    for p in provisions:
        p.text = re.sub(r"\n{3,}", "\n\n", p.text).strip()
    return [p for p in provisions if p.text]
