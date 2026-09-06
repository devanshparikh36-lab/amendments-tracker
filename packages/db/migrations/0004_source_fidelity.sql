-- Every provision must be traceable to the official document it came from, and openable at the right page.
-- Users of this site rely on the regulator's own file, not on our re-rendering of it.

-- The official rendering as the regulator publishes it (HTML with its own tables, indents and provisos).
ALTER TABLE provision_version ADD COLUMN IF NOT EXISTS html TEXT;

-- Where this provision lives in the official source.
ALTER TABLE provision ADD COLUMN IF NOT EXISTS source_url TEXT;          -- the regulator's page for this provision
ALTER TABLE provision ADD COLUMN IF NOT EXISTS pdf_storage_key TEXT;     -- R2 key of the stored official PDF
ALTER TABLE provision ADD COLUMN IF NOT EXISTS pdf_page INTEGER;         -- 1-based page where the provision starts

-- The official PDF of the instrument as a whole (Master Direction, SEBI Regulation, consolidated Act...).
ALTER TABLE instrument ADD COLUMN IF NOT EXISTS pdf_storage_key TEXT;
ALTER TABLE instrument ADD COLUMN IF NOT EXISTS pdf_source_url TEXT;
ALTER TABLE instrument ADD COLUMN IF NOT EXISTS pdf_page_count INTEGER;
ALTER TABLE instrument ADD COLUMN IF NOT EXISTS pdf_fetched_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS provision_pdf_idx ON provision(instrument_id) WHERE pdf_page IS NOT NULL;
