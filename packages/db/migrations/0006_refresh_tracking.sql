-- When did we last re-read the regulator's own text for this instrument?
--
-- Some regulators republish as a new document (RBI reissues a Master Direction, SEBI mints a new "last amended
-- on" PDF), and discovery notices those. Others edit their consolidated text in place behind an API - the Income
-- Tax department, CBIC, MCA - so nothing new appears to discover, and an edit would go unnoticed. Tracking the
-- last check lets the scheduled run re-read the oldest ones every time, so in-place edits are picked up too.

ALTER TABLE instrument ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

-- Instruments already seeded count as checked when they were seeded.
UPDATE instrument SET last_checked_at = seeded_at WHERE last_checked_at IS NULL AND seeded_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS instrument_last_checked_idx ON instrument(last_checked_at NULLS FIRST);
