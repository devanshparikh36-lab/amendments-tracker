-- What people look for, and in particular what they look for and do not find.
--
-- A search that returns nothing is the most useful signal this site produces about itself. Every other
-- measure of coverage is ours -- 195 instruments, 5,120 provisions, 8,030 documents -- and none of them
-- says whether the library holds what the people using it actually need. A list of queries that came back
-- empty is a content roadmap written by its readers.
--
-- The privacy decision is deliberate and is the reason this table has the shape it does.
--
-- This is a tax and corporate practice, and a search can name a live matter: "section 68 cash credits
-- <client name>" is a plausible query and not something to keep in a log for ever. So the *outcome* of
-- every search is recorded -- how many of each kind of result, whether anything was found, the scope, the
-- time -- and the *text* only when the search found nothing. A query that succeeded has already told us
-- what we needed (the library answered it); its wording buys nothing and carries a cost.
--
-- Nothing identifying either way: no address, no user agent, no session. Volume and hit rate come from the
-- rows, and "who searched" is a question this table is deliberately unable to answer.
CREATE TABLE IF NOT EXISTS search_log (
  id            BIGSERIAL PRIMARY KEY,
  -- Null whenever `found` is true. See above: kept only for the searches that failed.
  query         TEXT,
  -- Normalised form of the same, for grouping "80C", "80c" and " 80C " together. Also null when found.
  query_key     TEXT,
  found         BOOLEAN NOT NULL,
  -- The slug a search was confined to, when it was run from inside one instrument.
  scope         TEXT,
  provisions    INTEGER NOT NULL DEFAULT 0,
  documents     INTEGER NOT NULL DEFAULT 0,
  pages         INTEGER NOT NULL DEFAULT 0,
  instruments   INTEGER NOT NULL DEFAULT 0,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The two questions asked of this table: "what is missing" (group the failures by query_key) and "how is it
-- doing lately" (count by day). Both want a recent window, hence `at` leading the second index.
CREATE INDEX IF NOT EXISTS search_log_missing_idx ON search_log (query_key, at DESC) WHERE found IS FALSE;
CREATE INDEX IF NOT EXISTS search_log_at_idx ON search_log (at DESC);

COMMENT ON TABLE search_log IS
  'Search outcomes. Query text retained only for searches that found nothing; nothing identifying is stored.';
