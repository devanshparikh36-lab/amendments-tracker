-- Regulation Amendments Tracker - initial schema (PostgreSQL 15+)
-- Source of truth for both the Python worker and the Next.js app.

CREATE TABLE IF NOT EXISTS regulator (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,          -- RBI, DEA, CBDT, CBIC, MCA, SEBI
  name        TEXT NOT NULL,
  website     TEXT
);

CREATE TABLE IF NOT EXISTS instrument (
  id                      SERIAL PRIMARY KEY,
  regulator_id            INT NOT NULL REFERENCES regulator(id),
  slug                    TEXT NOT NULL UNIQUE,   -- e.g. fema-1999, md-ecb
  short_code              TEXT NOT NULL,
  title                   TEXT NOT NULL,
  kind                    TEXT NOT NULL CHECK (kind IN ('act','rules','regulations','master_direction','scheme','other')),
  official_url            TEXT,
  official_updated_as_on  DATE,
  seeded_at               TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provision (
  id            SERIAL PRIMARY KEY,
  instrument_id INT NOT NULL REFERENCES instrument(id) ON DELETE CASCADE,
  parent_id     INT REFERENCES provision(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,          -- "6", "6(3)", "Para 2.1", "Annex I"
  heading       TEXT,
  level         TEXT NOT NULL DEFAULT 'section',  -- chapter | section | para | annex
  sort_key      INT NOT NULL,
  UNIQUE (instrument_id, number)
);
CREATE INDEX IF NOT EXISTS provision_instrument_idx ON provision(instrument_id, sort_key);

CREATE TABLE IF NOT EXISTS document (
  id              SERIAL PRIMARY KEY,
  regulator_id    INT NOT NULL REFERENCES regulator(id),
  source_adapter  TEXT NOT NULL,        -- rbi_fema_notifications, rbi_apdir, rbi_master_directions, indiacode
  doc_type        TEXT NOT NULL,        -- notification | apdir_circular | master_direction | act | rules | gsr | press_release | faq | other
  number          TEXT,                 -- e.g. FEMA 395/2019-RB, A.P. (DIR Series) Circular No. 12
  title           TEXT NOT NULL,
  date_issued     DATE,
  date_effective  DATE,
  source_url      TEXT NOT NULL,
  raw_html        TEXT,
  extracted_text  TEXT,
  checksum        TEXT,                 -- sha256 of primary content (PDF or HTML)
  is_amending     BOOLEAN,              -- set by tagger; NULL = not yet tagged
  tag_status      TEXT NOT NULL DEFAULT 'pending' CHECK (tag_status IN ('pending','tagged','merged','failed','skipped')),
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_url)
);
CREATE INDEX IF NOT EXISTS document_date_idx ON document(date_issued DESC);
CREATE INDEX IF NOT EXISTS document_fts_idx ON document USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(extracted_text,'')));

CREATE TABLE IF NOT EXISTS attachment (
  id              SERIAL PRIMARY KEY,
  document_id     INT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  mime            TEXT,
  source_url      TEXT NOT NULL,
  storage_key     TEXT,                 -- R2 object key (or local path in dev)
  size_bytes      BIGINT,
  page_count      INT,
  extracted_text  TEXT,
  ocr_used        BOOLEAN NOT NULL DEFAULT false,
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  checksum        TEXT,
  UNIQUE (document_id, source_url)
);
CREATE INDEX IF NOT EXISTS attachment_fts_idx ON attachment USING GIN (to_tsvector('english', coalesce(extracted_text,'')));

CREATE TABLE IF NOT EXISTS provision_version (
  id                      SERIAL PRIMARY KEY,
  provision_id            INT NOT NULL REFERENCES provision(id) ON DELETE CASCADE,
  text                    TEXT NOT NULL,
  effective_from          DATE,
  effective_to            DATE,                          -- NULL = current
  source_kind             TEXT NOT NULL CHECK (source_kind IN ('official','machine_merged')),
  created_by_document_id  INT REFERENCES document(id),
  merge_confidence        REAL,
  footnote                TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provision_version_current_idx ON provision_version(provision_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS provision_version_fts_idx ON provision_version USING GIN (to_tsvector('english', text));

CREATE TABLE IF NOT EXISTS document_tag (
  id            SERIAL PRIMARY KEY,
  document_id   INT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  instrument_id INT NOT NULL REFERENCES instrument(id) ON DELETE CASCADE,
  provision_id  INT REFERENCES provision(id) ON DELETE SET NULL,
  relation      TEXT NOT NULL CHECK (relation IN ('amends','clarifies','references','supersedes')),
  confidence    REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS document_tag_uniq ON document_tag(document_id, instrument_id, coalesce(provision_id, 0), relation);

CREATE TABLE IF NOT EXISTS amendment_effect (
  id                  SERIAL PRIMARY KEY,
  document_id         INT NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  provision_id        INT NOT NULL REFERENCES provision(id) ON DELETE CASCADE,
  change_type         TEXT NOT NULL CHECK (change_type IN ('insert','substitute','omit','renumber','cannot_apply')),
  old_version_id      INT REFERENCES provision_version(id),
  new_version_id      INT REFERENCES provision_version(id),
  confidence          REAL,
  ai_note             TEXT,             -- machine explanation of what was applied or why it could not be
  verification_status TEXT NOT NULL DEFAULT 'unchecked' CHECK (verification_status IN ('unchecked','matches_official','differs_from_official')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS amendment_effect_provision_idx ON amendment_effect(provision_id);

CREATE TABLE IF NOT EXISTS source_run (
  id           SERIAL PRIMARY KEY,
  adapter      TEXT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  docs_found   INT NOT NULL DEFAULT 0,
  docs_new     INT NOT NULL DEFAULT 0,
  ok           BOOLEAN,
  error        TEXT
);

CREATE TABLE IF NOT EXISTS job (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL,            -- fetch_document | tag_document | merge_document | selfcheck_instrument | digest
  payload     JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts    INT NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_queue_idx ON job(status, created_at);

CREATE TABLE IF NOT EXISTS notification_log (
  id          SERIAL PRIMARY KEY,
  channel     TEXT NOT NULL,            -- teams | email
  document_id INT REFERENCES document(id) ON DELETE CASCADE,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok          BOOLEAN NOT NULL,
  detail      TEXT
);

-- Seed regulators
INSERT INTO regulator (code, name, website) VALUES
  ('RBI',  'Reserve Bank of India', 'https://www.rbi.org.in'),
  ('DEA',  'Department of Economic Affairs, Ministry of Finance', 'https://dea.gov.in'),
  ('CBDT', 'Central Board of Direct Taxes', 'https://incometaxindia.gov.in'),
  ('CBIC', 'Central Board of Indirect Taxes and Customs', 'https://www.cbic.gov.in'),
  ('MCA',  'Ministry of Corporate Affairs', 'https://www.mca.gov.in'),
  ('SEBI', 'Securities and Exchange Board of India', 'https://www.sebi.gov.in')
ON CONFLICT (code) DO NOTHING;
