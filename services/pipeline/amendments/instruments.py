"""Instruments tracked in Phase 1 (FEMA + RBI). Adding a regulator later means adding entries here plus an adapter.

official_url is the page the seeder/self-check re-scrapes for the regulator's own consolidated text.
`rbi_md_id` identifies the Master Direction on rbi.org.in; the seeder uses the HTML detail page (cleaner than the PDF).
"""
from __future__ import annotations

CBDT_INSTRUMENTS: list[dict] = [
    {
        "slug": "ita-1961",
        "short_code": "ITA-1961",
        "title": "Income-tax Act, 1961",
        "kind": "act",
        "regulator": "CBDT",
        "official_url": "https://www.incometaxindia.gov.in/income-tax-act",
        "seed": {"adapter": "cbdt_act", "match": "Income-tax Act, 1961", "page": "/income-tax-act", "style": "act"},
    },
    {
        "slug": "ita-2025",
        "short_code": "ITA-2025",
        "title": "Income-tax Act, 2025",
        "kind": "act",
        "regulator": "CBDT",
        "official_url": "https://www.incometaxindia.gov.in/income-tax-act-202511",
        "seed": {"adapter": "cbdt_act", "match": "Income-tax Act, 2025", "page": "/income-tax-act-202511", "style": "act"},
    },
    {
        "slug": "itr-1962",
        "short_code": "ITR-1962",
        "title": "Income-tax Rules, 1962",
        "kind": "rules",
        "regulator": "CBDT",
        "official_url": "https://www.incometaxindia.gov.in/income-tax-rules",
        "seed": {"adapter": "cbdt_act", "kind": "rules", "match": "Income-tax Rules, 1962", "page": "/income-tax-rules", "style": "regulations"},
    },
    {
        "slug": "itr-2026",
        "short_code": "ITR-2026",
        "title": "Income-tax Rules, 2026",
        "kind": "rules",
        "regulator": "CBDT",
        "official_url": "https://www.incometaxindia.gov.in/income-tax-rule-2026",
        "seed": {"adapter": "cbdt_act", "kind": "rules", "match": "Income-tax Rules, 2026", "page": "/income-tax-rule-2026", "style": "regulations"},
    },
]

# Companies Act, 2013 and the Rules made under it (MCA). The text comes from MCA's own e-Book
# (adapters/mca.py): `match` is the name as MCA publishes it, `group` the Act the Rules sit under.
_MCA_RULES: list[tuple[str, str, str]] = [
    # (slug, short code, MCA's name for the Rules set)
    ("companies-incorporation-rules-2014", "CO-INC-2014", "The Companies (Incorporation) Rules, 2014"),
    ("companies-appointment-and-qualification-of-directors-rules-2014", "CO-DIR-2014",
     "The Companies (Appointment and Qualifications of Directors) Rules, 2014"),
    ("companies-meetings-of-board-and-its-powers-rules-2014", "CO-MBP-2014",
     "The Companies (Meetings of Board and its Powers) Rules, 2014"),
    ("companies-accounts-rules-2014", "CO-ACC-2014", "The Companies (Accounts) Rules, 2014"),
    ("companies-audit-and-auditors-rules-2014", "CO-AUD-2014", "The Companies (Audit and Auditors) Rules, 2014"),
    ("companies-share-capital-and-debentures-rules-2014", "CO-SCD-2014",
     "The Companies (Share Capital and Debentures) Rules, 2014"),
    ("companies-management-and-administration-rules-2014", "CO-MGT-2014",
     "The Companies (Management and Administration) Rules, 2014"),
    ("companies-corporate-social-responsibility-policy-rules-2014", "CO-CSR-2014",
     "The Companies (Corporate Social Responsibility Policy) Rules, 2014"),
    ("companies-prospectus-and-allotment-of-securities-rules-2014", "CO-PAS-2014",
     "The Companies (Prospectus and Allotment of Securities) Rules, 2014"),
    ("companies-registered-valuers-and-valuation-rules-2017", "CO-RV-2017",
     "The Companies (Registered Valuers and Valuation) Rules, 2017"),
]

MCA_INSTRUMENTS: list[dict] = [
    {
        "slug": "companies-act-2013",
        "short_code": "CA-2013",
        "title": "The Companies Act, 2013",
        "kind": "act",
        "regulator": "MCA",
        "official_url": "https://www.mca.gov.in/content/mca/global/en/acts-rules/ebooks/acts.html?act=NTk2MQ%3D%3D",
        "seed": {"adapter": "mca", "kind": "act", "match": "The Companies Act, 2013", "style": "act"},
    },
] + [
    {
        "slug": slug,
        "short_code": code,
        "title": title.removeprefix("The "),
        "kind": "rules",
        "regulator": "MCA",
        "official_url": f"https://www.mca.gov.in/content/mca/global/en/acts-rules/ebooks/rules.html#{slug}",
        "seed": {
            "adapter": "mca",
            "kind": "rules",
            "group": "The Companies Act, 2013",
            "match": title,
            "style": "regulations",
        },
    }
    for slug, code, title in _MCA_RULES
]

PHASE1_INSTRUMENTS: list[dict] = CBDT_INSTRUMENTS + MCA_INSTRUMENTS + [
    {
        "slug": "fema-1999",
        "short_code": "FEMA",
        "title": "Foreign Exchange Management Act, 1999",
        "kind": "act",
        "regulator": "DEA",
        # RBI's Act page links to the Government's India Code copy; the seeder follows that link.
        "official_url": "https://www.rbi.org.in/scripts/Act.aspx",
        "seed": {"adapter": "rbi_fema_act", "style": "act", "text_url": None},
    },
    {
        "slug": "md-ecb",
        "short_code": "MD-ECB",
        "title": "Master Direction - External Commercial Borrowings, Trade Credits and Structured Obligations",
        "kind": "master_direction",
        "regulator": "RBI",
        "official_url": "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=11510",
        "seed": {"adapter": "rbi_master_directions", "rbi_md_id": 11510, "style": "master_direction"},
    },
    {
        "slug": "md-overseas-investment",
        "short_code": "MD-OI",
        "title": "Master Direction - Overseas Investment",
        "kind": "master_direction",
        "regulator": "RBI",
        "official_url": "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=12710",
        "seed": {"adapter": "rbi_master_directions", "rbi_md_id": 12710, "style": "master_direction"},
    },
    {
        "slug": "md-lrs",
        "short_code": "MD-LRS",
        "title": "Master Direction - Liberalised Remittance Scheme (LRS)",
        "kind": "master_direction",
        "regulator": "RBI",
        "official_url": "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10192",
        "seed": {"adapter": "rbi_master_directions", "rbi_md_id": 10192, "style": "master_direction"},
    },
    {
        "slug": "md-import-goods-services",
        "short_code": "MD-IMPORT",
        "title": "Master Direction - Import of Goods and Services",
        "kind": "master_direction",
        "regulator": "RBI",
        "official_url": "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10201",
        "seed": {"adapter": "rbi_master_directions", "rbi_md_id": 10201, "style": "master_direction"},
    },
    {
        "slug": "md-export-goods-services",
        "short_code": "MD-EXPORT",
        "title": "Master Direction - Export of Goods and Services",
        "kind": "master_direction",
        "regulator": "RBI",
        "official_url": "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10395",
        "seed": {"adapter": "rbi_master_directions", "rbi_md_id": 10395, "style": "master_direction"},
    },
    {
        "slug": "md-inr-borrowing-lending-nri",
        "short_code": "MD-INR-BL",
        "title": "Master Direction - Borrowing and Lending transactions in Indian Rupee between Persons Resident in India and Non-Resident Indians / Persons of Indian Origin",
        "kind": "master_direction",
        "regulator": "RBI",
        "official_url": "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=10191",
        "seed": {"adapter": "rbi_master_directions", "rbi_md_id": 10191, "style": "master_direction"},
    },
]

# Extra Master Directions are appended at seed time from the RBI listing when their title matches these patterns,
# so new FEMA Master Directions are picked up without a code change.
FEMA_MD_TITLE_PATTERNS = [
    r"Foreign Exchange",
    r"FEMA",
    r"External Commercial",
    r"Remittance",
    r"Overseas Investment",
    r"Export of Goods",
    r"Import of Goods",
    r"Non-Resident",
    r"Deposits and Accounts",
    r"Money Changing",
    r"Compounding of Contraventions",
    r"Reporting under Foreign Exchange",
    r"Establishment of Branch",
    r"Acquisition and Transfer of Immovable",
    r"Insurance",
    r"Other Remittance Facilities",
    r"Vostro",
    r"Risk Management and Inter-Bank",
    r"Guarantee",
    r"Borrowing and Lending",
    r"Direct Investment by Residents",
    r"Foreign Investment in India",
]
