# Handoff — 9 Oct 2026

State of As Amended and what the next session should pick up. Supersedes the 12 Sept note; the sections below
are that note, corrected where it had gone wrong. Read this header first, because two of its claims were
false and cost three weeks.

## Corrections to the 12 Sept note, found 9 Oct

**The site had not been deployed since 18 September.** Three deploys failed in a row — 21 Sept (×2) and
23 Sept — every one of them at the `Confirm which site we are deploying to` step, before `netlify build` ran.
`deploy.yml` was byte-identical to the last successful run and `netlify-cli@27.6.0` is still on npm, so the
cause is external: a secret. Most likely `NETLIFY_AUTH_TOKEN` expired or was revoked. **No Netlify build or
deploy minutes were consumed by the failures** — the step dies before either. Two consequences were live on
the site for three weeks:

- `/preview`, the scratch page for choosing type and colour, was still being served (`d3e9d19` deleted it).
- Every page still sent `private, no-cache, no-store`, because the `force-dynamic` removal in `862f3e2` never
  shipped. That is the setting the notes below blame for running an account out of credits, and it was still
  in force: one function invocation and one Neon query per page view, nothing cacheable.

That step now reports which of the three failure modes it hit and which secret to fix, rather than exiting
with the CLI's own message and no context.

**The page-index and OCR backlogs were not "running unattended".** The table below used to claim this
workflow did "discover → fetch → tag → page index → OCR". It did not: `cli.py run` is discovery, the job
queue and a storage check, and `pageindex` / `refetch` / `ocr` are separate subcommands with no job type
behind them, so nothing had invoked them since the Windows tasks were disabled on 14 Sept. 2,974 attachments
waiting to be indexed and 836 holding an Imperva bot wall stood still while every run reported green.
`worker.yml` now runs all three as bounded, soft-failing steps and prints what is still queued.

**Teams and Resend are no longer unconfigured.** `digest.yml` has succeeded every day this month, and
`cli.py digest` exits non-zero when `RESEND_API_KEY` or `DIGEST_TO` is missing, so both are set. The "Open"
section below is wrong about this.

**Two real bugs, fixed.** `document_fts_idx` indexed the whole of `title || extracted_text`, so any document
whose text exceeded Postgres's 1 MB tsvector cap could not be written at all — six `fetch_document` jobs died
on it and stayed dead. The index is now bounded to 500,000 characters and the query in `lib/queries.ts`
repeats the expression exactly (it must, or Postgres sequential-scans). `attachment_fts_idx` was dropped
outright: nothing reads it, and it was a GIN index over the OCR text of ~89,000 pages in a 500 MB database.
Separately, `requeue_missing_attachments` filtered on `job.status = 'pending'`, which is not a job status —
it is `document.tag_status`. The clause matched nothing, so the count it returned was a lie.

**397 failed self-checks were a timeout, not a broken source.** They carried the message `timed out`, which
is `str(httpx.ReadTimeout)` and says nothing about what was being read. One scalar 60-second timeout applied
to connect and read alike; a consolidated SEBI Regulation is a multi-megabyte PDF. Reads now get four
minutes, connects twenty seconds, and a failure names the instrument, the adapter and the URL.

## Live

- Site: the Netlify deployment, open to anyone — the passcode gate was removed on 14 Sept along with the
  firm's name. Everything it serves is already public: the regulators' own documents. The URL is the
  `SITE_URL` secret.
- 8,001 documents · 1,242 amendment effects · **12 of 12 adapters green**

## How it runs now — GitHub Actions on a public repo, no machine of ours involved

**This repository is public, and that is load-bearing.** Public repositories get unlimited Actions minutes; a
private one gets 2,000 a month. A worker run is about an hour, so four a day was roughly 7,200 a month — the
allowance went around 8 September and every job was refused thereafter, which is why collection stopped without
any bug. Even at the current once-daily schedule a private repo would be at ~1,800 of 2,000, about 90%, with no
margin for the 4h17m outlier that has already happened once. **If this is ever made private again, collection
will stop mid-month unless the schedule drops well below daily.**

| workflow | what it does | when |
|---|---|---|
| `worker.yml` | discover → fetch → tag, then re-fetch → page index → OCR as separate bounded steps | **07:00 IST daily** |
| `digest.yml` | mails what changed | 08:00 IST daily |
| `storage.yml` | free-tier alarm, fails past 60% | daily |
| `keepalive.yml` | keeps schedules alive | monthly |

The three Windows scheduled tasks are **disabled**, not deleted, and `scripts/` still holds them. They are the
way back if GitHub is ever unusable — but re-enabling them reintroduces the failure they were disabled for: the
task runs in the interactive session, and this machine sleeps after five minutes idle, so a forty-minute run is
killed unless `keepawake.ps1` wraps it.

**History was rewritten on 14 Sept before publishing.** All 107 commits were reauthored to
`devanshparikh36-lab@users.noreply.github.com`, because the committer address is published on every commit of a
public repo and no content scrub reaches it. Verified afterwards against GitHub's own API: that address is the
only one served. The cost is that every SHA changed, so commit hashes quoted in older notes no longer resolve —
the messages survive, the links do not. The pre-rewrite history is at `refs/original/refs/heads/main` locally.

**Watch CBIC and SEBI on the first runs.** Those five returned zero from GitHub's runners on 11 September while
returning full counts from a residential connection, and the cause was never established — the runner-side logs
went unread. They burned 131 minutes between them in retries that day. `EmptyDiscovery` now fails the run rather
than recording a green zero, so if it is still happening it will say so instead of looking healthy.

**OCR now runs on new arrivals only.** The 284-document backlog is finished — 440 documents, 15,285 pages,
including all 76 SEBI master circulars — so the dedicated hourly OCR task was removed on 14 Sept: it had
nothing left to do and was waking every hour to discover that. The step inside the collection run stays, and
finds nothing in about six seconds on a normal day; its 20-minute budget is a ceiling for a day that brings a
pile of scans, not a cost paid every run.

Worth correcting for anyone sizing future work: OCR is **~0.3 seconds a page**, not the five seconds first
estimated here. That estimate came from a 90-second trial that happened to process single-page documents,
where per-document overhead dominates. The real backlog took 65 minutes, not the twenty hours predicted.

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

## Open

- **The Netlify secret has to be fixed by hand.** Until it is, nothing reaches the live site. See the
  corrections at the top; the deploy step will now name which secret is at fault on the next run.
- **2,974 attachments to page-index** (1,603 done) and **836 to re-fetch** through the browser path. RBI's
  Imperva wall answered scripted PDF requests with an HTML interstitial carrying HTTP 200; 545 of those were
  stored as documents before anything checked. The indexer refuses a one-or-two-page file whose text is a bot
  wall and records it unfetched. Both backlogs now advance 400 per run — but they had not moved at all
  between 14 Sept and 9 Oct, so treat the counts above as the starting point, not the current state.
- **403 failed jobs** (397 self-check, 6 fetch). Both causes are fixed, but a failed job is never retried by
  anything: they need re-queuing before the count will fall. They are now listed on `/status` under "Needs
  attention", which previously counted only amendment effects and so printed "Nothing outstanding" above a
  table of 403 failures.
- **Teams is still unconfigured.** `TEAMS_WEBHOOK_URL` is unset; the Resend digest is configured and sending.
  `DIGEST_TO` must stay the owner's own address — *not* the one in `git config user.email`, which is the
  account address and would mail the wrong person daily.

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
