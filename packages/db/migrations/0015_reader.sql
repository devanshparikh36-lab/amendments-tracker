-- Readers, and the provisions they follow.
--
-- This is the first table on this site that holds a person. Everything before it was deliberately shaped
-- so that it could not -- page views aggregated at write time, search wording erased after ninety days,
-- no cookie, no identifier. That changes here, knowingly, and the privacy notice changes with it.
--
-- What identity means here, precisely: a reader types an email address and the browser remembers it. There
-- is no password, no magic link and no session. **It is a name badge, not a lock.** Anyone can type anyone
-- else's address, and the only thing behind it is a list of sections somebody finds interesting -- which is
-- why that trade is acceptable here and would not be if anything private or paid sat behind it.
--
-- The consequence to keep in mind when adding to this schema: nothing stored against a reader may be
-- anything they would mind a stranger reading. If that stops being true, this design has to be replaced
-- rather than extended.
CREATE TABLE IF NOT EXISTS reader (
  id            SERIAL PRIMARY KEY,
  -- Lowercased and trimmed before it arrives. Unique so that typing the same address on a second device
  -- finds the same watchlist -- which is the whole reason the data lives here rather than in the browser.
  email         TEXT NOT NULL UNIQUE,
  -- Shown as "Hi, <name>". Optional: an address alone is enough to identify a row, and demanding a name
  -- before the site will do anything is the kind of friction that stops people trying it at all.
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Powers "since you were last here", which is the one feature that makes a reader come back. Updated on
  -- arrival, and read *before* it is updated -- see the identify route, where the order matters.
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Whether this reader wants mail when something lands against a provision they follow.
  alerts_on     BOOLEAN NOT NULL DEFAULT FALSE,
  -- When they confirmed, by clicking a link, that the address is theirs.
  --
  -- Signing in needs no confirmation -- claiming to be someone costs nothing and gains nothing. *Receiving
  -- mail* is different: without this column anyone could type a stranger's address, switch alerts on, and
  -- have this site mail them daily on their behalf. That is a spam cannon with our sending reputation
  -- attached. So: nothing is ever sent to an address where this is NULL.
  --
  -- One confirmation per address for ever, not one per sign-in, which is what keeps delivery off the
  -- critical path of simply using the site.
  alerts_ok_at  TIMESTAMPTZ,
  -- Single-use, short-lived, and cleared the moment it is spent.
  confirm_token TEXT,
  confirm_sent_at TIMESTAMPTZ
);

COMMENT ON TABLE reader IS
  'A reader identified by an unverified email address. No password, no session. Nothing may be stored '
  'against a reader that they would mind a stranger reading.';

-- Case-insensitive lookup without the citext extension, which Neon has but which is one more thing to
-- depend on. The application lowercases before writing; this makes the uniqueness hold regardless.
CREATE UNIQUE INDEX IF NOT EXISTS reader_email_lower_idx ON reader (lower(email));


-- What a reader follows. Either a whole instrument ("tell me about anything in the CGST Rules") or one
-- provision ("just section 68"), never both in one row.
CREATE TABLE IF NOT EXISTS reader_watch (
  reader_id     INTEGER NOT NULL REFERENCES reader(id) ON DELETE CASCADE,
  instrument_id INTEGER REFERENCES instrument(id) ON DELETE CASCADE,
  provision_id  INTEGER REFERENCES provision(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exactly one target. A row with both would be ambiguous about what it means to unfollow, and a row with
  -- neither is a watch on nothing.
  CONSTRAINT reader_watch_one_target CHECK (
    (instrument_id IS NOT NULL AND provision_id IS NULL)
    OR (instrument_id IS NULL AND provision_id IS NOT NULL)
  )
);

-- Following the same thing twice is the same as following it once. Two partial indexes rather than one
-- over both columns, because NULLs do not collide in a unique index and the duplicates would get through.
CREATE UNIQUE INDEX IF NOT EXISTS reader_watch_instrument_idx
  ON reader_watch (reader_id, instrument_id) WHERE instrument_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reader_watch_provision_idx
  ON reader_watch (reader_id, provision_id) WHERE provision_id IS NOT NULL;

-- "Who is watching this?", asked once per document when alerts are sent.
CREATE INDEX IF NOT EXISTS reader_watch_instrument_lookup ON reader_watch (instrument_id) WHERE instrument_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reader_watch_provision_lookup ON reader_watch (provision_id) WHERE provision_id IS NOT NULL;

COMMENT ON TABLE reader_watch IS
  'Instruments and provisions a reader follows. Exactly one target per row.';
