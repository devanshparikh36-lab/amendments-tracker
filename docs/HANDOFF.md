# Handoff — 11 Sept 2026

State of the Regulation Tracker at the end of the session that ended here, and what the next one should pick up.
This note replaces an earlier one from the same day; the section below says what that note got wrong.

## Live

- Site: https://teal-strudel-5db88d.netlify.app (passcode gate; `SITE_PASSCODE`)
- `main` is deployed and clean. Last three commits:
  - `23ee0eb` Fail a discovery run that lists nothing when it listed documents days ago
  - `c46d762` Handoff note: what is verified, what the MCA fix still has to prove
  - `f8bb670` Income tax: state the 1961-to-2025 comparison at the top, not in a footer

## Correction — the MCA fix had never run

The earlier note said the MCA fix was "pushed but unproven" and still failing. The first half was wrong, and it
made the second half meaningless.

`5cb3b11` was committed on **9 Sept at 15:51 IST** and pushed on **11 Sept at 12:52 IST** — it sat on this
machine for two days. `git reflog show origin/main` is the record:

```
e445182  pushed 2026-09-09 14:17:41 IST
f8bb670  pushed 2026-09-11 12:52:54 IST   <- 5cb3b11 finally went up in this push
c46d762  pushed 2026-09-11 12:55:44 IST
```

The 11 Sept worker checked out at ~04:58 UTC, two and a half hours *before* that push landed, so it ran
`e445182`. The stored traceback confirms which file was executing:

```
browser.py", line 61, in start
    self._pw = sync_playwright().start()
```

`self._pw` is per-instance — the pre-fix shape. Today's `start()` calls `_engine().new_context()` and contains no
`sync_playwright()` at all; `git show 5cb3b11^:services/pipeline/amendments/browser.py` matches the traceback at
lines 61, 97 and 132 exactly. All five failures (four on 10 Sept, one on 11 Sept) ran pre-fix code.

**So the shared-Chromium fix has never executed once.** It is not disproven — it is untested. Reading it against
the run data it should hold: MCA runs last, CBDT starts Chromium at 05:18, `_engine()` hands MCA a context off
it, and the 2h15m idle gap is covered because the relaunch path rebuilds Chromium from the existing `_pw`
without calling `start()` again. The one thing that would break it is `close_all()` being reached *between*
adapters — it calls `_stop_engine()`, which nulls `_pw` and sends the next adapter back through
`sync_playwright().start()`. Only `cli.py` calls it, in a `finally` at process exit, which is correct. Keep it
that way.

**Lesson worth keeping:** before concluding a deployed fix failed, check `git reflog show origin/main` against
the run's start time. Pushes from this machine fail silently often enough (see Environment) that "committed" and
"deployed" drift apart.

## Open — verify first

**1. MCA: the fix is proven locally, still unconfirmed on CI.** Running the exact failing pair on this machine —
`python cli.py discover --adapter cbdt_circulars --adapter mca_circulars` — reproduced the CI conditions and
cleared the bug:

- `cbdt_circulars` listed **309 documents through the browser**, so Chromium was up and owned by CBDT.
- `mca_circulars` then got a context off that same Chromium and reached `browser.py:106`, `page.goto(...)`.
  `_engine().new_context()` and `new_page()` both succeeded. The `sync_playwright().start()` frame that used to
  raise is gone from the traceback entirely.

MCA then failed on `net::ERR_NAME_NOT_RESOLVED` — local DNS, not code (see Environment). CBDT failed too, but
*after* its 309 documents, on `psycopg.OperationalError: the connection is lost` writing to Neon: the same
network episode. Neither failure touches the Playwright question.

What remains is confirming it on the runner, which is Linux + Xvfb + headed Chromium rather than Windows. The
mechanism is identical and the failing line no longer exists, so this is confirmation rather than a real doubt.
Check after the next run:
- `/status` shows `mca_circulars` and `mca_notifications` as `ok` with a non-zero found count.
- `/?subject=companies` lists circulars later than **31 Aug 2026**. The feed is frozen there; notifications are
  frozen at 12 Aug 2026.

**2. Five adapters were collecting nothing while reporting `ok`.** Found this session, root cause not yet
diagnosed. On the 11 Sept run:

| adapter | found | previously | time burned |
|---|---|---|---|
| `cbic_gst_notifications` | 0 | 5, every run | 39m |
| `cbic_gst_circulars` | 0 | 3, every run | 43m |
| `sebi_regulations` | 0 | 1137, every run | 33m |
| `sebi_master_circulars` | 0 | 133, every run | 8m |
| `sebi_circulars` | 0 | ~1368, every run | 8m |

All five had previously finished in under a minute. Minutes of retries ending in zero is the signature of every
unit of work timing out. Each adapter catches failures per unit and continues by design
(`cbic_gst.py:262`, `sebi.py:225`) — correct on its own, but when *every* unit fails the adapter returns `[]`
and `run_discovery` faithfully records `ok = true, found = 0`. This also cost ~2h11m of the run, which is what
pushed MCA out to 07:35.

`23ee0eb` adds the detector: an empty result from an adapter that was productive inside the last 30 days now
raises `EmptyDiscovery`, lands in `source_run.error` and fires the adapter-failure alert. **It is a detector, not
a cure** — if the underlying collection is still broken, these five will go red next run. That is the intended
outcome; red is information. The cause still has to be chased, starting with the per-unit warnings in the run
log, which say exactly which HTTP calls failed.

**Best current lead: the runner's egress, not the regulators.** Probed from this machine, both sites are healthy:

```
sebi circulars listing      HTTP 200   46276 bytes   1.4s
sebi regulations listing    HTTP 200   41737 bytes   1.5s
cbic portal root            HTTP 200    3067 bytes   1.4s
cbic notification categories  HTTP 500    196 bytes   0.8s   <- jhipster error, but handled
```

Two independent regulators breaking on the same run, while both answer in about a second from an ordinary Indian
IP, fits a datacentre-IP block far better than coincident outages — Indian government sites commonly refuse
cloud egress ranges. Treat as a hypothesis, not a finding: it has not been tested from the runner. The CBIC 500
is real but a red herring, because `_categories` retries and then falls back to its built-in list; it costs
minutes, not documents.

Nothing has been ingested from any source since 9 Sept.

## Open — not started

- **Alerts are unconfigured**, and this is now the expensive gap: `23ee0eb` routes silent collector failures to
  `teams.notify_adapter_failure`, which goes nowhere until a Teams incoming webhook URL is set. No code change is
  needed — `worker.yml` already wires `TEAMS_WEBHOOK_URL`, `RESEND_API_KEY`, `DIGEST_FROM`, `DIGEST_TO` and
  `SITE_URL` as secrets. Setting those values turns on the digest and the free-tier storage warning
  (`storage/usage.py`, WARN 75% / CRITICAL 90%) too.
- **Known data gaps**, regulator-side, not bugs: GST base texts still dated 2020–2022 and MCA 2014–2021 (neither
  regulator has republished); three RBI Master Directions have ~30% empty paragraphs with no PDF fallback.
- `AI_ENABLED` is `false` on the worker, so the AI merge path (`ai_note`, `cannot_apply`) is inert on scheduled
  runs. Consistent with official-text-only, but worth knowing before debugging why effects are not being applied.

## Verified earlier this session

- **Link check clean.** 27/27 seed pages and 2670/2670 distinct internal links return 200. All 15 outbound
  official links reachable. Six return 403 to any scripted client but open normally in a browser — 3 on
  `incometaxindia.gov.in`, 3 on `mca.gov.in` (both Akamai).
- **Comparison call-out** renders at the top of `/?subject=income-tax`, `/browse/ita-1961` and `/browse/ita-2025`,
  and nowhere else. **Header stamp** ("Last checked …") renders; Status is gone from the tabs.

## Environment — this machine, not the code

- **The local resolver fails for `.gov.in` names and for the Neon host.** Whichever resolver the machine is
  currently using — `192.168.0.1` on the router, `172.20.10.1` when tethered to a phone, which is what it was on
  11 Sept — it returns "DNS server failure" while public resolvers answer instantly:

  ```
  DEFAULT  www.mca.gov.in -> FAILED: DNS server failure
  GOOGLE   www.mca.gov.in -> 23.45.91.142, 23.45.91.131
  ```

  This is what stopped the local MCA run, and what dropped the Neon connection mid-write in the same minute. Set
  the Wi-Fi adapter's DNS to `8.8.8.8` / `1.1.1.1` before running discovery or a link check locally. It is also
  the most likely reason `5cb3b11` sat unpushed for two days.
- The network also does **TLS interception**, so scripted HTTPS fails certificate validation against some
  official sites. The link checker uses `verify=False` for this reason; `curl` needs `-k`. Do not read either
  symptom as a fault in the site or in a regulator's endpoint — verify by IP
  (`curl --resolve host:443:<ip>`) before concluding a link is broken.
- No `gh` CLI installed, so GitHub Actions runs cannot be inspected or dispatched from the shell. Worker history
  has to be read from the `source_run` table (which is what `/status` renders) or the GitHub web UI.
