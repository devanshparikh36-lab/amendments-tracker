# As Amended

Indian tax and corporate law in the regulator's own words, with the amendment trail beside it. Covers FEMA and RBI,
income tax, GST, the Companies Act and SEBI: **every official document stored verbatim** (extracted text, the original
PDF, its attachments) and **every amendment linked to the provision it changes** — which notification, and when.

Amendments are shown as **references, never applied to the text**. Nothing here is rewritten by a machine, so what you
read is what the regulator published; follow the link to read the change in their words. It runs as a fully autonomous
pipeline with no human review step.

```
apps/web/            Next.js 15 site (Netlify)
services/pipeline/   Python worker: scrape -> store verbatim -> tag -> (optional merge) -> self-check -> notify (GitHub Actions cron)
packages/db/         SQL migrations (source of truth for the schema)
docs/sources/        notes per official source
```

## How it works

1. **Discover** - adapters list documents on official pages only: RBI FEMA notifications (incl. Central Government GSR
   notifications), A.P. (DIR Series) circulars, RBI Master Directions, and the FEMA Act via RBI's Act page.
2. **Fetch verbatim** - the detail page text, every PDF/annex, and the extracted text of each file are stored
   unchanged. Scanned PDFs go through OCR (flagged `ocr_used`).
3. **Tag** - which regulation(s) and which provisions the document amends, with the verbatim amending instruction.
   Default mode is **rule-based and free** (`AI_ENABLED=false`): FEMA notifications name their principal regulation
   and the regulation/schedule they change; circulars name the Master Direction. Original regulation notifications
   become tracked instruments and are split into regulations automatically.
4. **Merge (optional, Claude)** - with `AI_ENABLED=true` and an `ANTHROPIC_API_KEY`, the instruction is applied to
   the current provision text, producing a new `provision_version` labelled **machine-consolidated**. Without AI,
   Master Directions stay consolidated (RBI publishes them consolidated and they are re-scraped on every update) and
   FEM Regulations show the original text with every amendment linked per regulation number. Run
   `python cli.py retag` after enabling AI to reprocess documents scraped earlier.
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
cp ../../.env.example .env.local   # DATABASE_URL, optional R2_PUBLIC_BASE_URL
npm run dev                        # http://localhost:3000
```

`AI_ENABLED` defaults to true in code but the deployment runs with `AI_ENABLED=false` (rule-based tagging, no API cost).

## Deployment

| Piece | Service | Notes |
|---|---|---|
| Database | Neon Postgres | Create a project, copy the pooled connection string into `DATABASE_URL` everywhere |
| Files | Cloudflare R2 | Bucket + API token; set `R2_*` on the worker and `R2_PUBLIC_BASE_URL` (public bucket or custom domain) on both |
| Worker | GitHub Actions (free) | `.github/workflows/worker.yml` runs `python cli.py run` every 6 hours; `digest.yml` sends the daily email; `keepalive.yml` stops GitHub from pausing the schedule. Variables live in the repo's Actions secrets |
| Web | Netlify | Base directory `apps/web`, build `npm run build`; the Next.js runtime plugin is declared in `apps/web/netlify.toml` |
| Alerts | Teams incoming webhook + Resend | `TEAMS_WEBHOOK_URL`, `RESEND_API_KEY`, `DIGEST_FROM`, `DIGEST_TO` |
| AI (optional) | Anthropic API | Off by default (`AI_ENABLED=false`). To enable merging later: `AI_ENABLED=true`, `ANTHROPIC_API_KEY`; model `claude-opus-5` |

First deploy: add the secrets listed in `.env.example` to the repo (Settings > Secrets and variables > Actions), run the worker workflow once by hand, then
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
