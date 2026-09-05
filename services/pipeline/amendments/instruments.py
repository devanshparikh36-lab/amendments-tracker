"""Instruments tracked in Phase 1 (FEMA + RBI). Adding a regulator later means adding entries here plus an adapter.

official_url is the page the seeder/self-check re-scrapes for the regulator's own consolidated text.
`rbi_md_id` identifies the Master Direction on rbi.org.in; the seeder uses the HTML detail page (cleaner than the PDF).
"""
from __future__ import annotations

PHASE1_INSTRUMENTS: list[dict] = [
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
