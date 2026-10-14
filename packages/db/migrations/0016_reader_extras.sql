-- Bookmarks, notes, saved searches, and how often a reader wants to hear from us.
--
-- Everything here hangs off `reader`, which is identified by an unverified email address -- a name badge,
-- not a lock (see 0015). That constraint is why the shape of each table below matters more than usual.

-- ---------------------------------------------------------------------------------------------------
-- Bookmarks, as a second kind of watch rather than a second table.
--
-- A bookmark and a follow are the same row with a different intent: both point at one provision or one
-- instrument, both belong to one reader, both are created and deleted the same way. A separate table
-- would have duplicated the CHECK, both partial unique indexes, both lookup indexes and the whole of the
-- API route, to hold a column's worth of difference.
--
-- 'follow'   tell me when something lands against this
-- 'bookmark' keep this where I can find it again
--
-- They are deliberately independent: following a section does not bookmark it, and a reader who wants
-- both gets two rows. Conflating them would mean unfollowing something silently threw away a bookmark.
ALTER TABLE reader_watch ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'follow';

ALTER TABLE reader_watch DROP CONSTRAINT IF EXISTS reader_watch_kind_known;
ALTER TABLE reader_watch ADD CONSTRAINT reader_watch_kind_known CHECK (kind IN ('follow', 'bookmark'));

-- The uniqueness that mattered before was "one row per reader per target". It is now "one row per reader
-- per target per kind", so the old indexes would reject a bookmark on something already followed.
DROP INDEX IF EXISTS reader_watch_instrument_idx;
DROP INDEX IF EXISTS reader_watch_provision_idx;
CREATE UNIQUE INDEX IF NOT EXISTS reader_watch_instrument_kind_idx
  ON reader_watch (reader_id, instrument_id, kind) WHERE instrument_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reader_watch_provision_kind_idx
  ON reader_watch (reader_id, provision_id, kind) WHERE provision_id IS NOT NULL;

-- Alerts go out against follows only, and that query asks for one kind at a time.
CREATE INDEX IF NOT EXISTS reader_watch_kind_idx ON reader_watch (kind);


-- ---------------------------------------------------------------------------------------------------
-- How often a reader wants to be told.
--
-- 'daily' matches the collector: it runs once each morning, so anything more frequent would be a promise
-- the pipeline cannot keep. 'weekly' exists because one practitioner's "tell me" is another's "stop
-- shouting", and a digest nobody opens is worse than no digest.
ALTER TABLE reader ADD COLUMN IF NOT EXISTS alert_freq TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE reader DROP CONSTRAINT IF EXISTS reader_alert_freq_known;
ALTER TABLE reader ADD CONSTRAINT reader_alert_freq_known CHECK (alert_freq IN ('daily', 'weekly'));
-- When the last alert actually went out, so a weekly reader is not mailed daily.
ALTER TABLE reader ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMPTZ;


-- ---------------------------------------------------------------------------------------------------
-- A reader's own note against a provision.
--
-- **This is the one table on the site whose contents a stranger could plausibly want.** Everything else a
-- reader stores is a pointer at public law -- which sections interest them -- and the worst a leak does is
-- reveal an interest. A note is the reader's own words, and the identity protecting it is an email address
-- anyone can type.
--
-- That is not solvable at this layer: it needs real sign-in. So two things stand in for it until then.
-- The interface says so plainly where the note is written, rather than in a policy nobody reads. And the
-- length is capped hard: 2,000 characters is a reminder to oneself, not a file note, and a cap is the
-- bluntest honest way of saying what this is for.
CREATE TABLE IF NOT EXISTS reader_note (
  reader_id    INTEGER NOT NULL REFERENCES reader(id) ON DELETE CASCADE,
  provision_id INTEGER NOT NULL REFERENCES provision(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reader_id, provision_id),
  CONSTRAINT reader_note_length CHECK (char_length(body) <= 2000)
);

COMMENT ON TABLE reader_note IS
  'A reader''s own words against a provision. Protected only by an unverified email address -- the one '
  'table here whose contents a stranger might want. Needs real sign-in before it holds anything more.';


-- ---------------------------------------------------------------------------------------------------
-- Saved searches.
--
-- The query text, which `search_log` deliberately refuses to keep. The difference is consent and
-- ownership: search_log records what everyone typed, so it keeps outcomes and drops the words; this holds
-- what one reader asked to keep, at their request, visible to them, deleted when they say so.
--
-- Capped per reader by the application rather than here, because the right response to the fiftieth saved
-- search is to drop the oldest, not to return an error.
CREATE TABLE IF NOT EXISTS reader_search (
  id         SERIAL PRIMARY KEY,
  reader_id  INTEGER NOT NULL REFERENCES reader(id) ON DELETE CASCADE,
  q          TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reader_search_length CHECK (char_length(q) BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS reader_search_unique_idx ON reader_search (reader_id, lower(q));
CREATE INDEX IF NOT EXISTS reader_search_reader_idx ON reader_search (reader_id, created_at DESC);
