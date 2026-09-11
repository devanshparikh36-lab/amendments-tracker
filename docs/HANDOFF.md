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

## Resolved — the free tiers, with room to spare

Neon was at 68% of its 500 MB free plan, which is the nearest thing this project has to an outage: past the
limit the free plan stops accepting writes and collection halts. It is now at **34%**.

| | before | after | free limit |
|---|---|---|---|
| Cloudflare R2 | 3.34 GB | 3.34 GB (33%) | 10 GB |
| Neon Postgres | 342 MB (68%) | **171 MB (34%)** | 500 MB |

`cli.py compact --apply --full` cleared 103 MB of text that cost nothing to lose and handed the space back:

- **70 MB** — 6564 attachments whose `extracted_text` was byte-identical to their own document's. The document
  copy is the one that matters (`document_fts_idx` indexes it, `_doc_full_text` already skipped the duplicate),
  and the PDFs stay in R2, so the column is rebuildable by re-extracting.
- **33 MB** — `raw_html` on 7994 documents. Every adapter wrote it; nothing ever read it back.

**The order is the trick, and it is easy to get wrong.** Clearing alone moved the reported size almost not at
all — 341.97 to 338.33 MB — because a plain VACUUM only marks space reusable, and `document` grew by the new
row versions about as fast as `attachment` shrank. `VACUUM FULL` hands it back, but needs room for a second
copy of the table it rewrites, and `document` at 176 MB does not fit under a 500 MB limit with 162 MB free.
Rewriting `attachment` first (88 MB → 8 MB) releases enough room for `document` to follow. `--full` does this
in the right order and skips any table that will not fit. Whole thing took 34 seconds.

**Do not run `--full` while discovery is writing.** Its lock is ACCESS EXCLUSIVE. Running the clearing half
during a live `discover` deadlocked `sebi_regulations` mid-upsert; Postgres picked the adapter as the victim.
Nothing was lost, but it cost a re-run.

**Alerting:** `c4a1318` drops the warning threshold from 75% to **60%** and makes `cli.py storage` exit
non-zero when a limit passes it. The **Free-tier watch** workflow runs it daily, so a breach fails the workflow
and GitHub emails the repository owner — the only channel here that costs nothing and needs no secret. Both
limits currently report `[ok]` and the watch exits 0.

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

**Best lead: the runner's egress. All five adapters were run from this machine and every one of them worked**,
returning its exact historical count:

| adapter | on the runner | from here |
|---|---|---|
| `cbic_gst_notifications` | 0, after 39m | **5**, 17s |
| `cbic_gst_circulars` | 0, after 43m | **3**, 17s |
| `sebi_circulars` | 0, after 8m | **1371**, ~7m |
| `sebi_master_circulars` | 0, after 8m | **133**, ~8s |
| `sebi_regulations` | 0, after 33m | **1137**, ~5m |

Same commit, same code, same regulators; the only variable is where the request comes from. Two independent
regulators breaking on one run while answering in seconds from an ordinary Indian IP fits a datacentre-IP block
far better than coincident outages — Indian government sites commonly refuse cloud ranges. Still untested
*from* the runner, which is the one piece missing; the next scheduled run supplies it now that `EmptyDiscovery`
makes a zero-yield run fail loudly. If it holds, the free fixes are moving discovery to the Railway cron
(`cli.py run` is already what Railway runs) or a self-hosted runner on a residential connection.

The CBIC category endpoint also returns HTTP 500, but that is a red herring — `_categories` retries and falls
back to its built-in list, costing minutes rather than documents.

### The self-hosted runner — installed, not yet registered

`C:\actions-runner` holds actions-runner v2.337.0 for win-x64, downloaded from the official `actions/runner`
releases and verified against its published SHA-256 (`1150692a…85cfc`). The repository is **private**, which is
what makes this acceptable at all: on a public repo any stranger's pull request would execute on this machine.

`worker-residential.yml` is committed and waits on the label `[self-hosted, windows, residential]`. Until a
runner claims that label the job simply never starts, and `worker.yml` carries on as the baseline — so nothing
is broken by leaving this half-finished.

**Three things remain, all of them on the machine rather than in the repo:**

1. **Stop it sleeping.** `STANDBYIDLE` is `0x12c` — five minutes on AC. A runner on a sleeping machine misses
   essentially every six-hourly run. `powercfg /change standby-timeout-ac 0`.
2. **Register it**, from Settings → Actions → Runners → New self-hosted runner, for the token:
   `cd C:\actions-runner && .\config.cmd --url https://github.com/devanshparikh36-lab/amendments-tracker
   --labels self-hosted,windows,residential --unattended --token <TOKEN>`. Add `--runasservice` from an
   elevated terminal to survive logout; without it the runner only exists while `run.cmd` is open.
3. **Tesseract is not installed**, and `worker.yml` only ever got it through `apt-get`. Discovery does not need
   it; OCR fallback for scanned PDFs during `work` does, so expect `ocr_used` to stay false on this path until
   it is installed.

Once it is running, confirm the five go green on `/status`, then consider whether `worker.yml`'s schedule
should stay — today it is the safety net, but it will keep raising `EmptyDiscovery` for these five every run.

## Open — 16 instrument pages serve nothing, and one of them is FEMA

This is the largest gap in the site and it had not been written down. Of 195 instruments:

| | count | what a reader sees |
|---|---|---|
| parsed into provisions | 75 | full section-level text and amendment history |
| official PDF only | 104 | the regulator's PDF — by design, `EMPTY_PROVISION_LIMIT` serves the PDF when a parse is untrustworthy |
| **nothing at all** | **16** | an empty page |

The 16 come from the same root as the 136 failed `selfcheck_instrument` jobs — which are only **10 distinct
instruments** retried once per run over ~26 runs, not 136 separate problems. Get them with:

```sql
SELECT slug FROM instrument i WHERE pdf_storage_key IS NULL
  AND NOT EXISTS (SELECT 1 FROM provision p WHERE p.instrument_id = i.id);
```

**`fema-1999` is the one that matters** — the flagship instrument of a FEMA-first site, with zero provisions, no
PDF and `last_checked_at = NULL`. It has never seeded successfully. The cause is not ours: `rbi_fema_act`
follows whatever RBI's Act page links for FEMA, and RBI still links
`indiacode.nic.in/handle/123456789/1988`, which now returns a real 404. India Code has moved to
`indiacode.gov.in/act/<uuid>/sections`, and **that entire new platform returned HTTP 502** at the root when
checked on 11 Sept. So there is currently no working official URL for the FEMA text; deliberately nothing was
hardcoded, since no candidate could be verified to return the real Act. Re-check `indiacode.gov.in`, and if it
is back, set `text_url` in the `fema-1999` seed config (the adapter already honours it) rather than waiting for
RBI to fix its link.

`fem-export-of-goods-and-services-regulations-2000` fails differently and the failure is *correct*: "parsed into
only 2 provisions; refusing to overwrite". That guard is protecting good data from a bad parse — do not
weaken it to make the error go away.

**The four SEBI master circulars cannot be fixed from our side — SEBI publishes empty pages.** Fetched
directly, `master-circular-for-stock-exchanges-cash-market_22556.html` is 7800 bytes of HTML containing a
title, a breadcrumb and a date: **184 characters of visible text and no PDF link at all**. Same for the 2014
and 2015 ones. The adapter's "yielded only 1302 characters" refusal is the guard working — there is no text
there to collect, and no amount of browser rendering or parser work will invent it. Treat as a regulator-side
gap alongside the GST and MCA base texts.

Some of the 16 look like double registrations of an instrument that already has content. The clearest is that
same pair: `...stock-exchange**s**-cash-market` is an empty stub while `...stock-exchange-cash-market` serves a
PDF — one regulation registered twice, and the site is showing the dead twin. `...educatuion-fund...` next to
`...education-fund...` is the same story with a typo. Fuzzy title matching suggested as many as 12, but it also
paired attestation-of-documents with delisting and igst-rules with igst-act — Rules and an Act are different
instruments — so that number is not trustworthy. The two pairs above are the ones that survive reading, and
each still needs a human decision before anything is merged or deleted.

**The `sebi_master_circulars` fetch backlog is cleared.** 73 documents were queued and could not be fetched by
GitHub's runners (blocked adapter); running `cli.py work --adapter sebi_master_circulars` from this machine
collected all 73, and no document from that source is now missing its text. This is the concrete argument for
the residential runner: that backlog would otherwise have sat there indefinitely.

## Open — not started

- **Teams and Resend are still unconfigured**, so the daily digest and the richer alerts go nowhere. No code
  change needed: `worker.yml` already wires `TEAMS_WEBHOOK_URL`, `RESEND_API_KEY`, `DIGEST_FROM`, `DIGEST_TO`,
  `SITE_URL` as secrets. Until then both kinds of breakage route through GitHub's failure email instead, which
  costs nothing and needs no secret: storage via the Free-tier watch, and collection because `discover` and
  `run` now exit non-zero if any adapter failed. **Expect `worker.yml` to go red every six hours** until the
  five blocked sources move to the residential runner — they are genuinely broken there and have been since
  10 Sept, and the silence was the actual bug.
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
