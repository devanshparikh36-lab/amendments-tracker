-- What gets read, counted and nothing more.
--
-- The shape is the decision here, and it is the same one `search_log` made: record the thing that is
-- useful and refuse to record the thing that is only tempting.
--
-- One row per path per day, incremented. Not one row per view. A row per view would be the obvious design
-- and it buys a single extra capability -- ordering views within a day -- in exchange for tens of
-- thousands of rows a month against a 0.5 GB allowance, a write amplification on a database that suspends
-- itself when idle, and a log that is one `session_id` column away from being a record of what an
-- identifiable person read. Aggregation at write time means the detailed version never exists to be
-- misused, subpoenaed or leaked.
--
-- So this table cannot answer: who visited, how many distinct people visited, what order one person read
-- things in, where they came from, or what they did next. Those are not limitations to be worked around
-- later; they are the design. Visitor counts in particular need a cookie or a fingerprint, and the site
-- sets neither -- which is what lets it carry no consent banner.
--
-- `path` is normalised before it arrives (see /api/beacon): collapsed to a route pattern, query string
-- discarded. The query string matters most: `/find?q=section+68+cash+credits+<client>` is a plausible URL
-- on this site, and storing paths verbatim would reintroduce through the back door exactly the disclosure
-- `search_log` was shaped to avoid.
CREATE TABLE IF NOT EXISTS page_view_day (
  day     DATE NOT NULL DEFAULT CURRENT_DATE,
  -- A route pattern, not a URL: '/browse/[slug]/text', '/documents/[id]', '/'. Bounded by the number of
  -- routes the app has, so this table grows with the calendar and never with traffic.
  path    TEXT NOT NULL,
  -- The instrument slug, when the path has one. The one piece of detail worth keeping: "which Acts are
  -- actually read" is the question this table exists to answer, and the pattern alone cannot.
  slug    TEXT,
  views   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, slug)
);

-- PRIMARY KEY columns are NOT NULL, so a path with no instrument would be rejected outright. The empty
-- string is the "no slug" value and the upsert writes it; nothing else may.
ALTER TABLE page_view_day ALTER COLUMN slug SET DEFAULT '';

-- "What was read lately", which is every question asked of this table.
CREATE INDEX IF NOT EXISTS page_view_day_day_idx ON page_view_day (day DESC);

COMMENT ON TABLE page_view_day IS
  'Page views, aggregated per route per day. No visitor, session, address or query string is recorded.';
