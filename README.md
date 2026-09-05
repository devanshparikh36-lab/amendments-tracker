# Regulation Amendments Tracker

Internal K C Mehta & Co website that keeps Indian regulations (FEMA + RBI first; Income Tax, GST, Companies Act/SEBI
later) in **consolidated, as-amended form**, with the **timeline of every amendment** per provision and **every official
document stored verbatim** (extracted text + original PDF + attachments). It runs as a fully autonomous pipeline: no
human review step.

```
apps/web/            Next.js 15 site (Netlify)
services/pipeline/   Python worker: scrape -> store verbatim -> tag (Claude) -> merge (Claude) -> self-check -> notify (Railway cron)
packages/db/         SQL migrations (source of truth for the schema)
docs/sources/        notes per official source
```

## How it works

1. **Discover** - adapters list documents on official pages only: RBI FEMA notifications (incl. Central Government GSR
   notifications), A.P. (DIR Series) circulars, RBI Master Directions, and the FEMA Act via RBI's Act page.
2. **Fetch verbatim** - the detail page text, every PDF/annex, and the extracted text of each file are stored
   unchanged. Scanned PDFs go through OCR (flagged `ocr_used`).
3. **Tag (Claude, unattended)** - which regulation(s) and which provisions the document amends, with the verbatim
   amending instruction. Non-amending circulars are stored and shown but not merged.
4. **Merge (Claude, unattended)** - the instruction is applied to the current provision text, producing a new
   `provision_version` labelled **machine-consolidated** with a footnote. If the instruction cannot be applied
   unambiguously the engine returns `cannot_apply` and the amendment is only linked, never guessed.
5. **Self-check** - when RBI republishes a Master Direction ("Updated as on" changes) the official text is re-parsed
   and overrules machine merges; mismatches are flagged `differs_from_official` and posted to Teams.
6. **Notify** - Teams Adaptive Card per new document; daily Resend email digest.

Everything publishes immediately. Official and machine-consolidated text are always visually distinguished, and the
official document is linked beside every provision.

## Local development

Prerequisites: Python 3.12, Node 20+, PostgreSQL 15+ (a local cluster is fine).

```bash
# database
createdb amendments

# worker
cd services/pipeline
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt     # Windows; use .venv/bin/pip elsewhere
cp ../../.env.example .env   # then edit DATABASE_URL etc.
python cli.py migrate        # applies packages/db/migrations and registers Phase-1 instruments
python cli.py run            # discover + process jobs (fetch, seed Master Directions, tag, merge)
python cli.py backfill --since-year 2000   # one-off: pull RBI archive years

# web
cd apps/web
npm install
cp ../../.env.example .env.local   # DATABASE_URL, SITE_PASSCODE, optional R2_PUBLIC_BASE_URL
npm run dev                        # http://localhost:3000
```

Set `AI_ENABLED=false` to run the scraper without Claude (documents are stored and shown, tagging is skipped).

## Deployment

| Piece | Service | Notes |
|---|---|---|
| Database | Neon Postgres | Create a project, copy the pooled connection string into `DATABASE_URL` everywhere |
| Files | Cloudflare R2 | Bucket + API token; set `R2_*` on the worker and `R2_PUBLIC_BASE_URL` (public bucket or custom domain) on both |
| Worker | Railway | New service from this repo, Dockerfile `services/pipeline/Dockerfile`; cron `0 */6 * * *` runs `python cli.py run`. Add a second cron service `0 3 * * *` running `python cli.py digest` |
| Web | Netlify | Base directory `apps/web`, build `npm run build`; the Next.js runtime plugin is declared in `apps/web/netlify.toml` |
| Alerts | Teams incoming webhook + Resend | `TEAMS_WEBHOOK_URL`, `RESEND_API_KEY`, `DIGEST_FROM`, `DIGEST_TO` |
| AI | Anthropic API | `ANTHROPIC_API_KEY`; model defaults to `claude-opus-5` (`CLAUDE_MODEL`). Refusal fallback to Opus 4.8 is enabled server-side |

First deploy: run `python cli.py migrate` once against Neon (Railway shell or locally with the Neon URL), then
`python cli.py backfill --since-year 2000` to load history, then let the cron take over.

## Adding a regulator

1. Add an `Adapter` in `services/pipeline/amendments/adapters/` (see `rbi_fema_notifications.py`) and register it in
   `adapters/__init__.py`.
2. Add its instruments to `instruments.py` with a `seed` source (a function returning the regulator's consolidated text).
3. Deploy. Discovery, verbatim storage, tagging, merging, self-check and alerts need no changes.

## Data model (short)

`instrument` -> `provision` (hierarchical) -> `provision_version` (text, effective_from/to, `official` |
`machine_merged`). `document` (verbatim) -> `attachment` (files + extracted text). `document_tag` links documents to
instruments/provisions; `amendment_effect` records each applied change with old/new version ids and a verification
status. `source_run` and `job` drive and audit the pipeline. Full DDL: `packages/db/migrations/0001_init.sql`.
