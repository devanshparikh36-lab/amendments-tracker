-- Daily is the only alert frequency, and record who put each address on the list.
--
-- Two changes, both in service of the same thing: a mailing list that can be reasoned about before it is
-- ever used to send anything.
--
--
-- 1. Weekly goes.
--
-- It was offered because a digest nobody opens is worse than no digest, which is still true -- but it was
-- never sent, so nothing is being taken away from anybody, and a second cadence doubles the state the
-- sender has to reason about (which window, which watermark, which reader is due today) before the first
-- cadence has delivered a single message.
--
-- The column stays rather than being dropped. It is cheap, the export reads it, and re-admitting weekly
-- later is then this file in reverse rather than a schema change under pressure. The CHECK is what enforces
-- the decision: with only 'daily' permitted, no code path can write a value the sender does not handle.
--
--
-- 2. `source` arrives, and it is not bookkeeping.
--
-- An address on this list got there one of two ways: somebody typed it into the site themselves, or an
-- administrator added it. Those are different facts about consent and must not be stored as the same row.
--
-- The site's own opt-in is a tick by whoever was holding the browser. That is weak evidence -- the address
-- is never verified, so it may not even belong to them -- but it is evidence, and it is the reader's own
-- action. An address added from the admin console carries no evidence of consent at all: nobody asked that
-- person anything.
--
-- Under the DPDP Act those two cannot be mailed on the same basis, so the database has to be able to tell
-- them apart. Without this column the distinction exists only in whoever remembers typing an address in,
-- which is to say it does not exist.
--
-- 'self' is the default deliberately: existing rows all came from the site, and a new row that forgets to
-- say where it came from should claim less, not more.

UPDATE reader SET alert_freq = 'daily' WHERE alert_freq <> 'daily';

ALTER TABLE reader DROP CONSTRAINT IF EXISTS reader_alert_freq_known;
ALTER TABLE reader ADD CONSTRAINT reader_alert_freq_known CHECK (alert_freq IN ('daily'));

ALTER TABLE reader ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'self';
ALTER TABLE reader DROP CONSTRAINT IF EXISTS reader_source_known;
ALTER TABLE reader ADD CONSTRAINT reader_source_known CHECK (source IN ('self', 'admin'));

COMMENT ON COLUMN reader.source IS
  'How this address reached the list: ''self'' means somebody entered it on the site, ''admin'' means it '
  'was added from the admin console and carries no evidence of consent from its owner. Mailing the two on '
  'the same basis is the mistake this column exists to prevent.';

COMMENT ON COLUMN reader.alert_freq IS
  'Always ''daily'' -- see 0017. Kept rather than dropped so that re-admitting a second cadence is a '
  'migration and not a schema redesign.';
