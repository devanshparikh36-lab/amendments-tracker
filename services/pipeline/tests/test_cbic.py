import json
from pathlib import Path

from amendments import rules
from amendments.adapters import cbic_gst
from amendments.adapters.cbic_gst import (
    content_url,
    format_number,
    html_to_text,
    parse_api_date,
    parse_listing,
    parse_source_url,
    public_url,
    section_text,
)
from amendments.http import unwrap_base64_envelope
from amendments.instruments import PHASE1_INSTRUMENTS
from amendments.parsers.provisions import split_provisions

FIX = Path(__file__).parent / "fixtures"

GST_INSTRUMENTS = [
    {"slug": i["slug"], "title": i["title"], "kind": i["kind"]} for i in PHASE1_INSTRUMENTS if i["regulator"] == "CBIC"
]


def rd(name: str) -> str:
    return (FIX / name).read_text(encoding="utf-8", errors="ignore")


def test_registry_and_instruments():
    from amendments.adapters import _OFFICIAL_TEXT_SOURCES, registry

    assert registry["cbic_gst_notifications"].regulator_code == "CBIC"
    assert registry["cbic_gst_circulars"].regulator_code == "CBIC"
    assert "cbic_gst" in _OFFICIAL_TEXT_SOURCES
    slugs = {i["slug"] for i in GST_INSTRUMENTS}
    assert {"cgst-act-2017", "igst-act-2017", "utgst-act-2017", "gst-compensation-act-2017", "cgst-rules-2017"} <= slugs
    assert all(i["seed"]["adapter"] == "cbic_gst" for i in PHASE1_INSTRUMENTS if i["regulator"] == "CBIC")


def test_notification_listing_parses():
    rows = json.loads(rd("cbic_notifications_central_tax_2025.json"))
    docs = parse_listing(rows, "notification", "notification")
    assert len(docs) >= 20
    assert len({d.source_url for d in docs}) == len(docs)
    first = docs[0]
    assert first.source_url == "https://taxinformation.cbic.gov.in/content-page/explore-notification/" + str(rows[0]["id"])
    assert first.number == "Notification No. 20/2025-Central Tax"
    assert str(first.date_issued) == "2025-12-08" or first.date_issued.year == 2025
    assert first.extra["series"] == "Central Tax"
    assert first.pdf_urls and first.pdf_urls[0].startswith("https://taxinformation.cbic.gov.in/content/pdf/tax_repository/gst/notifications/")
    assert all(d.doc_type == "notification" and d.date_issued for d in docs)
    assert parse_source_url(first.source_url) == ("notification", rows[0]["id"])


def test_circular_listing_parses():
    rows = json.loads(rd("cbic_circulars_cgst_2024.json"))
    docs = parse_listing(rows, "circular", "circular")
    assert len(docs) >= 20
    assert docs[0].number == "243/37/2024-GST"
    assert docs[0].extra["series"] == "Circulars CGST"
    assert docs[0].source_url == public_url("circular", rows[0]["id"])
    assert all(d.doc_type == "circular" and d.date_issued and d.date_issued.year == 2024 for d in docs)


def test_number_date_and_url_helpers():
    assert str(parse_api_date("2026-05-07T05:30:00+05:30")) == "2026-05-07"
    assert str(parse_api_date("25-Jul-2026")) == "2026-07-25"
    assert parse_api_date(None) is None
    assert format_number("notification", "02/2026-Central Tax", "Central Tax") == "Notification No. 02/2026-Central Tax"
    assert format_number("notification", "Corrigendum", "Central Tax") == "Corrigendum"
    assert format_number("circular", "256/02/2026-GST", None) == "256/02/2026-GST"
    assert content_url("pdf", "tax_repository\\gst\\notifications\\gst-ct-01-2026.pdf") == (
        "https://taxinformation.cbic.gov.in/content/pdf/tax_repository/gst/notifications/gst-ct-01-2026.pdf"
    )
    assert parse_source_url("https://example.org/x") is None


def test_base64_envelope_is_unwrapped():
    import base64

    body = json.dumps({"data": base64.b64encode(b"%PDF-1.4 hello").decode(), "fileName": "gst/notifications/x.pdf"}).encode()
    assert unwrap_base64_envelope(body, "application/json") == (b"%PDF-1.4 hello", "application/pdf")
    assert unwrap_base64_envelope(b"%PDF-1.4", "application/pdf") is None
    assert unwrap_base64_envelope(b'{"foo": 1}', "application/json") is None


def test_act_section_html_to_text_is_verbatim_and_splits():
    text = html_to_text(rd("cbic_act_section_16.html"))
    assert text.startswith("Section 16.")
    assert "Eligibility and conditions for taking input tax credit" in text
    assert "Notwithstanding anything contained in sub-section (4)" in text  # 2024 insertion: section pages are current
    assert "<" not in text and "_ngcontent" not in text
    assert "Inserted by section 118" in text  # footnotes stay with the section
    rule = section_text("Rule 31C", rd("cbic_rule_31c.html"))
    assert rule.startswith("Rule 31C\n1 [31C. Value of supply of actionable claims in case of casino.")
    assert "Provided that any amount returned or refunded by the casino" in rule
    provs = split_provisions(text + "\n\n" + text.replace("Section 16.", "Section 17."), style="act")
    numbers = [p.number for p in provs]
    assert numbers == ["16", "17"], numbers  # per-section footnotes ("1. Inserted by ...") are not provisions
    by = {p.number: p for p in provs}
    assert any(fn.startswith("11. Inserted by section 118") for fn in by["16"].footnotes)
    assert sum(len(p.text) for p in provs) >= 0.99 * (2 * len(text))
    rprovs = split_provisions(rule + "\n\n" + rule.replace("Rule 31C", "Rule 32").replace("[31C.", "[32."), style="regulations")
    assert {"31C", "32"} <= {p.number for p in rprovs}


def test_rules_tag_amending_notification():
    text = rd("cbic_notification_ct_11_2025.txt")
    doc = {
        "doc_type": "notification",
        "title": "Seeks to notify Central Goods and Services Tax (Second Amendment) Rules 2025",
        "number": "Notification No. 11/2025-Central Tax",
        "source_url": "https://taxinformation.cbic.gov.in/content-page/explore-notification/1010000",
    }
    res = rules.tag(doc, text, [dict(i) for i in GST_INSTRUMENTS])
    assert res.is_amending
    assert ("cgst-rules-2017", "amends") in res.tags
    assert ("cgst-act-2017", "references") in res.tags
    assert not res.new_instruments
    effects = {(e.provision_number, e.change_type) for e in res.effects}
    assert ("164", "insert") in effects
    assert all(e.instrument_slug == "cgst-rules-2017" for e in res.effects)
    assert any("in rule 164" in e.excerpt for e in res.effects)


def test_rules_tag_rate_notification_falls_back_to_act():
    text = (
        "G.S.R. (E).- In exercise of the powers conferred by sub-section (1) of section 9 of the Central Goods and Services "
        "Tax Act, 2017 (12 of 2017), the Central Government, on the recommendations of the Council, hereby makes the following "
        "further amendments in the notification of the Government of India, in the Ministry of Finance (Department of Revenue), "
        "No. 1/2017-Central Tax (Rate), dated the 28th June, 2017, namely:- In the said notification, in Schedule I, ..."
    )
    doc = {"doc_type": "notification", "title": "Seeks to amend notification No. 1/2017-Central Tax (Rate)", "number": "Notification No. 5/2025-Central Tax (Rate)", "source_url": "https://taxinformation.cbic.gov.in/content-page/explore-notification/1"}
    res = rules.tag(doc, text, [dict(i) for i in GST_INSTRUMENTS])
    assert res.is_amending
    assert ("cgst-act-2017", "amends") in res.tags
    assert not res.effects

    # when the earlier notification is itself a tracked instrument, it becomes the target
    inst = [dict(i) for i in GST_INSTRUMENTS] + [{"slug": "ctr-1-2017", "title": "Notification No. 1/2017-Central Tax (Rate)", "kind": "other"}]
    res2 = rules.tag(doc, text, inst)
    assert ("ctr-1-2017", "amends") in res2.tags
    assert ("cgst-act-2017", "amends") not in res2.tags


def test_rules_tag_circular_clarifies_act():
    text = (
        "Circular No. 211/5/2024-GST. Clarification on time limit under Section 16(4) of CGST Act, 2017 in respect of RCM "
        "supplies received from unregistered persons. ... in terms of sub-section (4) of section 16 of the CGST Act ..."
    )
    doc = {"doc_type": "circular", "title": "Clarification on time limit under Section 16(4)", "number": "211/5/2024-GST", "source_url": "https://taxinformation.cbic.gov.in/content-page/explore-circulars/1003000"}
    res = rules.tag(doc, text, [dict(i) for i in GST_INSTRUMENTS])
    assert not res.is_amending
    assert ("cgst-act-2017", "clarifies") in res.tags

    # FEMA routing is untouched
    fema = rules.tag({"doc_type": "apdir_circular", "title": "x", "source_url": "https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx?Id=1"}, "text", [])
    assert fema.tags == []


def test_source_url_roundtrip_for_every_kind():
    for kind in cbic_gst.KINDS:
        assert parse_source_url(public_url(kind, 42)) == (kind, 42)
