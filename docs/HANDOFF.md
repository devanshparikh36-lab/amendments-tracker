# Handoff — 12 Sept 2026

State of the Regulation Tracker and what the next session should pick up. Supersedes the 11 Sept note, which
described an architecture that no longer exists: collection has moved off GitHub Actions entirely.

## Live

- Site: the Netlify deployment, behind a passcode gate. URL and passcode are the `SITE_URL` and
  `SITE_PASSCODE` secrets — deliberately not written here, so this file stays safe to publish.
- 8,001 documents · 1,242 amendment effects · **12 of 12 adapters green**

## How it runs now — three Windows scheduled tasks, no GitHub minutes

GitHub Actions could never do this for free: a worker run is about an hour, four times a day, which is roughly
7,200 minutes a month against the 2,000 included with GitHub Free on a private repo. It exhausted the allowance
around the 8th of September and every job was refused thereafter — that, not any bug, is why collection stopped.

| task | what it does | when |
|---|---|---|
| `Regulation Tracker collection` | collect → digest → page index (400) → OCR (new scans only) → storage check | 07:15, 19:15 |
| `Regulation Tracker warm-up` | pings `/api/health` so Netlify and Neon stay awake | every 4 min |

**OCR now runs on new arrivals only.** The 284-document backlog is finished — 440 documents, 15,285 pages,
including all 76 SEBI master circulars — so the dedicated hourly OCR task was removed on 14 Sept: it had
nothing left to do and was waking every hour to discover that. The step inside the collection run stays, and
finds nothing in about six seconds on a normal day; its 20-minute budget is a ceiling for a day that brings a
pile of scans, not a cost paid every run.

Worth correcting for anyone sizing future work: OCR is **~0.3 seconds a page**, not the five seconds first
estimated here. That estimate came from a 90-second trial that happened to process single-page documents,
where per-document overhead dominates. The real backlog took 65 minutes, not the twenty hours predicted.

All are resumable: progress is recorded per item, so closing the laptop costs at most the file in flight.
`StartWhenAvailable` means a missed window runs when the machine next wakes. Scripts live in `scripts/`.

**Why collection silently did nothing for two days, and what fixed it.** The log read `run started` followed by
`^C`, three days running, with `LastTaskResult = 0xC000013A`. Nothing was wrong with the collection — it never
got to do any. Two settings combined: the task runs in the interactive session (`LogonType Interactive`), which
Windows kills when the machine sleeps, and this machine sleeps after five minutes idle (`STANDBYIDLE 0x12c`)
while a full run needs about forty. So it started, nobody touched the keyboard, and five minutes later it died.

Two changes, neither needing elevation. `WakeToRun` is now true, so 07:15 and 19:15 actually fire instead of
waiting for the lid to open — which is why runs were appearing at 11:08 and 21:39. And the task now runs
through `scripts/keepawake.ps1`, which asks Windows not to sleep for the duration via `SetThreadExecutionState`
and hands sleep back afterwards; the screen still dims and locks, only sleep is deferred. Verified: a run
survived eight minutes and kept working, where every previous one died at five.

Note for anyone editing that script: Windows PowerShell 5.1 reads `0x80000000` as a *signed* Int32, so casting
it to `[uint32]` throws and the flag is never set — the wrapper then looks installed and changes nothing. The
constants are written in decimal for that reason.

The cleaner fix is making the task `S4U` ("run whether the user is logged on or not"), which survives sleep
rather than deferring it, but `Set-ScheduledTask -Principal` returns Access Denied without an elevated shell:

```powershell
Set-ScheduledTask -TaskName "Regulation Tracker collection" -Principal (New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Limited)
```

GitHub keeps only `storage.yml` (daily, the free-tier alarm) and `keepalive.yml` (monthly). `worker.yml` and
`worker-residential.yml` are manual-only fallbacks; do not re-enable their schedules without checking minutes.

## Free tiers, and the alarm

| | used | limit | |
|---|---|---|---|
| Cloudflare R2 | 3.46 GB | 10 GB | 35% |
| Neon Postgres | 212 MB | 500 MB | 42% |

Neon was at 68% on 11 Sept. `cli.py compact --apply --full` cleared 103 MB of text that cost nothing to lose —
duplicated attachment copies, and `raw_html` nothing ever read. **The order is the trick**: clearing alone
moved the reported size 341.97 → 338.33 MB, because a plain VACUUM only marks space reusable; `VACUUM FULL`
hands it back but needs room for a second copy of the table, so `attachment` must be rewritten first to make
room for `document`. `--full` does this in the right order. OCR then added 32 MB, hence 42%.

**The 60% alarm is verified, not assumed.** `STORAGE_WARN_AT` overrides the threshold, so the whole path can be
exercised on demand: at 0.30 the R2 reading trips to `[warning]` and `cli.py storage` exits non-zero, which is
what fails the daily workflow and sends the mail; at the 0.60 default the same reading is `[ok]` and exits
zero. It has not fired in anger because storage is genuinely at 35%.

`retain` (FIFO deletion of the oldest ordinary documents per instrument) is built, armed at 70%, and idle.
It never touches base texts, anything an instrument names as its official text, anything tagged `is_amending`,
or the 200 most recent documents of any instrument. `retain --force` shows what it would do.

## Settled — amendments are references, and stay that way

**Decided 12 Sept 2026: amendments are shown as references, not applied to the text, and no paid AI is used.**
This is a standing decision, not a pending task. Do not turn `AI_ENABLED` on to "finish" consolidation, and do
not treat the zero below as a gap to close.

What the site therefore shows, and it is not thin: **16,370 document-to-provision links** — which notification
changed which provision, and when — across 1,474 identified effects from 481 documents. A reader gets the
regulator's own wording plus a link to the instrument that changed it. What it does not show is a consolidated
rewrite, and every version in the database is the regulator's: `source_kind = 'machine_merged'` is **0 of
6,446**, so nothing has been rewritten by a machine and nothing will be.

The footer states this plainly rather than warning about machine-consolidated provisions that never existed.
If consolidation is ever revisited, that copy has to change with it.

**Why it is the right call for legal content, beyond the cost:** applying an amendment means a machine
producing statutory wording that nobody has read, rendered indistinguishably from the regulator's own text. A
wrong consolidation is worse than no consolidation, because it is silently authoritative. The reference model
cannot mislead in that way — the worst case is one extra click to the official document.

All 1,474 effects therefore have `new_version_id = NULL`. That is the intended state.

A deterministic, AI-free merge was investigated and **rejected on evidence**. `cli.py mergepreview` reports what
it would do, and writes nothing. The proposed safety rule was to substitute only when the quoted old wording
appears exactly once in the target provision. Of 731 unapplied substitutions it finds 20 such cases — and three
of the first four land inside editorial footnotes recording *previous* amendments:

```
ITR-1962 31A — "seven days" occurs once, in:
  34. Substituted for "seven days" by the IT (Thirteenth Amdt.) Rules, 2019.
```

Applying that rewrites the footnote into a false statement rendered identically to real statutory text.
Uniqueness proves the match is unambiguous; it does not prove the match is in the law rather than in the
apparatus describing the law. Doing this properly requires separating operative text from footnotes across
every instrument — its own parsing project. Run `mergepreview` before revisiting; do not re-derive this.

So the honest choice is: enable AI and pay per document, or leave amendments as references, which is what the
site does today and what "official text only, no human review" already implies.

## Open — still queued, running unattended

- **2,974 attachments to page-index** (1,603 done). 400 per collection run.
- **836 attachments to re-fetch**, through the browser path. RBI's Imperva wall answered scripted PDF requests
  with an HTML interstitial carrying HTTP 200; 545 of those were stored as documents before anything checked.
  The indexer now refuses a one-or-two-page file whose text is a bot wall and records it unfetched.
- **Teams and Resend unconfigured.** `DIGEST_TO` should be the owner's own address — *not* the one in
  `git config user.email`, which is the account address and would mail the wrong person daily. Until set, the
  digest exits non-zero every run, which is deliberate: a digest that silently mails nobody is the failure this
  project kept having.

## Things that cost a session to learn

- **`\b` in a Postgres regex is a backspace, not a word boundary.** It is `\y`. Written with `\b` the
  definitions search matched nothing at all, silently and with no error.
- **`requestIdleCallback` does not fire in a background tab.** The contents sidebar loads on a plain timer for
  this reason; opening a section in a new tab is ordinary, and the idle version stayed at 60 of 935 entries.
- **A sequential batch is not a sample.** A run of 56 bot walls in 60 files looked like a trend; a random
  sample of 40 found none. The indexer walks `ORDER BY id` and RBI's attachments sit on contiguous ids.
- **Check billing before blaming the most recent change.** Collection "failing" for 19 hours was exhausted
  Actions minutes; the concurrency bug found at the same time was real but not the cause.
- **A queued job owns its concurrency group.** A workflow waiting on a label no runner claims will hold the
  group for 24 hours and starve everything sharing it.
- **psycopg reads a per-cent sign in a migration comment as a parameter placeholder** and fails the file.
- **Never run `next build` while `next dev` is running** — they share `.next`, and the dev server serves 404s
  for its chunks afterwards. Use `tsc --noEmit` to type-check.

## Environment — this machine, not the code

- The connection to Neon drops intermittently; jobs are written to survive it rather than retry forever.
  `net::ERR_NAME_NOT_RESOLVED` and "Network is unreachable" are this, not the code.
- TLS interception means scripted HTTPS fails certificate validation against some official sites. CBIC omits
  its intermediate certificate; `amendments/certs/` carries it and is committed.
- Tesseract is installed **per-user** at `%LOCALAPPDATA%\Programs\Tesseract-OCR` because winget ran unelevated,
  so it is off PATH. `parsers/pdf.py` checks known locations and sets `TESSDATA_PREFIX` itself.
- No `gh` CLI. Read worker history from `source_run` — which is what `/status` renders — or the GitHub web UI.
