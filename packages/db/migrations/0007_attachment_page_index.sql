-- Per-page text for stored circular and notification PDFs, so a reader can search inside one and land on the
-- right page rather than the top of a 200-page file.
--
-- The text itself lives in object storage, not here. There are 7,338 stored PDFs totalling 89,280 pages, which
-- is roughly 270 MB -- against a 500 MB database already two thirds spoken for, that is the difference between
-- comfortable and refusing writes. R2 holds 10 GB and is barely a third used. This column only records where
-- each attachment's page file was written, so the work is resumable and never repeated.
--
-- Note for anyone editing this file: psycopg parses a per-cent sign as a parameter placeholder even when no
-- parameters are passed, so a stray one in a comment fails the migration. Spell the word instead.
ALTER TABLE attachment ADD COLUMN IF NOT EXISTS page_index_key TEXT;

-- Finding the next batch to index is the query this job runs constantly; without it every pass is a seq scan
-- over every attachment ever stored.
CREATE INDEX IF NOT EXISTS attachment_page_index_pending_idx
  ON attachment (id)
  WHERE storage_key IS NOT NULL AND page_index_key IS NULL;
