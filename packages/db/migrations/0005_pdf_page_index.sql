-- A searchable index of the regulator's own PDF, page by page.
--
-- Some official texts (SEBI's consolidated Regulations, most gazette copies) are published only as PDFs whose
-- layout interleaves body text with per-page footnotes. Splitting those into sections by parsing produced text
-- filed under the wrong regulation, which is worse than useless on a site people cite from. Indexing the pages
-- instead lets a search land the reader on the right page of the actual document, with nothing invented.

CREATE TABLE IF NOT EXISTS instrument_page (
  id             SERIAL PRIMARY KEY,
  instrument_id  INT NOT NULL REFERENCES instrument(id) ON DELETE CASCADE,
  page_no        INT NOT NULL,                 -- 1-based, matches the PDF viewer's #page=N
  text           TEXT NOT NULL,
  storage_key    TEXT,                         -- the stored PDF this page belongs to
  UNIQUE (instrument_id, page_no)
);

CREATE INDEX IF NOT EXISTS instrument_page_fts_idx
  ON instrument_page USING GIN (to_tsvector('english', text));

-- True when the instrument is presented as its official PDF rather than as parsed provisions.
ALTER TABLE instrument ADD COLUMN IF NOT EXISTS pdf_only BOOLEAN NOT NULL DEFAULT false;
