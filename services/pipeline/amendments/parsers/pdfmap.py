"""Locate each provision inside the official PDF, so the site can open the regulator's own file at that page.

The pipeline stores the regulator's PDF verbatim in object storage; this module answers "which page does
section 80C start on?" so a reader is taken straight there instead of being asked to trust our transcription.

Matching is deliberately conservative. Three things wreck a naive search and are handled here:

  * the table of contents at the front of every Regulation and Master Direction lists *every* number, so a plain
    search sends all provisions to page 2. Contents pages are detected (dot leaders / trailing page numbers) and
    skipped.
  * cross-references ("as required under regulation 17") match the number long before the provision starts, so a
    match at the start of a line ("17. Corporate governance") outranks a match buried inside a paragraph.
  * numbering is read in document order, so the search for each provision starts where the previous one was found.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import fitz  # PyMuPDF

log = logging.getLogger(__name__)


@dataclass
class PdfIndex:
    page_count: int
    pages: list[str]                              # whitespace-collapsed text per page (index 0 = page 1)
    lines: list[list[str]] = field(default_factory=list)   # the lines of each page, indentation preserved
    toc_pages: set[int] = field(default_factory=set)       # 0-based pages that are a table of contents


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", _chars(text)).strip()


def _chars(text: str) -> str:
    text = text.replace("\xa0", " ").replace("–", "-").replace("—", "-")
    text = re.sub(r"[‘’]", "'", text)
    return re.sub(r"[“”]", '"', text)


# "17. Corporate governance ......... 45" / "17 Corporate governance      45" - a contents line, not the provision.
_TOC_LINE = re.compile(r"(?:\.\s?){4,}\s*\d{1,4}\s*$|\S\s{3,}\d{1,4}\s*$")
# Indian Acts and Rules open with an "ARRANGEMENT OF SECTIONS" list that names every section but prints no text.
_CONTENTS_HEADING = re.compile(
    r"ARRANGEMENT OF (?:SECTIONS|RULES|REGULATIONS|CLAUSES|PARAGRAPHS)|TABLE OF CONTENTS|^[ \t]*(?:CONTENTS|INDEX)[ \t]*$",
    re.I | re.M,
)
# A contents list wraps onto further pages without repeating its heading; body pages are recognised by their
# full-width prose, so the run ends at the first page carrying a line of normal length.
_BODY_LINE_WIDTH = 88
_MAX_CONTENTS_PAGES = 15


# A line that is nothing but a provision number: "1.", " 19A.", "23F.". On a contents page these stand in a
# column of their own; in the body of an Act a number is always followed by the text of the provision.
_NUMBER_ONLY_LINE = re.compile(r"^\s*\d{1,3}[A-Z]{0,3}\.?\s*$")


def _is_toc_page(lines: list[str]) -> bool:
    """Whether this page is part of the contents listing rather than the text.

    Two signals, because one of them was not enough. The first looks for dot leaders or a trailing page
    number -- "17. Corporate governance ....... 45" -- which is how a contents page usually reads.
    PyMuPDF 1.28 extracts this Act's contents with neither: no leaders, no page numbers, and the number on
    its own line above the heading.

        '1.'
        'Short title, extent and commencement.'

    So the first signal matched nothing and every contents page passed as body text. (That is also why the
    rescued version of this module failed four of its own five tests when it was brought back: it was
    written against an extraction that produced the other shape.)

    The second signal is what that extraction does give, measured on the Depositories Act rather than
    guessed. Contents pages there have a widest line of 71-81 characters and 42-63 per cent of their lines
    bare numbers; body pages reach 90-118 characters and have none at all. The gap is wide and
    `_BODY_LINE_WIDTH` already sat inside it.
    """
    body = [ln for ln in lines if len(ln.strip()) > 3]
    if len(body) < 5:
        return False
    hits = sum(1 for ln in body if _TOC_LINE.search(ln))
    if hits >= max(4, len(body) * 0.4):
        return True
    # No page numbers to find. A page with prose on it is not a contents page whatever else it contains, so
    # the width test comes first and is a veto.
    if max((len(ln.strip()) for ln in lines), default=0) >= _BODY_LINE_WIDTH:
        return False
    numbers = sum(1 for ln in lines if _NUMBER_ONLY_LINE.match(ln))
    return numbers >= max(4, len(body) * 0.3)


def build_index(data: bytes) -> PdfIndex:
    doc = fitz.open(stream=data, filetype="pdf")
    pages: list[str] = []
    lines: list[list[str]] = []
    toc: set[int] = set()
    in_contents = False
    run = 0
    for n, page in enumerate(doc):
        raw = _chars(page.get_text("text"))
        page_lines = [ln.rstrip() for ln in raw.splitlines()]
        pages.append(re.sub(r"\s+", " ", raw).strip())
        lines.append(page_lines)
        if _CONTENTS_HEADING.search(raw):
            in_contents, run = True, 0
        elif in_contents:
            widest = max((len(ln.strip()) for ln in page_lines), default=0)
            if widest >= _BODY_LINE_WIDTH or run >= _MAX_CONTENTS_PAGES:
                in_contents = False
        if in_contents:
            run += 1
            toc.add(n)
        elif _is_toc_page(page_lines):
            toc.add(n)
    count = len(pages)
    doc.close()
    # A document whose every page looks like a list is not a document with a contents page: trust none of it.
    if count and len(toc) > count * 0.4:
        toc = set()
    return PdfIndex(page_count=count, pages=pages, lines=lines, toc_pages=toc)


_LABEL = r"(?:Section|Regulation|Rule|Para(?:graph)?|Clause|Chapter|Part)"
# A numbered line at the foot of the page is a footnote about an amendment, not the provision it amends.
_FOOTNOTE_TEXT = re.compile(
    r"^\s*(Ins(?:erted)?|Subs(?:tituted)?|Omitted|Deleted|Amended|Modified|Renumbered|Replaced|Updated|Added|"
    r"Prior to|Vide|w\.e\.f\.|Notified|Effective)\b",
    re.I,
)


def _patterns(number: str, heading: str | None, level: str) -> tuple[list[re.Pattern], list[re.Pattern], re.Pattern | None]:
    """(start-of-line patterns, anywhere patterns, heading pattern) for one provision."""
    num = re.escape(number.strip())
    if level == "chapter":
        strong = [rf"^\s*{_LABEL}?\s*{num}\b", rf"^\s*{num}\b"]
        weak = [rf"\b{num}\b"]
    else:
        strong = [
            # "17." / "17)" / "17-" and "148[17." (an amendment marker printed before the number)
            rf"^\s*\d{{0,3}}\s*\[?\s*{num}\s*[.):\-]",
            # "Regulation 17." - the punctuation matters: "regulation 17 shall be fulfilled by" is a
            # cross-reference that happens to have wrapped onto a new line, not the start of regulation 17.
            rf"^\s*{_LABEL}\s+{num}\s*[.:)\-]",
        ]
        weak = [
            rf"(?<![\w.]){num}\s*[.)]\s",
            rf"\b{_LABEL}\s+{num}\b",
            rf"(?<![\w.]){num}\s*[.)]?\s*[-]\s",
        ]
    head = None
    if heading:
        h = _norm(heading)[:60]
        if len(h) > 12:
            head = re.compile(re.escape(h), re.I)
    return ([re.compile(p, re.I) for p in strong], [re.compile(p, re.I) for p in weak], head)


def _starts_provision(line: str, strong: list[re.Pattern]) -> bool:
    for pat in strong:
        m = pat.match(line)
        if m and not _FOOTNOTE_TEXT.match(line[m.end():]):
            return True
    return False


# A page behind the reading position costs this much more than a page ahead of it, so ties go forwards.
_BACKWARD_PENALTY = 3


def find_pages(index: PdfIndex, provisions: list, *, start_hint: int = 0) -> int:
    """Set `pdf_page` (1-based) on each provision. Returns how many were located.

    Candidate pages are collected across the whole document and ranked in tiers. A page that prints the number as
    a heading ("17." on its own line, or "Regulation 17.") is decisive, and the first such page wins: the body of
    an instrument prints each provision once, before the schedules that quote it, while contents pages,
    footnotes and cross-references are excluded outright. Weaker evidence - the provision's heading text, or its
    number mentioned anywhere - is resolved against the reading position instead, since order is all that
    separates a real occurrence from the dozens of mentions such a number collects.

    Reading position is a hint, not a rule, because a regulator's consolidated text does not always parse in
    printed order: SEBI's LODR page interleaves inserted sub-regulations well away from where they are printed.
    """
    found = 0
    cursor = start_hint
    for prov in provisions:
        strong, weak, heading = _candidates(index, prov)
        # `weak` is deliberately not used to place a provision, only `strong` (the number printed as a
        # heading) and `heading` (the provision's own title in the text).
        #
        # Weak evidence is "this number appears somewhere on this page", and on a real document that is not
        # evidence at all. Measured on FEMA's borrowing-and-lending notification, whose annex carries its own
        # numbering: regulation 1 ("Eligible borrowers") was placed on page 1, the RBI letterhead, because a
        # "1" appears there; regulation 5 ("Lending in Foreign Exchange by a Person Resident in India") went
        # to page 10, mid-clause. Three disagreements were opened by hand and all three weak placements were
        # wrong.
        #
        # Including them raised the number of provisions "located" from 20 to 165 across ten instruments,
        # which is why this had to be checked rather than counted: those provisions currently have no page,
        # so a reader opens the file at the front and searches. Giving them a confident wrong page is worse
        # than giving them none -- it looks like help. `weak` stays computed because `_candidates` returns it
        # and it is useful when debugging why a provision was not found.
        del weak
        # When the document contains the provision's own heading, that heading decides -- and a page that
        # prints both the number and the heading decides best of all.
        #
        # The number alone is not enough, which measurement showed and reading would not have. FEMA's
        # borrowing-and-lending notification carries an ECB framework annex with its own numbered list, so
        # a line beginning "5." exists on several pages that have nothing to do with regulation 5. Placing
        # it by number put "Lending in Foreign Exchange by a Person Resident in India" on page 10,
        # mid-clause, and regulation 1 on the RBI letterhead. Twenty-seven of that instrument's twenty-eight
        # headings do appear in the file, so the evidence to tell them apart was there and unused.
        #
        # Where a heading is absent from the document altogether -- two FEM regulation sets have none of
        # theirs, because the stored PDF is not the document the provisions were parsed from -- there is
        # nothing to corroborate with and the number stands on its own, as before.
        # Same threshold `_patterns` uses to decide a heading is worth searching for, so the two agree about
        # which provisions have one.
        has_usable_heading = bool(prov.heading and len(_norm(prov.heading)[:60]) > 12)
        if heading:
            both = [p for p in strong if p in heading]
            page = both[0] if both else _nearest(heading, cursor)
        elif has_usable_heading:
            # The provision has a heading and this document contains it nowhere, which means the stored PDF
            # is not the document these provisions were parsed from -- it happens, because the text comes
            # from the regulator's web page and the PDF from a notification that only partly overlaps it.
            # A number matching in a document that lacks the heading is a coincidence, so nothing is
            # recorded.
            #
            # This is the rule that decided whether adopting this module was worth it at all. Measured
            # across the eight instruments with the most provisions: where the heading is present, the
            # assigned page carries it 54 times out of 54; where it is absent, all 41 number-only
            # placements were in documents whose headings appear zero times, and spot checks landed
            # mid-clause. Keeping them would have turned "no page, so open at the front and search" into
            # "page 10", confidently and wrongly.
            page = None
        else:
            page = strong[0] if strong else None
        if page is not None:
            prov.pdf_page = page + 1          # 1-based for PDF viewers
            cursor = max(cursor, page)
            found += 1
    return found


def _nearest(pages: list[int], cursor: int) -> int | None:
    if not pages:
        return None
    return min(pages, key=lambda p: (p - cursor) if p >= cursor else _BACKWARD_PENALTY * (cursor - p) + 1)


def _candidates(index: PdfIndex, prov) -> tuple[list[int], list[int], list[int]]:
    """Pages that (a) print this provision's number as a heading, (b) match its heading, (c) mention its number."""
    strong_pat, weak_pat, heading_pat = _patterns(prov.number, prov.heading, prov.level)
    strong: list[int] = []
    weak: list[int] = []
    head: list[int] = []
    for page_no in range(index.page_count):
        if page_no in index.toc_pages:
            continue
        text = index.pages[page_no]
        if not text:
            continue
        has_heading = bool(heading_pat and heading_pat.search(text))
        has_weak = any(p.search(text) for p in weak_pat)
        if not (has_heading or has_weak):
            continue
        page_lines = index.lines[page_no] if page_no < len(index.lines) else []
        if any(_starts_provision(ln, strong_pat) for ln in page_lines):
            strong.append(page_no)
        if has_heading:
            head.append(page_no)
        if has_weak:
            weak.append(page_no)
    return strong, weak, head
