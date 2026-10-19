"""CBDT tagging: which Income-tax Act a document is about, and which sections it discusses.

Every string below is lifted from a document in the live corpus, OCR damage and all, because the OCR is
the hard part. CBDT publishes circulars as scans and the text that comes back spells the Act's name six
different ways, breaks it across a line, and runs section numbers together.

Before this was fixed, `tag_cbdt` ended with a block that found the sections a circular discussed, put
them in a set and then returned without recording any of them. 84 circulars had come through tagging
with nothing attached at all.
"""
from datetime import date

from amendments import rules
from amendments.instruments import PHASE1_INSTRUMENTS

CBDT_INSTRUMENTS = [
    {"slug": i["slug"], "title": i["title"], "kind": i["kind"]} for i in PHASE1_INSTRUMENTS if i["regulator"] == "CBDT"
]


def instruments() -> list[dict]:
    return [dict(i) for i in CBDT_INSTRUMENTS]


def tag(text: str, **doc) -> rules.RuleResult:
    base = {
        "regulator_code": "CBDT",
        "source_adapter": "cbdt_circulars",
        "source_url": "https://incometaxindia.gov.in/communications/circular/circular-1-2026.pdf",
        "doc_type": "circular",
        "title": "",
        "date_issued": date(2024, 10, 26),
    }
    base.update(doc)
    return rules.tag(base, text, instruments())


def refs(res: rules.RuleResult, slug: str = "ita-1961") -> list[str]:
    return [p.provision_number for p in res.provision_refs if p.instrument_slug == slug]


# ----------------------------------------------------------------- the Act's name, as the OCR gives it

def test_spaced_act_name_is_recognised():
    """"Income Tax Act, 1961" -- no hyphen.

    The old pattern was `Income-?tax Act`, which made the hyphen optional but not the space, so this
    spelling missed. Of the 84 untagged circulars, nine said it this way and nothing else was wrong
    with them; Circular 8/2023 closes with "This issues under section 268A of the Income Tax Act".
    """
    res = tag(
        "This issues under section 268A of the Income Tax Act, 1961.",
        title="Circular No. 8/2023 : Revision of exceptions to monetary limits for filing appeals",
        date_issued=date(2023, 5, 31),
    )
    assert ("ita-1961", "clarifies") in res.tags
    assert refs(res) == ["268A"]


def test_act_name_survives_ocr_damage_and_line_breaks():
    """Each spelling here is one the live corpus actually contains."""
    for spelling in (
        "Income-tax Act, 1961",
        "Income Tax Act, 1961",
        "Income tax Act, 1961",
        "Income-tax. Act,1961",      # Circular 13/2024: a full stop where the comma belongs
        "lncome-tax Act, 1961",      # lowercase L read for the capital I
        "Income- tax Act, 1961",     # Circular 13/2019: hyphen, then a space
        "Income-\ntax Act, 1961",    # the name broken across a line
    ):
        res = tag(f"in exercise of its powers under section 119 of the {spelling}, the Board extends")
        assert ("ita-1961", "clarifies") in res.tags, spelling
        assert refs(res) == ["119"], spelling


def test_amending_rules_notification_survives_the_line_break():
    """"further to amend the Income-\ntax Rules, 1962" -- the break falls inside the Act's name.

    Not a new feature, a side effect of widening the name: thirteen amendment notifications in the
    corpus, all plainly titled "Income-tax (Nth Amendment) Rules", were missed on this alone.
    """
    res = tag(
        "the Central Board of Direct Taxes hereby makes the following rules further to amend the Income-\n"
        "tax Rules, 1962, namely:-\n\n"
        "2. In the principal rules, in rule 114, for sub-rule (3), the following shall be substituted.",
        doc_type="notification",
        source_adapter="cbdt_notifications",
        title="Notification No. 9/2017 : Income-tax (2nd Amendment) Rules, 2017",
    )
    assert ("itr-1962", "amends") in res.tags
    assert res.is_amending
    assert "114" in [e.provision_number for e in res.effects]


# ------------------------------------------------------------------- which Act, when it does not say

def test_undated_act_before_commencement_resolves_to_1961():
    """No year given, but the circular predates 1 April 2026, so the 2025 Act was not yet in force."""
    res = tag(
        "Section 80G of the Income-tax Act ('the Act') provides for deduction in respect of donations. "
        "The Board, under section 119(2)(b) of the Act, condones the delay.",
        date_issued=date(2023, 6, 30),
    )
    assert ("ita-1961", "clarifies") in res.tags
    assert sorted(refs(res)) == ["119", "80G"]


def test_undated_act_after_commencement_is_left_alone():
    """Both Acts are live from 1 April 2026 and they renumber everything relative to each other.

    A bare "section 10" is then genuinely ambiguous, and the two Acts' section 10s are different law.
    Tagging nothing is the honest answer; guessing would put the wrong provision on the page and mail
    it to everyone following it.
    """
    res = tag(
        "Section 80G of the Income-tax Act ('the Act') provides for deduction in respect of donations. "
        "The Board, under section 119(2)(b) of the Act, condones the delay.",
        date_issued=date(2026, 9, 1),
    )
    assert res.tags == []
    assert res.provision_refs == []


def test_explicit_year_beats_the_ambiguity_default():
    """Said outright, the year settles it even after both Acts are live, where the date rule gives up."""
    res = tag(
        "Section 183 of the Income-tax Act, 2025 provides for the deduction, and the Board clarifies "
        "under section 533 of the Act that the condition is met.",
        date_issued=date(2026, 9, 1),
    )
    assert ("ita-2025", "clarifies") in res.tags
    assert not any(s == "ita-1961" for s, _ in res.tags)
    assert sorted(refs(res, "ita-2025")) == ["183", "533"]


def test_notifications_get_the_instrument_but_not_its_sections():
    """Notification 55/2026, made under the 2025 Act.

    Sections are recorded for circulars only. A circular's sections are its subject, which is what the
    "Affects" line and the follow notifications want; a notification's opening "in exercise of the
    powers conferred by section 533" names the enabling provision, which is a different claim and not
    one this has been measured against.
    """
    res = tag(
        "In exercise of the powers conferred by section 533 read with section 183 of the Income-tax Act, "
        "2025 (30 of 2025), the Central Board of Direct Taxes makes the following.",
        doc_type="notification",
        source_adapter="cbdt_notifications",
        date_issued=date(2026, 3, 31),
    )
    assert ("ita-2025", "references") in res.tags
    assert res.provision_refs == []


def test_naming_both_acts_tags_both_but_claims_no_sections():
    """Circular 5/2026 defines "the Act" as the 2025 Act and also discusses 1961 sections.

    Both instrument tags are right -- it really does concern both. But the short form "the Act" is now
    bound to the 2025 Act while "section 92CB" belongs to the 1961 one, and nothing in the text says
    which Act an unqualified reference means. So no section is recorded.
    """
    res = tag(
        "as referred to in section 9(9)(c)(ii)(C) of the Income- tax Act, 2025 (the Act). "
        "Section 92CB of the Income-tax Act, 1961 (as it existed prior to its repeal) introduced "
        "safe harbour rules, and section 144C of the Act applies to the proceedings.",
        date_issued=date(2026, 5, 12),
    )
    assert ("ita-2025", "clarifies") in res.tags
    assert ("ita-1961", "clarifies") in res.tags
    assert res.provision_refs == []


def test_circular_that_names_only_sections_is_not_guessed_at():
    """Sections and no Act anywhere -- 38 of the 84 untagged circulars look like this.

    Being a CBDT document is not evidence that a section belongs to the Income-tax Act. The same feed
    carries Circular 11/2015, "Order under section 10(2)(b) of the Wealth Tax Act", and defaulting it
    to ita-1961 would attach the Wealth-tax Act's section 10 to the Income-tax Act's section 10.
    """
    res = tag(
        "The Board hereby extends the due date for furnishing the return under sub-section (1) of "
        "section 139 from 31st October to 30th November, in exercise of its powers under section 119.",
        title="Circular No. 12/2025 : Extension of due date for filing of ITRs",
        date_issued=date(2025, 9, 15),
    )
    assert res.tags == []
    assert res.provision_refs == []


def test_a_competing_act_unbinds_the_short_form():
    """Once the Wealth-tax Act is in play, "of the Act" no longer safely means the Income-tax Act."""
    res = tag(
        "Monetary limits for filing Wealth Tax appeals under section 27 of the Wealth Tax Act, 1957. "
        "Reference is also made to section 268A of the Act.",
        date_issued=date(2019, 2, 5),
    )
    assert res.provision_refs == []


# ------------------------------------------------------------- the section numbers, and what they mean

def test_scheme_sections_are_not_the_acts_sections():
    """Circular 12/2024, the Vivad se Vishwas guidance note. The whole precision problem in one page.

    It cites sections 89, 96 and 97 of the *Scheme* and section 144C of the Income-tax Act in the same
    breath. Section 90 appears too, meaning the Scheme's section 90, while the Act's section 90 is the
    DTAA provision -- a reader following section 90 would be mailed a circular about something else.
    The number alone cannot tell these apart; only the words after it can.
    """
    res = tag(
        "Please refer to section 89 of the Direct Tax Vivad Se Vishwas Scheme, 2024 ('the Scheme'). "
        "Under Section 97 of the DTVSV Scheme, 2024 the Board may issue directions. "
        "A person who has filed objections before the Dispute Resolution Panel under section 144C of "
        "the Income-tax Act, 1961 ('the Act') is covered. For further details refer section 96 of the Scheme.",
        title="Circular No. 12/2024 : Guidance Note 1/2024 on the Direct Tax Vivad se Vishwas Scheme, 2024",
        date_issued=date(2024, 10, 15),
    )
    assert refs(res) == ["144C"]


def test_the_word_after_the_number_is_not_a_suffix():
    """"section 119 of the Act" is section 119, not section "119 OF".

    Worth a test because the wrong answer is invisible: O and R are real suffixes (80-O, 80R), so
    "119 OF" and a chapter reference look alike until the number fails to resolve against the Act.
    """
    res = tag(
        "in exercise of its powers under SECTION 119 OF THE INCOME-TAX ACT, 1961, the Board extends "
        "the due date under section 139 of the Act.",
        date_issued=date(2024, 10, 26),
    )
    assert sorted(refs(res)) == ["119", "139"]


def test_chained_citations_inherit_the_qualifier():
    """"section 90 or section 90A of the Act" -- only the last one carries the Act's name."""
    res = tag(
        "information received under an agreement referred to in section 90 or section 90A of the "
        "Income-tax Act, 1961, if it relates to any tax arrear.",
        date_issued=date(2021, 3, 23),
    )
    assert sorted(refs(res)) == ["90", "90A"]


def test_hyphenated_chapter_via_a_deduction_reference():
    """Circulars write "section 80IA"; the Act numbers the provision "80-IA".

    rules.py emits what the document says and the pipeline resolves it hyphen-insensitively, so the
    number recorded here is the circular's spelling.
    """
    res = tag(
        "some firms try to inflate the profits eligible for deduction under section 80IA of the "
        "Income-tax Act, 1961 by not claiming expenditure towards remuneration.",
        date_issued=date(2019, 6, 19),
    )
    assert refs(res) == ["80IA"]


def test_sections_are_references_and_never_effects():
    """A circular changes no statutory text, so it records no amendment.

    This is the project's standing rule -- amendments are shown as references and never applied -- and
    it is also why these are ProvisionRefs and not Effects: an Effect is written to amendment_effect,
    tagged 'amends', and will create the provision row if it is missing. A circular naming a section
    is no evidence that the section exists, and the extractor reads OCR that runs numbers together.
    """
    res = tag(
        "Finance Act, 2023 has amended sub-section (1G) of section 206C of the lncome-tax Act, 1961 "
        "(hereinafter referred to as 'the Act') to, inter alia, provide for collection at source.",
        date_issued=date(2023, 6, 30),
    )
    assert refs(res) == ["206C"]
    assert res.effects == []
    assert not res.is_amending
    assert all(p.relation == "clarifies" for p in res.provision_refs)


def test_one_bad_page_cannot_attach_the_whole_Act():
    res = tag(
        "The Income-tax Act, 1961 applies. "
        + " ".join(f"Reference is made to section {n} of the Act." for n in range(100, 140)),
        date_issued=date(2020, 1, 1),
    )
    assert len(res.provision_refs) <= 12
