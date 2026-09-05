import json
from pathlib import Path

from amendments import rules
from amendments.adapters import mca
from amendments.adapters.mca import (
    _number_and_heading,
    act_toc,
    classify,
    document_url,
    html_to_text,
    parse_document_url,
    parse_listing,
    parse_mca_date,
    slice_by_anchor,
    split_number,
)
from amendments.instruments import MCA_INSTRUMENTS

FIX = Path(__file__).parent / "fixtures"

MCA_INSTRUMENT_VIEW = [{"slug": i["slug"], "title": i["title"], "kind": i["kind"]} for i in MCA_INSTRUMENTS]


def rd(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8", errors="ignore")


def instruments() -> list[dict]:
    return [dict(i) for i in MCA_INSTRUMENT_VIEW]


def tag(text: str, **doc) -> rules.RuleResult:
    base = {
        "regulator_code": "MCA",
        "source_adapter": "mca_notifications",
        "source_url": "https://www.mca.gov.in/bin/ebook/dms/getdocument?doc=eA%3D%3D&docCategory=Notifications",
        "doc_type": "gsr",
        "title": "",
    }
    base.update(doc)
    return rules.tag(base, text, instruments())


# ----------------------------------------------------------------------------- registry / instruments

def test_registry_and_instruments():
    from amendments.adapters import _OFFICIAL_TEXT_SOURCES, registry

    assert registry["mca_notifications"].regulator_code == "MCA"
    assert registry["mca_circulars"].regulator_code == "MCA"
    assert registry["mca_notifications"].needs_browser and registry["mca_notifications"].browser_home
    assert "mca" in _OFFICIAL_TEXT_SOURCES

    slugs = {i["slug"] for i in MCA_INSTRUMENTS}
    assert "companies-act-2013" in slugs
    assert {
        "companies-incorporation-rules-2014",
        "companies-appointment-and-qualification-of-directors-rules-2014",
        "companies-meetings-of-board-and-its-powers-rules-2014",
        "companies-accounts-rules-2014",
        "companies-audit-and-auditors-rules-2014",
        "companies-share-capital-and-debentures-rules-2014",
        "companies-management-and-administration-rules-2014",
        "companies-corporate-social-responsibility-policy-rules-2014",
        "companies-prospectus-and-allotment-of-securities-rules-2014",
        "companies-registered-valuers-and-valuation-rules-2017",
    } <= slugs
    assert all(i["seed"]["adapter"] == "mca" and i["regulator"] == "MCA" for i in MCA_INSTRUMENTS)
    assert len({i["official_url"] for i in MCA_INSTRUMENTS}) == len(MCA_INSTRUMENTS)


# ----------------------------------------------------------------------------- dates, numbers, urls

def test_parse_mca_date_and_numbers():
    assert str(parse_mca_date("01/24/2024")) == "2024-01-24"
    assert str(parse_mca_date("07/02/2021 09:21:58")) == "2021-07-02"
    assert parse_mca_date("") is None
    assert parse_mca_date("not a date") is None

    number, subject = split_number(
        "G.S.R. 61(E)-The Companies Listing of equity shares in permissible jurisdictions) Rules 2024",
        "G.S.R. 61(E)",
    )
    assert number == "G.S.R. 61(E)"
    assert subject.startswith("The Companies Listing of equity shares")

    number, subject = split_number("General Circular No. 13/2013-Whether HUF can become partner", "General Circular No. 13/2013")
    assert number == "General Circular No. 13/2013" and subject == "Whether HUF can become partner"

    assert classify("G.S.R. 61(E)", "notification") == "gsr"
    assert classify("S.O. 1303(E)", "notification") == "notification"
    assert classify("General Circular No. 3/2023", "circular") == "circular"


def test_document_url_round_trip():
    url = document_url("415727662", "Notifications")
    assert url.startswith("https://www.mca.gov.in/bin/ebook/dms/getdocument?doc=")
    assert parse_document_url(url) == ("415727662", "Notifications")


# ----------------------------------------------------------------------------- listings

def test_notification_listing_parses():
    rows = json.loads(rd("mca_notifications_listing.json"))
    docs = parse_listing(rows, "Notifications", "notification", since_year=2014)
    assert len(docs) >= 20
    assert len({d.source_url for d in docs}) == len(docs)
    assert all(d.date_issued and d.date_issued.year >= 2014 for d in docs)
    assert all(d.number and d.title for d in docs)
    assert all(d.pdf_urls == [d.source_url] for d in docs)
    assert any(d.doc_type == "gsr" for d in docs), "amendment rules are published as G.S.R. numbers"
    # the number is never left inside the title
    assert not any(d.title.startswith(d.number) for d in docs)
    # the year filter really filters
    assert parse_listing(rows, "Notifications", "notification", since_year=2100) == []


def test_circular_listing_parses():
    rows = json.loads(rd("mca_circulars_listing.json"))
    docs = parse_listing(rows, "Circulars", "circular", since_year=2014)
    assert len(docs) >= 10
    assert all(d.doc_type == "circular" for d in docs)
    assert all(d.number.lower().startswith("general circular") for d in docs)
    assert all(parse_document_url(d.source_url)[1] == "Circulars" for d in docs)


# ----------------------------------------------------------------------------- official text (Act)

def test_act_table_of_contents_parses():
    toc = act_toc(rd("mca_act_toc.html"))
    assert len(toc) >= 20
    first = toc[0]
    assert first["ident"] == "D1C1S1" and first["link"] == "24530"
    assert first["label"] == "1. Short Title, Extent, Commencement and Application"
    assert first["chapter"] == "Chapter I Preliminary"
    assert any(t["chapter"] and "Incorporation" in t["chapter"] for t in toc)
    assert len({t["ident"] for t in toc}) == len(toc)


def test_act_section_text_is_verbatim():
    html = rd("mca_act_section_1.html")
    sliced = slice_by_anchor(html, "D1C1S1")
    text = html_to_text(sliced)
    # the Act preamble that precedes section 1 in the same document is dropped by the anchor slice
    assert "BE it enacted by Parliament" not in text
    assert text.startswith("1. Short Title, Extent, Commencement and Application")
    assert "This Act may be called the Companies Act, 2013." in text
    assert "It extends to the whole of India." in text
    assert "<" not in text and "&#x" not in text
    number, heading, level = _number_and_heading("1. Short Title, Extent, Commencement and Application")
    assert (number, level) == ("1", "section") and heading == "Short Title, Extent, Commencement and Application"


def test_number_and_heading_handles_footnotes_forms_and_schedules():
    assert _number_and_heading("2[6. Conversion of One Person Company") == ("6", "Conversion of One Person Company", "section")
    assert _number_and_heading("33A. Allotment of a new name")[0] == "33A"
    assert _number_and_heading("1.1[Form No: INC-1]")[0] == "Form INC-1"
    number, _, level = _number_and_heading("Schedule VII Activities Which May be Included")
    assert number.startswith("Schedule VII") and level == "annex"


# ----------------------------------------------------------------------------- rule-based tagging

def test_amendment_rules_notification_is_tagged():
    """G.S.R. 91(E), the Companies (Incorporation) Second Amendment Rules, 2021 (gazette PDF text)."""
    text = rd("mca_incorporation_2nd_amendment_rules_2021.txt")
    res = tag(text, title="Companies (Incorporation) 2nd Amendment Rules 2021", doc_type="gsr")
    assert res.is_amending
    assert ("companies-incorporation-rules-2014", "amends") in res.tags
    assert ("companies-act-2013", "references") in res.tags
    changed = {(e.provision_number, e.change_type) for e in res.effects}
    assert {"3", "6", "7"} <= {n for n, _ in changed}, changed
    assert ("6", "substitute") in changed          # "for rule 6, the following rule shall be substituted"
    assert ("7", "omit") in changed                # "in rule 7, ... shall be omitted"
    assert ("Form INC-5", "omit") in changed       # "the e-Form No.INC-5 shall be omitted"
    assert ("Form INC-6", "substitute") in changed
    assert all(e.instrument_slug == "companies-incorporation-rules-2014" for e in res.effects)
    assert all(e.excerpt for e in res.effects)


def test_commencement_notification_brings_sections_into_force():
    """S.O. 1303(E): "appoints the 24th March, 2021 as the date on which the provisions of section 23 ..."."""
    text = rd("mca_commencement_notification_2021.txt")
    res = tag(text, title="Commencement notification dated 24.03.2021", doc_type="notification")
    assert res.is_amending
    assert ("companies-act-2013", "amends") in res.tags
    effects = {(e.provision_number, e.change_type, e.instrument_slug) for e in res.effects}
    assert ("23", "insert", "companies-act-2013") in effects
    assert ("45", "insert", "companies-act-2013") in effects


def test_general_circular_is_linked_to_the_act():
    text = rd("mca_general_circular.txt")
    res = tag(text, title="Clarification on spending of CSR funds", doc_type="circular",
              source_adapter="mca_circulars")
    assert not res.is_amending
    slugs = dict(res.tags)
    assert "companies-act-2013" in slugs
    assert slugs["companies-act-2013"] in ("clarifies", "references")


def test_circular_citing_sections_clarifies_the_act():
    text = (
        "General Circular No. 11/2020\n"
        "Subject: Special Measures under the Companies Act, 2013.\n"
        "In view of the above, it is clarified that the gap between two consecutive meetings of the Board "
        "required under section 173 of the Companies Act, 2013 stands extended.\n"
    )
    res = tag(text, title="Special Measures under Companies Act, 2013", doc_type="circular",
              source_adapter="mca_circulars")
    assert ("companies-act-2013", "clarifies") in res.tags


def test_non_mca_documents_are_untouched():
    """The MCA branch must not swallow RBI / CBDT documents."""
    doc = {"regulator_code": "RBI", "source_adapter": "rbi_fema_notifications", "doc_type": "notification",
           "title": "Foreign Exchange Management (Deposit) Regulations, 2016", "source_url": "https://www.rbi.org.in/x"}
    assert not mca_touched(doc)


def mca_touched(doc: dict) -> bool:
    return rules.is_mca_document(doc)
