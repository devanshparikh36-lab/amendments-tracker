# -*- coding: utf-8 -*-
"""Which documents are the same document, when a regulator moves one to a new URL.

Every title below is lifted verbatim from the live corpus. They are the ten documents the 23 October 2026
digest mailed to every confirmed reader, of which nine were already known -- two of them genuinely the
same document at a second address, and seven of them the consolidated texts that the day's amendments
produced, which look like repeats to a reader but are not.

`_same_document_at_another_url` normalises the title in SQL, so these tests mirror that normalisation in
Python rather than executing it. They pin the decision -- what counts as the same title -- which is the
part worth protecting. The SQL itself was checked against the live database when it was written: it
collapsed 18 rows out of 8,061, in 16 groups, every one of them the same document at two or three URLs.

Keep `norm` here identical to _TITLE_KEY in pipeline.py. If one changes the other must.
"""
import re

from amendments.pipeline import _TITLE_KEY


def norm(title: str) -> str:
    """The Python twin of _TITLE_KEY: lowercase, then everything but letters and digits removed."""
    return re.sub(r"[^a-z0-9]+", "", title.lower())


def same(a: str, b: str) -> bool:
    return norm(a) == norm(b)


# --------------------------------------------------------------- the same document, two addresses

def test_one_comma_apart_is_the_same_regulation():
    """SEBI published this twice on the same day, with and without a comma after "Regulations".

    Documents 9128 and 9130. Same consolidated text, same amendment date of 15 October, two URLs. Before
    this, both were inserted and both were mailed.
    """
    assert same(
        "Securities and Exchange Board of India (Alternative Investment Funds) Regulations, 2012 [Last amended on October 15, 2026]",
        "Securities and Exchange Board of India (Alternative Investment Funds) Regulations 2012 [Last amended on October 15, 2026]",
    )


def test_a_rehosted_circular_is_the_same_circular():
    """Documents 9054 and 9135: one circular, collected 6 September and again on 23 October.

    Nothing about it changed -- same title, same issue date of 17 August 2026. SEBI moved it from
    .../revision-of-application-form-for-mutual-fund-registration_103721.html to the same path ending
    _105352.html, and the URL is the dedupe key, so the collector had never seen it before.
    """
    assert same(
        "Revision of Application Form for Mutual Fund Registration",
        "Revision of Application Form for Mutual Fund Registration",
    )


def test_a_curly_apostrophe_does_not_make_a_second_document():
    """SEBI writes "Employees’ Service" with a curly apostrophe and the collectors do not always keep it.

    No translate() is needed for this: the character class removes the apostrophe along with the brackets
    and the commas, whichever way it was spelled.
    """
    assert same(
        "Securities and Exchange Board of India (Employees’ Service) Regulations, 2001",
        "Securities and Exchange Board of India (Employees' Service) Regulations, 2001",
    )


# --------------------------------------------------- different documents that must stay apart

def test_an_amendment_is_not_the_text_it_amends():
    """The single most important case, and the reason the key is the title rather than the instrument.

    Documents 9120 and 9128, both issued 15 October 2026. One is the amending instrument, the other is the
    consolidated regulation republished with that amendment folded in. A reader wants both: the first says
    what changed, the second is the text now in force. Collapsing them would lose the amendment entirely.
    """
    assert not same(
        "Securities and Exchange Board of India (Alternative Investment Funds) (Third Amendment) Regulations, 2026",
        "Securities and Exchange Board of India (Alternative Investment Funds) Regulations, 2012 [Last amended on October 15, 2026]",
    )


def test_two_consolidations_of_one_regulation_are_different_documents():
    """The same regulation, amended twice, is two documents -- the date in the title is what separates them.

    This is what stops the fix going too far. If the "[Last amended on ...]" suffix were stripped before
    comparing, every future consolidation of a regulation would be silently dropped as a duplicate of the
    first one ever collected, and the site would stop recording that the text had moved at all.
    """
    assert not same(
        "Securities and Exchange Board of India (Mutual Funds) Regulations, 2026 [Last amended on October 10, 2026]",
        "Securities and Exchange Board of India (Mutual Funds) Regulations, 2026 [Last amended on August 4, 2026]",
    )


def test_different_years_are_different_regulations():
    """Documents 4156 and 9133: the 2025 amendment regulations against the 2001 regulations as amended."""
    assert not same(
        "Securities and Exchange Board of India (Employees’ Service) (Amendment) Regulations, 2025",
        "Securities and Exchange Board of India (Employees’ Service) Regulations, 2001 [Last amended on October 10, 2026]",
    )


# ------------------------------------------------------------------------------- the SQL itself

def test_title_key_normalises_both_sides_from_one_definition():
    """Both sides of the comparison come from _TITLE_KEY, so the column and the parameter cannot drift.

    The bug this guards against is subtle and silent: normalise the stored title one way and the incoming
    title another, and nothing ever matches, so the fallback quietly does nothing and duplicates return.
    """
    column = _TITLE_KEY.format("title")
    param = _TITLE_KEY.format("%s")
    assert column != param
    assert column.replace("title", "%s", 1) == param
    assert "translate" not in _TITLE_KEY
    assert "[^a-z0-9]+" in _TITLE_KEY
