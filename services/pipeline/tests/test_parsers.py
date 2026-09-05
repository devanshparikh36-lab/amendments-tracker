import re
from pathlib import Path

import pytest

from amendments.adapters.rbi_apdir import _parse_rows
from amendments.adapters.rbi_common import extract_detail, parse_listing, parse_rbi_date, updated_as_on
from amendments.adapters.rbi_fema_notifications import DETAIL_PATTERN, classify, clean_number
from amendments.adapters.rbi_master_directions import is_fema_master_direction
from amendments.adapters import sebi
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


def test_rule_based_tagging_of_amendment_notification():
    from amendments import rules

    text, _, _ = extract_detail(rd("fema_detail.html"), "x")
    doc = {"doc_type": "notification", "title": "Foreign Exchange Management (Deposit) (Sixth Amendment) Regulations, 2026"}
    res = rules.tag(doc, text, [{"slug": "fema-1999", "title": "Foreign Exchange Management Act, 1999", "kind": "act"}])
    assert res.is_amending
    assert ("fem-deposit-regulations-2016", "amends") in res.tags
    assert res.new_instruments and res.new_instruments[0].kind == "regulations" and not res.new_instruments[0].official_document
    effects = {(e.provision_number, e.change_type) for e in res.effects}
    assert ("2", "insert") in effects and ("5", "substitute") in effects
    assert any(n.startswith("Schedule") for n, _ in effects)

    original = rules.tag(
        {"doc_type": "notification", "title": "Foreign Exchange Management (Guarantees) Regulations, 2026"},
        "In exercise of the powers conferred by section 6 of the Foreign Exchange Management Act, 1999 and in supersession of the earlier regulations, the Reserve Bank makes the following regulations",
        [],
    )
    assert not original.is_amending
    assert original.new_instruments[0].official_document
    assert ("fem-guarantees-regulations-2026", "supersedes") in original.tags


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


# ----------------------------------------------------------------------------- SEBI (sebi.gov.in)

SEBI_INSTRUMENTS = [
    {"slug": "sebi-act-1992", "title": "Securities and Exchange Board of India Act, 1992", "kind": "act"},
    {"slug": "scra-1956", "title": "Securities Contracts (Regulation) Act, 1956", "kind": "act"},
    {
        "slug": "sebi-lodr-2015",
        "title": "Securities and Exchange Board of India (Listing Obligations and Disclosure Requirements) Regulations, 2015",
        "kind": "regulations",
    },
    {
        "slug": "sebi-pit-2015",
        "title": "Securities and Exchange Board of India (Prohibition of Insider Trading) Regulations, 2015",
        "kind": "regulations",
    },
]


def test_sebi_regulations_listing():
    html = rd("sebi_regulations.html")
    rows = sebi.parse_listing(html)
    assert len(rows) == 25
    assert sebi.total_records(html) > 1000          # the Regulations archive, not just the current consolidated texts
    assert all(r["url"].startswith("https://www.sebi.gov.in/legal/regulations/") for r in rows)
    assert all(r["date_issued"] for r in rows)

    consolidated = [r for r in rows if sebi.is_consolidated(r["title"], "regulations")]
    assert consolidated, "expected at least one '[Last amended on ...]' text"
    assert not any(re.match(r"Corrigendum", r["title"], re.I) for r in consolidated)
    # an amending regulation is a document but never an instrument
    assert not sebi.is_consolidated(
        "Securities and Exchange Board of India (Listing Obligations and Disclosure Requirements) (Second Amendment) Regulations, 2026",
        "regulations",
    )
    assert not sebi.is_consolidated("Corrigendum to the Securities and Exchange Board of India (X) Regulations, 2021", "regulations")


def test_sebi_instrument_slugs_and_titles():
    slug, short, title, kind = sebi.instrument_for(
        "Securities and Exchange Board of India (Listing Obligations and Disclosure Requirements) Regulations, 2015 "
        "[Last amended on July 14, 2026]",
        "regulations",
    )
    assert (slug, short, kind) == ("sebi-lodr-2015", "SEBI-LODR", "regulations")
    assert title.endswith("Regulations, 2015")
    assert sebi.instrument_for("Securities and Exchange Board of India Act, 1992 (As amended by the Finance Act, 2021)", "act")[0] == "sebi-act-1992"
    assert sebi.instrument_for("Securities Contracts (Regulation) Act, 1956 (As amended ...)", "act")[0] == "scra-1956"
    # a regulation with no hand-written slug still gets a stable one
    assert sebi.instrument_for("Securities and Exchange Board of India (Vault Managers) Regulations, 2021", "regulations")[0] == "sebi-vault-managers-regulations-2021"
    assert sebi.instrument_for("Master Circular for Alternative Investment Funds (AIFs)", "master_circular")[3] == "master_direction"


def test_sebi_updated_as_on_and_dates():
    assert str(sebi.updated_as_on("... Regulations, 2015 [Last amended on July 14, 2026]")) == "2026-07-14"
    assert str(sebi.updated_as_on("... Regulations, 2020 [Last amended on September 03, 2025]")) == "2025-09-03"
    assert sebi.updated_as_on("... Regulations, 2026") is None
    assert sebi.strip_amendment_note("X Regulations, 2015 [Last amended on July 14, 2026]") == "X Regulations, 2015"


def test_sebi_circulars_listing_is_date_filtered():
    rows = sebi.parse_listing(rd("sebi_circulars.html"))
    assert len(rows) == 25
    assert all(r["date_issued"] and r["date_issued"].year == 2014 for r in rows)
    assert all("/legal/circulars/" in r["url"] for r in rows)


def test_sebi_detail_page_number_date_and_pdf():
    url = "https://www.sebi.gov.in/legal/regulations/may-2025/x_93783.html"
    d = sebi.parse_detail(rd("sebi_lodr_amendment_detail.html"), url)
    assert str(d.date_issued) == "2025-05-01"
    assert "Listing Obligations" in d.title and "Second Amendment" in d.title
    assert len(d.pdf_urls) == 1
    assert d.pdf_urls[0].startswith("https://www.sebi.gov.in/sebi_data/attachdocs/") and d.pdf_urls[0].endswith(".pdf")
    assert d.number is None            # SEBI prints "Regulations" here; circulars print "Circular No.: ..."
    assert d.text == ""                # PDF-only page: the pipeline falls back to the attachment's text


def test_sebi_viewer_url_unwrapping():
    page = "https://www.sebi.gov.in/legal/circulars/aug-2026/x_1.html"
    assert sebi.pdf_from_viewer("../../../web/?file=https://www.sebi.gov.in/sebi_data/attachdocs/a/1.pdf", page) == "https://www.sebi.gov.in/sebi_data/attachdocs/a/1.pdf"
    assert sebi.pdf_from_viewer("../../../web/?file=/sebi_data/attachdocs/1451563961297.pdf", page) == "https://www.sebi.gov.in/sebi_data/attachdocs/1451563961297.pdf"
    assert sebi.pdf_from_viewer("/some/page.html", page) is None


def test_sebi_amendment_regulation_is_tagged_from_its_own_wording():
    from amendments import rules

    text = rd("sebi_lodr_amendment.txt")
    doc = {
        "doc_type": "regulations",
        "regulator_code": "SEBI",
        "source_url": "https://www.sebi.gov.in/legal/regulations/may-2025/x_93783.html",
        "title": "Securities and Exchange Board of India (Listing Obligations and Disclosure Requirements) (Second Amendment) Regulations, 2025",
    }
    res = rules.tag(doc, text, [dict(i) for i in SEBI_INSTRUMENTS])
    assert res.is_amending
    assert ("sebi-lodr-2015", "amends") in res.tags
    # "In exercise of the powers conferred by ... section 30 of the SEBI Act, 1992 read with section 31 of the SCRA"
    assert ("sebi-act-1992", "references") in res.tags
    assert ("scra-1956", "references") in res.tags
    effects = {(e.provision_number, e.change_type) for e in res.effects}
    assert ("13", "insert") in effects            # "In regulation 13, sub-regulation (2), ... shall be inserted"
    assert ("Schedule III", "insert") in effects  # "In Schedule III, in Part D, after clause 9, ..."
    assert all(e.instrument_slug == "sebi-lodr-2015" for e in res.effects)
    assert all(e.excerpt for e in res.effects)


def test_sebi_circular_clarifies_the_regulations_it_cites():
    from amendments import rules

    text = (
        "In terms of regulation 30 of the Securities and Exchange Board of India (Listing Obligations and "
        "Disclosure Requirements) Regulations, 2015, listed entities shall disclose material events. "
        "This circular is issued in exercise of the powers conferred under section 11 of the Securities and "
        "Exchange Board of India Act, 1992."
    )
    doc = {"doc_type": "circular", "regulator_code": "SEBI", "title": "Disclosure of material events"}
    res = rules.tag(doc, text, [dict(i) for i in SEBI_INSTRUMENTS])
    assert not res.is_amending
    assert ("sebi-lodr-2015", "clarifies") in res.tags
    assert ("sebi-act-1992", "clarifies") in res.tags
    assert not res.effects


def test_sebi_style_keeps_per_page_footnotes_with_their_provision():
    """SEBI repeats footnotes at the foot of every page, so the 'appendix starts at the first footnote' rule
    (right for an RBI Master Direction) would swallow the rest of the document."""
    text = "\n".join(
        [
            "CHAPTER I",
            "PRELIMINARY",
            "Short title and commencement.",
            "1. (1) These regulations may be called the Securities and Exchange Board of India (Listing Obligations and Disclosure Requirements) Regulations, 2015.",
            "Definitions.",
            "2. (1) In these regulations, unless the context otherwise requires: 1[associate] shall mean any entity.",
            "1 Inserted by SEBI (Listing Obligations and Disclosure Requirements) (Fifth Amendment) Regulations, 2018, w.e.f. 06.09.2018.",
            "Board of directors.",
            "17. (1) The composition of the board of directors of the listed entity shall be as follows.",
            "2 Substituted by SEBI (LODR) (Second Amendment) Regulations, 2021, w.e.f. 01.01.2022.",
            "Obligations of listed entity.",
            "30. (1) Every listed entity shall make disclosures of any events or information which are material.",
        ]
    )
    provs = split_provisions(text, style="sebi")
    numbers = [p.number for p in provs]
    assert "1" in numbers and "2" in numbers and "17" in numbers and "30" in numbers
    assert not any(p.number == "Appendix and Footnotes" for p in provs)
    # the footnote text is kept verbatim, attached to the provision it was printed under
    assert "Fifth Amendment) Regulations, 2018" in {p.number: p.text for p in provs}["2"]
    kept = sum(len(p.text) for p in provs)
    assert kept >= 0.99 * len(text)


def test_sebi_routing_leaves_the_fema_rules_alone():
    from amendments import rules

    res = rules.tag(
        {"doc_type": "notification", "title": "Foreign Exchange Management (Guarantees) Regulations, 2026"},
        "In exercise of the powers conferred by section 6 of the Foreign Exchange Management Act, 1999 and in "
        "supersession of the earlier regulations, the Reserve Bank makes the following regulations",
        [],
    )
    assert ("fem-guarantees-regulations-2026", "supersedes") in res.tags
