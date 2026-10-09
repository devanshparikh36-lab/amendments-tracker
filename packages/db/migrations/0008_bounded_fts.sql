-- Stop the full-text index refusing documents that are merely long.
--
-- Postgres caps a single tsvector at 1,048,575 bytes. `document_fts_idx` indexed the whole of
-- title || extracted_text, so any document whose text exceeded that cap could not be written at all:
--
--   string is too long for tsvector (1175666 bytes, max 1048575 bytes)
--
-- That is an INSERT-time failure, not a search-time one, so the document never lands. Six fetch_document
-- jobs died this way and stayed dead -- the job retries three times and gives up, and because the rest of
-- the run is green the collection looks healthy. The documents are the largest ones the regulators publish,
-- which is to say the consolidated texts most worth having.
--
-- Bounding the indexed expression is the fix, and the bound has to be generous enough never to be the
-- reason something is unfindable. 500,000 characters is roughly a 200-page PDF; the tsvector built from it
-- is a few hundred kilobytes, well inside the cap even for text that is mostly distinct lexemes. Ranking
-- already only reads the first 20,000 characters (lib/queries.ts), so this changes matching, not ordering.
--
-- IMPORTANT: the expression below must stay character-for-character identical to the WHERE clause in
-- `search()` in apps/web/src/lib/queries.ts. Postgres only uses an expression index when the query repeats
-- the expression exactly; a mismatch does not error, it silently sequential-scans every document row.

DROP INDEX IF EXISTS document_fts_idx;
CREATE INDEX IF NOT EXISTS document_fts_idx ON document
  USING GIN (to_tsvector('english', left(coalesce(title,'') || ' ' || coalesce(extracted_text,''), 500000)));

-- attachment_fts_idx is dropped outright rather than bounded, because nothing reads it.
--
-- Neither the site nor the pipeline searches attachment.extracted_text: the full-text search covers
-- `document` and `provision_version`, in-PDF search covers `instrument_page`, and the attachment panel that
-- once used this index was removed when compaction moved that text onto the document row (see the note in
-- apps/web/src/app/find/page.tsx). So it carried the same overflow risk as the index above while answering
-- no query -- and it is a GIN index over the OCR text of ~89,000 pages, in a database with a 500 MB ceiling
-- that is already two fifths spoken for. Dropping it reclaims that space.
--
-- If attachment text is ever searched again, add the index back with the same left(...) bound as above, and
-- write the query to match it exactly.
DROP INDEX IF EXISTS attachment_fts_idx;
