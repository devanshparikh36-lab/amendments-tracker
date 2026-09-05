# MCA (mca.gov.in) source notes

The Ministry of Corporate Affairs portal is an Adobe AEM site. Everything the pipeline needs comes from MCA's own
**e-Book** ("Acts & Rules" in the top navigation, `/content/mca/global/en/acts-rules/ebooks/…`): the Companies Act,
2013 section by section, the Rules made under it rule by rule, and every notification and General Circular MCA has
published for the Acts it administers. No third-party site is involved.

## A browser is required

Two separate defences, both handled in `adapters/mca.py` (`needs_browser = True`, `browser_home = <home page>`):

1. **Bot protection.** A plain HTTP client (httpx, curl) gets `403` on *every* URL, including `/`. A real Chromium
   gets `200`, so all traffic goes through `amendments.browser` (delay kept at >= 1.1 s).
2. **`clientlib-devtool.js`.** Every page loads `<script disable-devtool-auto url='/…/home.html'
   src='/etc.clientlibs/mca/clientlibs/clientlib-devtool.js'>`, which *navigates the browser to the home page* when it
   thinks devtools are open - which is what an automated Chromium looks like. So the adapter never navigates: it
   anchors one warm page on the home page and calls every endpoint with `fetch()` from inside it
   (`session.get_text` / `get_bytes`), which the script cannot intercept.

`/content/mca/global/en/acts-rules.html` is a server-side redirect to `…/acts-rules/ebooks.html`.

## Endpoints

All under `https://www.mca.gov.in`. No login, no token, no CSRF header.

| What | Endpoint | Notes |
|---|---|---|
| Notifications listing | `GET /bin/ebook/service/documentMetadata?docCategory=Notifications&flag=initial&status=Current` | The **whole** list in one response (833 rows, 2003-date). No pagination, no page/size parameters |
| Circulars listing | `GET /bin/ebook/service/documentMetadata?docCategory=Circulars&flag=initial&status=Current` | Same shape (245 rows). `docCategory=NotificationsAndCirculars` returns an empty body - do not use it |
| Acts | `GET /bin/ebook/service/documentMetadata?docCategory=Acts&status=Current&Level=1` | The 10 Acts MCA administers. The Companies Act, 2013 is `docId J105_D`, `link 668275747`, `originalDocId 5961` |
| Chapters of an Act | `…&docCategory=Acts&status=Current&Root=J105_D&Parent=J105_D&Level=2` | 34 chapters |
| Sections of a chapter | `…&docCategory=Acts&status=Current&Root=J105_D&Parent=<chapter docId>&Level=3` | Not needed - the Act's own document is a full table of contents (below) |
| Rules sets under an Act | `…&docCategory=Rules&status=Current&Root=J112_D&Parent=J112_D&Level=2` | 54 sets, e.g. `J112_RC3 = Chapter II The Companies (Incorporation) Rules, 2014`. `Level=1&docGroup=The Companies Act, 2013` gives the root `J112_D` |
| Rules of one set | `…&docCategory=Rules&status=Current&Root=J112_D&Parent=J112_RC3&Level=3&flag=initial` | 49 rows for the Incorporation Rules (rules, inserted rules and the Annexure forms) |
| A document | `GET /bin/ebook/dms/getdocument?doc=<base64(link)>&docCategory=<category>` | Notification / circular -> `application/pdf`. Act section, Act root and rule -> verbatim HTML fragment |

Listing rows: `link` (document id), `docName` (the number: `G.S.R. 61(E)`, `S.O. 1303(E)`, `General Circular
No.02/2023`), `shortDescription` (`"<number>-<subject>"`), `notificationdate` (**US order**, `MM/DD/YYYY`),
`docGroup` (the Act it belongs to), `PDFSize`, `docId`, `docIdentifier`. Levels 2/3 repeat rows, so dedupe on `docId`.

`source_url` is the `getdocument` URL itself - it is stable, unique per document, and is also the attachment URL, so
`fetch()` parses `link` and `docCategory` straight back out of it.

## Official text

* **Companies Act, 2013** - `getdocument?doc=<b64(668275747)>&docCategory=Acts` returns the whole table of contents in
  one response: `<h4>Chapter …</h4>` headings and `<a data-docIdentifier="D1C2S5" data-docindex="33338"
  class="tocLink">4. Memorandum</a>` per section (545 entries incl. the Schedules). Each `data-docindex` is then one
  more `getdocument` call returning that section's verbatim HTML.
* **Rules** - one `getdocument` per rule from the Level-3 listing. Rule 1 of each set is `Short Title and
  Commencement`; the Annexure forms come through as `Form No: INC-1` style entries.
* A section/rule document can carry more than its own provision (the section 1 document also holds the Act preamble
  and the Chapter I heading), so the text is sliced at the `id="<docIdentifier>"` anchor.
* Amended provisions keep their footnote markers verbatim: `2[6. Conversion of One Person Company …`,
  `1[33A. Allotment of a new name …`, `1[Omitted]`. `_number_and_heading()` reads the number past the marker.

## Quirks

* **Bilingual gazette PDFs.** Notifications are the Gazette of India copy: the **Hindi text comes first** and the
  English text after it, often past 8,000 characters. Number/date extraction and rule tagging therefore scan the whole
  document, not a short head.
* **Scanned PDFs.** Roughly half the circulars (and some older notifications) are image-only scans - `%PDF` with
  `/Subtype /Image` and no text layer. `parsers/pdf.py` falls back to Tesseract, which the pipeline image installs
  (`tesseract-ocr` in `services/pipeline/Dockerfile`); on a developer machine without Tesseract those documents
  extract to 0 characters and are skipped by the tagger.
* **Quotation marks.** The gazette font extracts opening/closing quotes as `―` and `‖` rather than `“` `”`, so the
  tagger strips both when it separates an amending instruction from the new wording it quotes.
* Numbers in the listing are already clean (`G.S.R. 61(E)`), so nothing has to be recovered from the PDF; the PDF
  fallbacks in `fetch()` only cover the rare row with a blank `docName`.
* Titles occasionally repeat the number or carry MCA's own typos (`Companies (Specification and definitions details )
  2nd Amendment Rules 2021`); they are stored verbatim.
* The e-Book publishes only the **current** version (`status=Current`); MCA has no archive endpoint, so `since_year`
  simply filters `notificationdate` (default 2014, matching `MIN_DOCUMENT_YEAR`).
* The `/bin/dms/searchDocList` endpoint behind "Circulars" / "Notices & Circulars" / "What's New" on the home page is
  a *different*, much smaller store (site notices, tenders, liquidation sale notices - folders `1420`, `1442`, `325`).
  It is not the legal corpus and is not used.
