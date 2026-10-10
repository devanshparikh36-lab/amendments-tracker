-- Somewhere to record that a regulator publishes nothing for an instrument, as a fact rather than a failure.
--
-- Three of SEBI's master circulars have a page that is a title and a date and nothing else. Measured:
--
--   Master Circular for Stock Exchanges - 2014                184 to 271 characters of text
--   Master Circular for Stock Exchange and Clearing Corp.     0 attachments of any kind
--   Master Circular for Stock Exchanges (Cash Market)
--
-- No text, no PDF, no link to one. There is nothing to collect and there never will be unless SEBI uploads
-- the document. But the self-check treated that like any other failure: three attempts, a `failed` row, and
-- a red workflow -- every day, for ever. On 10 October those three instruments accounted for 88 of the 160
-- failed self-check rows, which is most of a backlog that looks alarming and contains nothing actionable.
--
-- An alarm that cannot be cleared is an alarm that gets ignored, and then the real one is ignored with it.
-- So this separates "we could not read it" from "there is nothing there to read": the second is recorded
-- here, stops being retried, and is reported on /status as a known gap with the date it was last confirmed.
--
-- Null means nothing has been determined, which is the normal state for the 188 instruments that are fine.
-- Deliberately a free-text state rather than a boolean: "no_text_at_source" is the only value today, and
-- the next one will not be its opposite.
ALTER TABLE instrument ADD COLUMN IF NOT EXISTS source_state TEXT;
ALTER TABLE instrument ADD COLUMN IF NOT EXISTS source_state_at TIMESTAMPTZ;

COMMENT ON COLUMN instrument.source_state IS
  'A known, non-transient condition of the regulator''s source: currently only ''no_text_at_source''. Null means nothing determined.';
