# CBIC GST (cbic-gst.gov.in / taxinformation.cbic.gov.in) source notes

`cbic-gst.gov.in` is a static Bootstrap site. Its "GST Acts" menu item opens CBIC's tax-information portal
(`https://taxinformation.cbic.gov.in`, a `cbic.gov.in` host, certificate issued to "Central Board of Indirect Taxes and
Customs"), which is where notifications, circulars, orders, instructions, Acts and Rules now live. The old static
listings (`hindi/central-tax-notifications.html`, PDFs under `pdf/central-tax/...`) stop at 2022 and are not used.

The portal is an Angular app over a JHipster JSON API. Listing pages are empty without JavaScript, so the adapters call
the API the browser calls. No login: the app requests an anonymous token (`POST api/authenticate-token`, empty body ->
`{"id_token": ...}`) and sends it as `Authorization1: homeToken <jwt>` plus `language: en`. Most list endpoints return
HTTP 500 without that header; single-record and content endpoints work without it.

| What | Endpoint | Notes |
|---|---|---|
| Notification series | `GET api/cbic-notification-msts/fetchCategory/1000001` | Central Tax, Central Tax (Rate), Integrated Tax, Integrated Tax (Rate), Union Territory Tax, Union Territory Tax (Rate), Compensation Cess, Compensation Cess (Rate). `1000001` = taxId GST (`api/cbic-tax-msts`) |
| Notifications by year | `GET api/cbic-notification-msts/fetchNotificationByYearAndCategory?page=0&size=1000&year=YYYY&category=<series>&taxId=1000001` | JSON array, newest first, no `X-Total-Count`; `size` up to 1000 works. Fields: `id`, `notificationNo` ("02/2026-Central Tax" or "Corrigendum"), `notificationName` (subject), `notificationDt` (ISO), `docFilePath` (English PDF), `docFilePathHi`, `docFilePathAOD` (as-on-date copy, usually empty) |
| Circular categories | `GET api/cbic-circular-msts/fetchCircularCategory/1000001` | "Circulars CGST", "Circulars -IGST", "Circulars - Compensation Cess" |
| Circulars by year | `GET api/cbic-circular-msts/fetchCircularByYearCategory?page=&size=&year=&category=&taxId=` | `circularNo` like "243/37/2024-GST", `circularDt` |
| Order categories | `GET api/cbic-order-msts/order-category/1000001` | "Order-CGST", "Order-UTSGT" (sic), "Removal of Difficulty - CGST", "Removal of Difficulty - UTGST" |
| Orders by year | `GET api/cbic-order-msts/fetch-orders-year-category?...` | `orderNo` like "Order-02/2019-GST" / "Order No.10/2019 - Central Tax" |
| Instructions by year | `GET api/cbic-instruction-msts/fetch-instructions-year-category?page=&size=&year=&taxId=1000001` | GST instructions have no category; passing `category=` returns `[]`, omit it. `instructionNo` like "Instruction No. 06/2025-GST" |
| One record | `GET api/cbic-<notification|circular|order|instruction>-msts/<id>` | no token needed |
| File content | `GET content/pdf/<docFilePath with / separators>` | returns JSON `{"data": <base64 PDF>, "fileName": ...}` with `content-type: application/json`; `http.get_bytes` unwraps this envelope so the pipeline stores a real PDF |
| Acts | `GET api/cbic-act-msts/fetchActs/1000001` | CGST Act id 1000006, IGST 1000015, UTGST 1000016, Compensation Act 1000013 |
| Act sections | `GET api/cbic-act-section-msts/findByActId/<actId>` then `GET content/html/<contentFilePath>` per section | list is in document order (chapter by chapter); each page is one section as amended, footnote markers like `1[...]` inline |
| Rules | `GET api/cbic-rule-msts/fetchRules/1000001` | CGST Rules id 1000006 (also IGST Rules 1000028, Cess Rules 1000029, UT rules) |
| Rule sections | `GET api/cbic-rule-section-msts/findSectionByRuleId/<ruleId>` then `content/html/...` | includes a header row and per-chapter "Introduction" rows |

Document keys: `source_url` is the portal deep link `https://taxinformation.cbic.gov.in/content-page/explore-notification/<id>`
(circulars `explore-circulars/<id>`, orders `explore-orders/<id>`, instructions `explore-instructions/<id>`); the
adapter parses kind and id back out of it in `fetch()`. Orders and instructions are stored with `doc_type = circular`.

Quirks
- TLS: the portal sends only its leaf certificate (issuer "Sectigo Public Server Authentication CA OV R36"), so
  default verification fails with "unable to get local issuer certificate". The intermediate (from the certificate's
  AIA URL) is bundled in `amendments/certs/` and loaded into the shared HTTP client; verification stays on.
- HEAD requests are dropped by the server ("server disconnected"); always GET.
- Some endpoints (`fetchCategory`, `fetchCircularCategory`, `instuction-category`) intermittently return 500; the
  adapters fall back to built-in category lists.
- The single-file "consolidated" Act/Rules documents (`contentHtmlFilePath`, "Last Updated: 28-September-2022") lag
  years behind; the section-wise pages carry later amendments (e.g. section 16(5) inserted in 2024), so the seeder
  assembles the text from them. `amendDt` is mostly null on sections; `updated_as_on` is the latest non-null one or the
  Act/Rules record's `amendDt`.
- Numbers: the API's `notificationNo` has no "Notification No." prefix; the adapter adds it
  ("Notification No. 12/2024-Central Tax"). Corrigenda are numbered "Corrigendum".
- The pipeline's `MIN_DOCUMENT_YEAR` cutoff applies; GST itself starts 1 July 2017, so `since_year` is clamped to 2017.
