"""Provisions must open at the right page of the regulator's own PDF.

The fixture is SEBI's published copy of the Depositories Act, 1996 (Legal > Acts, "as amended by the
International Financial Services Centres Authority Act, 2019 w.e.f. October 01, 2020"), downloaded verbatim from
www.sebi.gov.in. It has the layout that breaks naive matching: three pages of "ARRANGEMENT OF SECTIONS" naming
every section before the text begins, amendment markers printed against the section numbers, and footnotes.
"""
from pathlib import Path

import re

import pytest

from amendments.adapters.base import SeedResult, as_seed_result
from amendments.parsers.pdfmap import build_index, find_pages
from amendments.parsers.provisions import ParsedProvision, split_provisions

FIX = Path(__file__).parent / "fixtures"
PDF = FIX / "sebi_depositories_act_1996.pdf"


@pytest.fixture(scope="module")
def index():
    return build_index(PDF.read_bytes())


def prov(number: str, heading: str | None = None) -> ParsedProvision:
    return ParsedProvision(number=number, heading=heading, text="x", level="section")


def test_index_skips_the_arrangement_of_sections(index):
    # 26, counted from the file rather than taken from this test's first draft, which said 27.
    assert index.page_count == 26
    # The three contents pages name every section; the text starts on page 4 ("DEPOSITORIES ACT, 1996").
    assert index.toc_pages == {0, 1, 2}


def test_sections_map_to_the_page_they_are_printed_on(index):
    # Verified against the PDF: section 4 ("Agreement between depository and participant") starts on page 5,
    # section 8 on page 6, section 19 on page 9 and section 25 on page 23 - not on the contents pages.
    wanted = {"4": 5, "8": 6, "14": 8, "18": 9, "19": 9, "24": 23, "25": 23, "28": 25}
    provisions = [prov(n) for n in wanted]
    assert find_pages(index, provisions) == len(provisions)
    assert {p.number: p.pdf_page for p in provisions} == wanted


def test_most_of_the_act_is_located(index):
    """Across the whole Act, not a hand-picked handful, and never onto the contents pages.

    This used to re-split `index.pages` with `split_provisions` to get its provision list. That input does
    not occur: `pages` is whitespace-collapsed, one line per page, and the splitter finds section starts by
    line -- so it returned 7 provisions and the test failed for a reason that had nothing to do with the
    thing under test. In the pipeline `split_provisions` is given the regulator's own text and `find_pages`
    is given what came out of it; the two never meet the way this test arranged.

    So the provision list is taken from the contents listing instead, which is both realistic and a wider
    net than naming sections by hand -- it is every section the Act declares it has.
    """
    numbers = [
        ln.strip().rstrip(".")
        for page in index.lines[:3]
        for ln in page
        if re.fullmatch(r"\s*\d{1,3}[A-Z]{0,3}\.?\s*", ln)
    ]
    assert len(numbers) > 20, f"the contents pages should name the whole Act, found {numbers}"
    provisions = [prov(n) for n in dict.fromkeys(numbers)]
    found = find_pages(index, provisions)
    assert found >= len(provisions) * 0.8, f"located only {found} of {len(provisions)}"
    for p in provisions:
        if p.pdf_page:
            assert 4 <= p.pdf_page <= index.page_count, f"{p.number} landed on page {p.pdf_page}"


def test_cross_reference_does_not_win_over_the_heading(index):
    """"...under section 19" appears long before section 19 itself; the printed heading must win."""
    p = prov("19")
    find_pages(index, [p])
    assert p.pdf_page == 9


def test_unlocated_provision_keeps_pdf_page_none(index):
    p = prov("9999")
    assert find_pages(index, [p]) == 0
    assert p.pdf_page is None


def test_seed_result_accepts_the_old_tuple_contract():
    """Seeders that still return `(text, updated_as_on, source_url)` must keep working."""
    r = as_seed_result(("some text", None, "https://example.gov.in/x"))
    assert isinstance(r, SeedResult) and r.text == "some text" and r.provisions is None
    listed = as_seed_result(([prov("1")], None, "https://example.gov.in/x"))
    assert listed.text is None and len(listed.provisions) == 1
    assert as_seed_result(SeedResult(text="t")).text == "t"
