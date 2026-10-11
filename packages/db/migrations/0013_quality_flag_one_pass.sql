-- The same flags as 0011, computed in one pass instead of one pass per provision.
--
-- 0011 was correct and unusably slow: 67 seconds for a full scan, 49 for the query /quality runs. The page
-- it backs went live and returned 502 "Inactivity Timeout", because no serverless function waits that long.
-- Correctness was checked and speed was not, which is the whole lesson -- a view that returns the right
-- answer after a minute is a broken page.
--
-- The cost was all in one check. `duplicate_text` asked, for each of 5,120 provisions, whether any *other*
-- provision of the same instrument held identical text -- a correlated subquery that re-scanned the
-- instrument and re-hashed every text it found, once per row. Quadratic, over md5 of full statutory texts.
--
-- A window function answers the same question in a single pass: partition the current texts by instrument
-- and hash, and a partition with more than one row is a duplicate. Everything else was always cheap and is
-- unchanged, so the flags and their wording are identical to 0011 -- this is the same view, computed
-- sensibly.
CREATE OR REPLACE VIEW provision_quality_flag AS
WITH current_text AS (
  SELECT
    p.id            AS provision_id,
    p.instrument_id,
    p.number,
    p.heading,
    btrim(pv.text)  AS text,
    -- The whole fix. Counted over the partition rather than looked up per row.
    count(*) OVER (PARTITION BY p.instrument_id, md5(pv.text)) > 1 AS is_duplicate
  FROM provision p
  JOIN provision_version pv ON pv.provision_id = p.id AND pv.effective_to IS NULL
  WHERE p.level <> 'chapter'
    AND pv.text IS NOT NULL
    -- A provision the regulator has deleted really does read "2.1 [Deleted]" or "10. Omitted", and that is
    -- the correct text for it, not a parse that lost the body. Filtered here rather than at the end so the
    -- window function never sees them either.
    AND btrim(pv.text) !~* '\[?\s*(deleted|omitted|blank|repealed|reserved|\*{3,})\s*\]?\s*$'
)
SELECT
  c.provision_id,
  c.instrument_id,
  i.slug AS instrument_slug,
  c.number,
  c.heading,
  f.flag,
  f.detail,
  left(regexp_replace(c.text, '\s+', ' ', 'g'), 160) AS sample
FROM current_text c
JOIN instrument i ON i.id = c.instrument_id
CROSS JOIN LATERAL (
  VALUES
    ('table_row',
     'The text is pipe-separated and short, which is how a row of a schedule or tariff table looks once parsed.',
     c.text LIKE '%|%' AND length(c.text) < 200),

    ('heading_only',
     'Short, with no clause punctuation: the provision''s heading appears to have been captured without its text.',
     length(c.text) < 90 AND c.text NOT LIKE '%|%' AND c.text !~ '[,;:]'),

    ('footnote',
     'Begins like an amendment footnote ("Ins. by...", "Subs. by...") rather than like a provision.',
     c.text ~* '^\s*(\d+[A-Za-z]?\.?\s*)?(Ins\.|Inserted by|Subs\.|Substituted by|Omitted by|Vide|Prior to its)\b'),

    ('duplicate_text',
     'Identical to the text held under another number of the same instrument.',
     c.is_duplicate)
) AS f(flag, detail, hit)
WHERE f.hit;

COMMENT ON VIEW provision_quality_flag IS
  'Provisions whose stored text does not look like a provision. One definition, read by cli.py quality and by /quality.';
