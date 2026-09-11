# Handoff — 11 Sept 2026

State of the Regulation Tracker, and what the next session should pick up.

## Live

- Site: https://teal-strudel-5db88d.netlify.app (passcode gate; `SITE_PASSCODE`)
- `main` is deployed and clean. Recent commits:
  - `00631db` Add a compact command for the 103 MB of text the database stores for nothing
  - `c4a1318` Warn at 60% of a free tier, and make the warning actually reach someone
  - `23ee0eb` Fail a discovery run that lists nothing when it listed documents days ago
  - `5cb3b11` Share one Chromium across the browser-backed adapters

## Resolved — MCA collects again

The MCA collectors had failed on every scheduled run with `Playwright Sync API inside the asyncio loop`. Two
things were wrong, and the second hid the first.

**The fix was never deployed.** `5cb3b11` was committed 9 Sept 15:51 IST and pushed 11 Sept 12:52 IST — it sat
here for two days. Every run that "proved it failing" had checked out `e445182`. The stored traceback showed
`self._pw = sync_playwright().start()`, the per-instance shape that no longer exists in the file.

**The fix itself is sound, and is now demonstrated.** Running `cli.py discover --adapter cbdt_circulars
--adapter mca_circulars --adapter mca_notifications` reproduced the exact CI sequence:

```
chromium launched                                   <- ONE Chromium
browser session ready at www.incometaxindia.gov.in  <- site 1
cbdt_circulars: 309 found, 0 new
browser session ready at www.mca.gov.in             <- site 2, same Chromium
mca_circulars: 228 found, 0 new
mca_notifications: 684 found, 0 new
```

All three recorded `ok` in `source_run`. One `chromium launched`, two sites, no exception.

**The "ten missing days" were never missing.** The earlier note expected a catch-up of circulars after
31 Aug 2026. There is none to collect: the adapter reads MCA's whole feed (`228 documents since 2014, of 245
published`) and MCA has issued four General Circulars all year — 01, 02 on 19 Jun, 03 on 8 Jul, 04 on 31 Aug.
An eleven-day gap is their cadence, not a fault. Do not read a flat MCA feed as a broken collector.

**Guard rail:** `close_all()` must never be reached *between* adapters. It calls `_stop_engine()`, which nulls
`_pw` and sends the next adapter back through `sync_playwright().start()` — the original bug. Only `cli.py`
calls it, in a `finally` at process exit. Keep it that way.

## Open — the free tiers, which is now the live risk

`cli.py storage` reports both limits. As of 11 Sept:

| | used | free limit | |
|---|---|---|---|
| Cloudflare R2 | 3.34 GB | 10 GB | 33% |
| **Neon Postgres** | **342 MB** | **500 MB** | **68%** |

**Neon is the binding constraint.** Past 500 MB the free plan stops accepting writes and collection halts; the
next plan is $19/month. R2 merely starts charging (~$0.015/GB/month) past 10 GB.

`c4a1318` drops the warning threshold from 75% to 60% and makes `cli.py storage` exit non-zero when a limit is
filling up. The new **Free-tier watch** workflow runs it daily and therefore fails — which makes GitHub email
the repository owner. That is the only alerting channel here that costs nothing and needs no secret. It is
failing *right now* by design, because Neon is at 68%.

**103 MB is reclaimable whenever you want it** — `cli.py compact` reports, `cli.py compact --apply` clears:

- **70 MB** — 6564 attachments whose `extracted_text` is byte-identical to their own document's. The document
  copy is the one that matters (`document_fts_idx` indexes it, `_document_text` already skips a duplicate), and
  the PDF stays in R2 so the column can be rebuilt by re-extracting.
- **33 MB** — `raw_html` on 7994 documents. Every adapter writes it; nothing reads it back, in the pipeline or
  the web app.

Applying takes Neon to roughly 48%. It is dry by default because it deletes collected data. Note that a plain
VACUUM makes the space *reusable* but does not shrink the reported size; that needs `VACUUM FULL`, which needs
room for a second copy of the table — so do it one table at a time, and not at 68%.

## Open — five adapters were collecting nothing while reporting `ok`

On the 11 Sept run:

| adapter | found | previously | time burned |
|---|---|---|---|
| `cbic_gst_notifications` | 0 | 5, every run | 39m |
| `cbic_gst_circulars` | 0 | 3, every run | 43m |
| `sebi_regulations` | 0 | 1137, every run | 33m |
| `sebi_master_circulars` | 0 | 133, every run | 8m |
| `sebi_circulars` | 0 | ~1368, every run | 8m |

All five previously finished in under a minute. Minutes of retries ending in zero is the signature of every
unit of work timing out. The adapters catch failures per unit and continue by design (`cbic_gst.py:262`,
`sebi.py:225`) — right on its own, but when *every* unit fails they return `[]` and the run is recorded
`ok, found = 0`. This also cost ~2h11m, which is what pushed MCA to the end of the run.

`23ee0eb` is the detector: an empty result from an adapter productive within the last 30 days now raises
`EmptyDiscovery`, lands in `source_run.error` and fires the adapter-failure alert. **A detector, not a cure** —
if collection is still broken these five go red on the next run, which is the intended outcome.

**Best lead: the runner's egress.** Probed from this machine, both regulators are healthy — SEBI listings
HTTP 200 in ~1.5s, CBIC portal root 200. Two independent regulators breaking on the same run while answering in
a second from an ordinary Indian IP fits a datacentre-IP block far better than coincident outages; Indian
government sites commonly refuse cloud ranges. Untested from the runner, so treat as hypothesis. If it holds,
the free fix is to move discovery to the Railway cron (`cli.py run` already is what Railway runs) rather than
GitHub Actions. The CBIC category endpoint also returns HTTP 500, but that is a red herring — `_categories`
retries and falls back to its built-in list, costing minutes rather than documents.

## Open — not started

- **Teams and Resend are still unconfigured**, so the daily digest and the richer storage alert go nowhere. No
  code change needed: `worker.yml` already wires `TEAMS_WEBHOOK_URL`, `RESEND_API_KEY`, `DIGEST_FROM`,
  `DIGEST_TO`, `SITE_URL` as secrets. The GitHub failure email above covers storage in the meantime.
- **Known data gaps**, regulator-side: GST base texts dated 2020–2022, MCA 2014–2021 (neither has republished);
  three RBI Master Directions have ~30% empty paragraphs with no PDF fallback.
- `AI_ENABLED` is `false` on the worker, so the AI merge path (`ai_note`, `cannot_apply`) is inert on scheduled
  runs. Consistent with official-text-only, but worth knowing before debugging why effects are not applied.

## Environment — this machine, not the code

- **The local resolver fails for `.gov.in` names and the Neon host.** Whichever resolver is in use —
  `192.168.0.1` on the router, `172.20.10.1` tethered — it returns "DNS server failure" while public resolvers
  answer instantly. It surfaces as `net::ERR_NAME_NOT_RESOLVED` in Playwright and as dropped Neon connections
  mid-write. Check `Get-DnsClientServerAddress`; set the adapter to `8.8.8.8` / `1.1.1.1` before running
  discovery locally. This is the most likely reason `5cb3b11` sat unpushed for two days.
- The network also does **TLS interception**, so scripted HTTPS fails certificate validation against some
  official sites. The link checker uses `verify=False`; `curl` needs `-k`. Verify by IP
  (`curl --resolve host:443:<ip>`) before concluding a link is broken.
- **Before concluding a deployed fix failed, check it actually shipped**: compare `git reflog show origin/main`
  push times against the run's start time, and confirm with `git ls-remote origin main` rather than trusting the
  local tracking ref. That mistake cost most of a session here.
- No `gh` CLI, so Actions runs cannot be inspected or dispatched from the shell. Read worker history from
  `source_run` (which is what `/status` renders) or the GitHub web UI.
