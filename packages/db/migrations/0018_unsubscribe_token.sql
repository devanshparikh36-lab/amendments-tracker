-- A stable per-reader token, so a digest can carry a working unsubscribe link.
--
-- Required, not a nicety. RFC 8058 one-click unsubscribe needs a URL the mail client can POST to without
-- the reader signing in anywhere, and Gmail and Outlook both surface an unsubscribe control of their own
-- when those headers are present -- which is the difference between a reader removing themselves in one
-- press and a reader reporting the mail as spam. The second costs the sending account its reputation, and
-- this account sends the operator's own digest too.
--
-- Why a column rather than a signed token.
--
-- The alternative was an HMAC of the address: stateless, no migration. It needs the same secret in two
-- places, because the link is minted by the Python pipeline and verified by the Next app, which read their
-- configuration from GitHub Secrets and Netlify respectively. That is a third secret to set up and keep in
-- step, and a mismatch would break every unsubscribe link silently. A column is read by both from the one
-- place they already agree on.
--
-- Distinct from confirm_token, deliberately. That one is single-use and expires in 48 hours, because its
-- job is to prove an address was reachable once. This one has to keep working for as long as the reader
-- keeps receiving mail -- a link in a digest from four months ago must still unsubscribe them, or the
-- header is a promise the site breaks.
--
-- Set when an address is confirmed, which is the only moment a reader can begin receiving anything. Null
-- for everyone else, and nothing reads it for them.

ALTER TABLE reader ADD COLUMN IF NOT EXISTS unsub_token TEXT;

-- Unique where present. A partial index rather than a plain UNIQUE constraint: every unconfirmed reader
-- has null here, and Postgres would permit many nulls under UNIQUE anyway -- but stating the predicate
-- keeps the index to the rows that have a value, which is the set being looked up.
CREATE UNIQUE INDEX IF NOT EXISTS reader_unsub_token_idx ON reader (unsub_token) WHERE unsub_token IS NOT NULL;

COMMENT ON COLUMN reader.unsub_token IS
  'Stable secret in this reader''s unsubscribe link. Set when the address is confirmed and never rotated: '
  'a link in an old digest must still work. Unlike confirm_token it is neither single-use nor expiring.';
