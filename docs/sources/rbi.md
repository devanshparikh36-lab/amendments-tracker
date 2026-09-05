# RBI (rbi.org.in) source notes

All pages are ASP.NET WebForms. Listing pages show the current year; archive years are loaded by the page's own
`GetYearMonth(year, month)` JavaScript, which sets hidden inputs `hdnYear` / `hdnMonth` and submits the hidden button
`UsrFontCntr$btn`. `adapters/rbi_common.fetch_archive_year()` replicates that postback (all hidden fields incl.
`__VIEWSTATE` must be echoed back).

| Source | Listing URL | Detail URL pattern | Notes |
|---|---|---|---|
| FEMA notifications (FEM Regulations by RBI + Central Govt GSR notifications for FEM Rules) | `Scripts/BS_FemaNotifications.aspx` | `BS_FemaNotifications.aspx?Id=N` | Rows grouped under a date header row; number in the 2nd cell (sometimes junk like "rbi"); notification PDF in the row, gazette copy linked inside the detail page |
| A.P. (DIR Series) circulars | `Scripts/BS_CircularIndexDisplay.aspx` | `BS_CircularIndexDisplay.aspx?Id=N` | 5-column table: number (with RBI/yyyy-yy/nnn), date `dd.m.yyyy`, department, subject, meant for. Filter on "A.P. (DIR Series)" or department "Foreign Exchange Department" |
| Master Directions | `Scripts/BS_ViewMasDirections.aspx` | `BS_ViewMasDirections.aspx?id=N` | Title carries "(Updated as on <date>)"; detail page has the full consolidated text in HTML (better than the PDF) with footnotes at the end. FEMA ones are picked by title patterns in `instruments.py` |
| RSS | `notifications_rss.xml` | - | Full HTML of the latest notifications across departments; not used yet (listing pages are authoritative) |
| Acts | `scripts/Act.aspx` | - | RBI links the FEMA Act to India Code (`indiacode.nic.in/handle/123456789/1988`), which the Act seeder follows |

Detail page content lives in the `<table class="td">` that contains `<p class="head">`. Site-wide PDFs (Accessibility,
Utkarsh, GS1093, GazetteNotification16072019) appear on every page and are excluded from attachments.

Master Direction text layout: cover letter (numbered 2., 3., 4.) -> INDEX table -> ACRONYMS -> PART headings ->
numbered paras `13.` / `15.1.` -> APPENDIX (list of circulars consolidated) -> footnotes `N Inserted/Deleted vide ...`.
Deleted ranges appear as `1 to 1.17 4[Deleted]` where the leading number before `[Deleted]` is a footnote marker.
