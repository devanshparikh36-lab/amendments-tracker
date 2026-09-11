# Handoff — 11 Sept 2026

State of the Regulation Tracker at the end of the session that ended here, and what the next one should pick up.

## Live

- Site: https://teal-strudel-5db88d.netlify.app (passcode gate; `SITE_PASSCODE`)
- `main` is deployed and clean. Last three commits:
  - `f8bb670` Income tax: state the 1961-to-2025 comparison at the top, not in a footer
  - `5cb3b11` Share one Chromium across the browser-backed adapters
  - `e445182` Header: drop Status from the tabs, show when the collection last ran

## Verified in this session

- **Link check clean.** 27/27 seed pages and **2670/2670** distinct internal links return 200.
  All 15 outbound official links are reachable: RBI 200, R2 PDFs 200 (`application/pdf`), CBIC 200.
  Six return 403 to any scripted client but open normally in a browser — 3 on
  `incometaxindia.gov.in` and 3 on `mca.gov.in` (both Akamai). All three income-tax pages were opened
  in a real browser and render; the 404 reported earlier is fixed.
- **Comparison call-out** renders at the top of `/?subject=income-tax`, `/browse/ita-1961` and
  `/browse/ita-2025`, and on no other subject or instrument.
- **Header stamp** ("Last checked …") renders; Status is gone from the tabs and lives only in the footer.

## Open — verify first

**MCA collector fix is pushed but unproven.** `mca_circulars` and `mca_notifications` had failed on
*every* scheduled run with:

```
playwright._impl._errors.Error: It looks like you are using Playwright Sync API inside the asyncio loop.
```

Cause: Playwright's sync API allows one instance per thread. CBDT's browser starts first, its event
loop becomes the thread's running loop, and MCA's `sync_playwright().start()` then raises. `5cb3b11`
starts Playwright and Chromium once module-wide and gives each site its own context. Two sites in one
Chromium was confirmed working locally, but MCA discovery itself could not be run here (see
Environment below) — it has to prove itself on the CI runner.

**After the next 6-hourly run, check:**
1. `/status` shows `mca_circulars` and `mca_notifications` as `ok` with a non-zero "found" count.
2. `/?subject=companies` lists MCA circulars later than **31 Aug 2026** — the feed has been silently
   frozen at that date, so roughly ten days of circulars are missing and should arrive in one catch-up.

If it still fails, the next thing to check is whether `close_all()` is being reached between adapters
and whether the shared Chromium survived the CBDT run (`_engine()` relaunches it if `is_connected()`
is false).

## Open — not started

- **Alerts are unconfigured.** Needs a Teams incoming webhook URL, plus a Resend API key and digest
  recipients. Until then the daily digest and every storage warning go nowhere — including the
  free-tier alert the user explicitly asked for (`storage/usage.py`, WARN 75% / CRITICAL 90%).
- **Known data gaps**, regulator-side, not bugs: GST base texts still dated 2020–2022 and MCA
  2014–2021 (neither regulator has republished); three RBI Master Directions have ~30% empty
  paragraphs with no PDF fallback available.

## Environment — this machine, not the code

- The router's resolver (`192.168.0.1`) intermittently times out for **every** external name:
  `github.com`, `mca.gov.in`, `rbi.org.in`, the Neon host. Public resolvers work. Pushes and
  database calls fail with "Could not resolve host" during these episodes; retry, or point the
  machine at `8.8.8.8` / `1.1.1.1`.
- The network also does **TLS interception**, so scripted HTTPS fails certificate validation against
  some official sites. The link checker uses `verify=False` for this reason; `curl` needs `-k`.
  Do not read either symptom as a fault in the site or in a regulator's endpoint — verify by IP
  (`curl --resolve host:443:<ip>`) before concluding a link is broken.
