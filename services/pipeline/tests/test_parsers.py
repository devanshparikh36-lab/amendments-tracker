import re
from pathlib import Path

import pytest

from amendments.adapters.rbi_apdir import _parse_rows
from amendments.adapters.rbi_common import extract_detail, parse_listing, parse_rbi_date, updated_as_on
from amendments.adapters.rbi_fema_notifications import DETAIL_PATTERN, classify, clean_number
from amendments.adapters.rbi_master_directions import is_fema_master_direction
from amendments.parsers.provisions import split_provisions

FIX = Path(__file__).parent / "fixtures"


def rd(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8", errors="ignore")


def test_parse_rbi_date_formats():
    assert str(parse_rbi_date("Jun 29, 2026")) == "2026-06-29"
    assert str(parse_rbi_date("02.9.2026")) == "2026-09-02"
    assert str(parse_rbi_date("September 02, 2026")) == "2026-09-02"
    assert str(parse_rbi_date("Updated as on February 16, 2026")) == "2026-02-16"
    assert parse_rbi_date("") is None


def test_updated_as_on_picks_latest():
    t = "March 26, 2019 (Updated as on February 16, 2026) (Updated as on January 12, 2026)"
    assert str(updated_as_on(t)) == "2026-02-16"
    assert str(updated_as_on("X ( Updated up to June 15, 2026 )")) == "2026-06-15"


def test_fema_listing():
    rows = parse_listing(rd("fema.html"), DETAIL_PATTERN)
    assert len(rows) >= 15
    first = rows[0]
    assert first.detail_url.startswith("https://www.rbi.org.in/Scripts/BS_FemaNotifications.aspx?Id=")
    assert first.date_issued is not None
    assert all(r.title for r in rows)
    assert any(r.pdf_urls for r in rows)
    assert clean_number("Notification No. FEMA 5(R)(6)/2026-RB") == "FEMA 5(R)(6)/2026-RB"
    assert classify("Foreign Exchange Management (Non-debt Instruments) (Amendment) Rules, 2026", "G.S.R. 123(E)") == "gsr"


def test_apdir_listing():
    docs = _parse_rows(rd("circ.html"))
    assert docs, "expected at least one A.P. (DIR Series) circular"
    assert all("DIR Series" in d.number for d in docs)
    assert all(d.date_issued for d in docs)


def test_master_direction_listing_filters_fema():
    rows = parse_listing(rd("md.html"), "BS_ViewMasDirections.aspx?id=")
    fema = [r for r in rows if is_fema_master_direction(re.sub(r"\s*\(Supersedes.*$", "", r.title))]
    assert 15 <= len(fema) <= 40
    assert any("External Commercial Borrowings" in r.title for r in fema)
    assert not any("Prudential Norms" in r.title for r in fema)


def test_detail_extraction_is_verbatim_and_finds_gazette_pdf():
    text, pdfs, heading = extract_detail(rd("fema_detail.html"), "https://www.rbi.org.in/Scripts/BS_FemaNotifications.aspx?Id=13553")
    assert "Notification No. FEMA 5(R)(6)/2026-RB" in text
    assert "In exercise of the powers conferred" in text
    assert any("GazetteNotification" in p for p in pdfs)
    assert not any("Accessibility" in p or "Utkarsh" in p for p in pdfs)


def test_master_direction_split_keeps_all_text():
    text, _, _ = extract_detail(rd("md_ecb.html"), "x")
    provs = split_provisions(text, style="master_direction")
    numbers = [p.number for p in provs]
    assert "13" in numbers and "15.1" in numbers and "17.2" in numbers
    by = {p.number: p for p in provs}
    assert by["15.1"].parent_number == "15"
    assert by["17.2"].footnotes, "footnote 7 should attach to 17.2"
    assert by["1 to 1.17"].footnotes
    kept = sum(len(p.text) for p in provs)
    assert kept >= 0.99 * len(text)
    # no INDEX table rows mistaken for provisions
    assert not any(" | " in p.number for p in provs)
    assert not any(p.text.startswith("2.1 |") for p in provs if p.level == "para")
    assert sum(1 for p in provs if p.level == "chapter") == 3


def test_master_direction_letter_parts_and_restarting_numbers():
    text, _, _ = extract_detail(rd("md_export.html"), "x")
    provs = split_provisions(text, style="master_direction")
    numbers = [p.number for p in provs]
    assert "A.1" in numbers and "B.12" in numbers and "C.31" in numbers and "D.1" in numbers
    assert sum(1 for p in provs if p.level == "chapter") == 4

    text, _, _ = extract_detail(rd("md_deposits.html"), "x")
    provs = split_provisions(text, style="master_direction")
    numbers = [p.number for p in provs]
    assert "3.2 (Part I)" in numbers and "3.2 (Part II)" in numbers
    assert len(set(numbers)) == len(numbers)
    by = {p.number: p for p in provs}
    assert by["3.2 (Part I)"].parent_number == "3 (Part I)"
