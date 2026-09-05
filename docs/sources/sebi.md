# SEBI (sebi.gov.in) source notes

Everything comes from `www.sebi.gov.in` over plain HTTP (`amendments.http`); no browser session is needed. Only
`/sebiweb/...` and `/legal/...` respond to a scripted client — the pretty section URLs such as
`https://www.sebi.gov.in/legal/regulations` return **403**, so never use them.

## Listings

`GET /sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=<N>&smid=0` renders a Legal sub-section. `sid=1` is Legal;
`ssid` picks the sub-section:

| ssid | Sub-section | Used by |
|---|---|---|
| 1 | Acts | `SebiRegulations` (doc_type `act`) |
| 2 | Rules | not tracked |
| 3 | Regulations | `SebiRegulations` (doc_type `regulations`) |
| 4 | General Orders | not tracked |
| 5 | Guidelines | not tracked |
| 6 | Master Circulars | `SebiMasterCirculars` (doc_type `master_circular`) |
| 7 | Circulars | `SebiCirculars` (doc_type `circular`) |

That page shows **only the first 25 rows**. Its own pagination is an AJAX call (`js/entry.js`,
`searchFormNewsList`), and that is what the adapter uses:

```
POST /sebiweb/ajax/home/getnewslistinfo.jsp        (application/x-www-form-urlencoded)
  nextValue=1 next=n search= fromDate= toDate= fromYear= toYear= deptId=
  sid=1 ssid=<N> smid=0 ssidhidden=<N> intmid=-1 sText=Legal ssText= smText=
  doDirect=<zero-based page index>
```

The reply is `"<listing html>#@#<breadcrumb html>"`; the adapter keeps the part before `#@#`. Page size is 25 and
the row count is in `.pagination_inner` ("1 to 25 of 2800 records"). **`fromDate` / `toDate` are `dd-mm-yyyy`** —
`dd/mm/yyyy` is silently ignored (it returns the unfiltered set) and ISO dates return nothing.

### The two Regulations listings differ

`HomeAction.do?ssid=3` lists ~42 rows: the Regulations SEBI presents as **current**. The AJAX endpoint for the same
`ssid` returns the whole archive (~1,120 rows): every superseded consolidation, every amending regulation and every
corrigendum, each with a real issue date. The adapter uses both — the archive for documents, the plain listing to
decide which rows are the current consolidated texts (and therefore instruments). Acts behave the same way
(6 current rows vs 13 in the archive).

## Detail pages

`/legal/<section>/<mon-yyyy>/<slug>_<entryId>.html`, static HTML:

| Element | Content |
|---|---|
| `<h1>` | title |
| `div.date_value h5` | `Aug 24, 2026` |
| `div.id_area` | `Circular No.: HO/(449)2026-ITD-5_DIV1/I/19448/2026`, or just the section name ("Regulations", "Acts") |
| `section.main_section iframe` | `../../../web/?file=<pdf url or /sebi_data/... path>` — the document itself |

Almost every SEBI document is a **PDF only**, so `body_text` is normally empty and the pipeline falls back to the
primary attachment's extracted text. `pdf_from_viewer()` unwraps the `file=` parameter (it is sometimes absolute,
sometimes a site-root path on older documents).

## Instruments

SEBI publishes one consolidated *"[Last amended on \<date\>]"* PDF per Act / Regulation, so a Regulation is both a
document and an instrument. `is_consolidated()` separates them: a row is a consolidated text when its title carries
`[Last amended on ...]`, and is an amending document when it is a `(Nth Amendment) Regulations` or a `Corrigendum`.
The 42 current Regulations plus the 3 principal Acts (SEBI Act 1992, SCRA 1956, Depositories Act 1996) are
registered automatically from `extra["instrument_slug"]` (see `pipeline._ensure_instrument`); the twelve named in
`instruments.SEBI_INSTRUMENTS` keep hand-written slugs (`sebi-lodr-2015`, `sebi-icdr-2018`, …).

`official_text()` re-reads the consolidated page for the seeder / self-check. **SEBI mints a new URL for every
republication** (`...-last-amended-on-july-14-2026-_102974.html`, new `entryId` too), so `seed.match` — a regex on
the title — is the stable key and `official_url` is only a fallback.

## Quirks

* `https://www.sebi.gov.in/legal/regulations` (and the other section landing paths) → 403 for scripted clients; the
  `HomeAction.do` and `/legal/.../*.html` URLs are fine.
* Gazette PDFs carry the **full Hindi version before the English one**, so the operative English wording can start
  30,000+ characters in. `rules.tag_sebi` therefore searches the whole document, not just its opening.
* Some gazette notifications are **scanned images** with no text layer (roughly one in four of the 2026 amendment
  regulations); `parsers.pdf` OCRs them when tesseract is installed, otherwise they arrive empty.
* SEBI's own titles are inconsistent: unbalanced brackets ("(Alternative Investment Funds Regulations, 2012"),
  `[[Last amended`, "last amended on on July …", trailing `.pdf`, "Regulations 2018" without the comma. The slug
  patterns and `clean_title()` absorb these.
* Consolidated PDFs print their footnotes at the foot of **every page**, not once at the end. That breaks the RBI
  Master Direction rule "everything after the first footnote is the appendix", so SEBI texts are split with
  `split_provisions(..., style="sebi")`, which keeps footnotes with the provision they were printed under.
* The Circulars archive reaches back to 1992 (2,800 rows). Discovery asks for `01-01-2014` onward; the pipeline's
  `MIN_DOCUMENT_YEAR` still does the global filtering.
* The Mutual Funds Regulations, 1996 have been recast as the (Mutual Funds) Regulations, 2026 and only the current
  text is listed, so that instrument's slug (`sebi-mutual-funds`) carries no year.
