# -*- coding: utf-8 -*-
"""Where the notification number in a digest points.

781 of 8,045 documents have no stored file -- 475 RBI A.P. (DIR Series) circulars and 274 CBDT
notifications, which those regulators publish as web pages rather than PDFs. The digest used to print the
number as plain text for those, so about one entry in ten offered no route to the official source at all.

`_source_link` answers with the stored PDF when there is one and the regulator's own page otherwise, and
says which it is -- the label is not decoration, because on a phone one of them downloads and the other
does not.
"""
from datetime import date

from amendments.notify import email as E


def test_a_stored_pdf_wins(monkeypatch):
    """When the file was stored, the number opens our copy of it, not the regulator's page.

    Deliberately so: the stored copy survives the regulator reorganising its site, which they do -- it is
    the reason a SEBI circular arrived twice under two URLs and the digest reported it as new.

    _pdf_url is patched because resolving a storage key needs R2 credentials, and every other test in this
    suite is pure. What is being checked is the precedence, not the URL construction.
    """
    monkeypatch.setattr(E, "_pdf_url", lambda doc: "https://files.example/stored.pdf" if doc.get("pdf_key") else None)
    href, kind = E._source_link({"pdf_key": "k/1.pdf", "official_url": "https://rbi.org.in/x"})
    assert (href, kind) == ("https://files.example/stored.pdf", "PDF")


def test_the_page_is_used_only_when_nothing_was_stored():
    """No stored file, so the regulator's page is offered instead -- labelled as a page, not a PDF."""
    href, kind = E._source_link({"pdf_key": None, "official_url": "https://rbi.org.in/x"})
    assert (href, kind) == ("https://rbi.org.in/x", "page")


def test_a_page_is_offered_when_nothing_was_stored():
    """The case that was broken: an RBI circular published as a web page."""
    href, kind = E._source_link({
        "official_url": "https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx?Id=13745",
    })
    assert kind == "page"
    assert href.endswith("Id=13745")


def test_nothing_to_link_is_handled():
    """No file and no URL: the number must still render, as plain text rather than a broken link."""
    assert E._source_link({}) == (None, "page")
    assert E._source_link({"official_url": "   "}) == (None, "page")


def test_the_html_digest_links_a_pdfless_document():
    """End to end: a document with only a page still reaches its source from the mail."""
    docs = [{
        "id": 9136,
        "title": "Delegation of Compounding of certain Contraventions",
        "number": "A.P. (DIR Series) Circular No. 9",
        "date_issued": date(2026, 10, 24),
        "regulator_code": "RBI",
        "pdf_key": None,
        "official_url": "https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx?Id=13745",
        "affects": None,
    }]
    html = E.build_digest_html(docs, [], [], [], "https://as-amended.netlify.app", date(2026, 10, 25))
    assert "BS_CircularIndexDisplay.aspx?Id=13745" in html
    assert ">page<" in html
    assert ">PDF<" not in html


def test_the_text_digest_names_what_it_links():
    docs = [{
        "id": 9136,
        "title": "Delegation of Compounding of certain Contraventions",
        "number": "A.P. (DIR Series) Circular No. 9",
        "date_issued": date(2026, 10, 24),
        "regulator_code": "RBI",
        "pdf_key": None,
        "official_url": "https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx?Id=13745",
        "affects": None,
    }]
    text = E.build_digest_text(docs, "https://as-amended.netlify.app", date(2026, 10, 25))
    assert "Official page: https://www.rbi.org.in" in text
    assert "Official PDF:" not in text
