# Roadmap: beyond FEMA

Decisions (6 Sep 2026): zero running cost; amendments and circulars tracked from **2014** onwards (GST effectively
from 2017), base Act/Rules texts always kept; RBI stays **FEMA-only**; order **Income Tax -> GST -> SEBI -> MCA**;
each regulator gets Act text, Rules/Regulations text, notifications and circulars. Plus a **1961 vs 2025 section
comparison utility** for the Income-tax Acts.

Everything reuses the existing engine: an adapter lists documents on an official page, `fetch` stores them verbatim
with attachments, `rules.py` links each document to instruments/provisions, seeders split official consolidated
text into provisions, self-check re-scrapes when the regulator republishes. No AI.

---

## Phase A - Income Tax (CBDT)

**Source**: `https://www.incometaxindia.gov.in` (rebuilt on Liferay in 2026; the old `/Pages/...aspx` URLs are gone).
It sits behind Akamai bot protection: plain HTTP clients get 403, a real browser loads fine. The adapter therefore
runs through **headless Chromium (Playwright)** inside the GitHub Actions job (free; ~1 extra minute per run).
Fallback for notifications only: the e-Gazette, where every CBDT notification is also published.

| Content | URL | Notes |
|---|---|---|
| Income-tax Act, 1961 (as amended) | `/income-tax-act` | sections loaded via the site's CMS (`ShowMainContent('Act','CMSID', id)`); one call per section |
| Income-tax Act, 2025 | `/income-tax-act-202511` | in force from 1 Apr 2026; same CMS mechanism |
| Income-tax Rules, 1962 / 2026 | `/income-tax-rules`, `/income-tax-rule-2026` | rule-wise, same mechanism |
| Notifications | `/notifications` | filterable by year; PDFs under `/documents/d/guest/...` |
| Circulars | `/circulars` | same layout as notifications |
| Finance Acts | `/finance-acts` | amending Acts; useful for the Act's amendment timeline |

Instruments: `ita-1961`, `ita-2025`, `itr-1962`, `itr-2026`, plus Finance Acts as documents.
Rules for tagging: notifications cite "In exercise of the powers conferred by section 295 ... the Central Board of
Direct Taxes hereby makes the following rules further to amend the Income-tax Rules, 1962" and "in rule 12 ...";
circulars cite "section 194Q" etc. Same regex approach as FEMA (`_LABELLED` already matches "Section/Rule N").

Self-check: the site's Act/Rules pages are the consolidated text, re-scraped on every run; a changed section text
creates a new `official` version (gives the section-level history even without merging).

### Section comparison utility (1961 vs 2025)
- Seed both Acts section-wise (above).
- Mapping source: CBDT's official section-mapping table published with the 2025 Act (on the site under the 2025 Act
  resources / "FAQs on Interplay and Transition"), stored as a `section_map` table: `old_section`, `new_section`,
  `note`. Where the official map is absent for a pair, fall back to heading similarity and flag it as "unmapped".
- Page `/compare/income-tax`: pick a 1961 section (or a 2025 one) and see the two texts side by side with the
  existing word-level diff, plus the mapping note and links to both provisions' histories. Search box accepts
  "80C", "section 10(23C)", or a heading word.
- Export: CSV of the full mapping with heading and status (identical / reworded / merged / split / dropped).

## Phase B - GST (CBIC)
Sources: `cbic-gst.gov.in` (Acts and Rules as amended, notification series: Central Tax, Central Tax (Rate), IGST,
IGST (Rate), UTGST, Compensation Cess; circulars, orders, instructions). Instruments: CGST Act 2017, IGST Act 2017,
CGST Rules 2017 (+ UTGST, Cess). Tagging: notifications name "the Central Goods and Services Tax Rules, 2017" and
"in rule 46"; rate notifications amend earlier notifications (link notification-to-notification as `amends`).

## Phase C - SEBI
Sources: `sebi.gov.in` Legal -> Acts, Regulations (each regulation page shows "last amended on"), Circulars,
Master Circulars. Instruments: one per Regulation (LODR, ICDR, SAST, PIT, ...). Regulations are published
consolidated, so seeding and self-check work like Master Directions.

## Phase D - Companies Act (MCA)
Sources: `mca.gov.in` Acts and Rules (as amended), notifications, general circulars. Heavily scripted site; use the
same Playwright fetcher as CBDT. Instruments: Companies Act 2013 plus each set of Rules.

---

## Engineering changes needed once (before Phase A)
1. **Browser fetcher**: `amendments/http_browser.py` using Playwright; adapters declare `needs_browser = True`.
   GitHub Actions installs Chromium (`playwright install --with-deps chromium`).
2. **Per-regulator cutoff**: `MIN_DOCUMENT_YEAR` stays global (2014); GST has no earlier documents.
3. **Section map table** and `/compare` page (Phase A only).
4. **Site navigation**: group instruments by regulator on `/browse`; regulator filter already exists on `/documents`.

## Storage outlook
FEMA from 2014: ~60 MB in R2, ~60 MB in Neon. Each further regulator adds an estimated 100-300 MB to R2 and
50-150 MB to Neon. Free limits: R2 10 GB, Neon 500 MB. Neon is the one to watch; raw HTML can be dropped from the
`document` table if it gets tight (PDFs stay in R2).
