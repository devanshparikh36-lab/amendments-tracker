-- Provisions whose stored text does not look like a provision.
--
-- The argument for this is one incident. The FEMA Act was seeded from India Code's text bundle, reported as
-- a success on the strength of "parses into 150 provisions", and published. Section 3 held a footnote about
-- section 18; other sections held lines from the arrangement-of-sections list. Nothing in the pipeline
-- looked at what was in a provision, only at how many there were -- so a count was checked where content
-- should have been, and 150 wrong provisions reached the live database.
--
-- A view rather than a table, and rather than two copies of the predicates. The CLI (`cli.py quality`) and
-- the site both need these flags, and the one thing worse than no quality check is two that disagree about
-- what a defect is. Computed on read, so it is never stale and there is nothing to refresh.
--
-- Calibrated against the 5,120 provisions currently holding text, not invented: 271 rows, about five in a
-- hundred, concentrated in a handful of instruments. Each check below earns its place by what it found.
CREATE OR REPLACE VIEW provision_quality_flag AS
SELECT
  p.id            AS provision_id,
  p.instrument_id,
  i.slug          AS instrument_slug,
  p.number,
  p.heading,
  f.flag,
  f.detail,
  left(regexp_replace(btrim(pv.text), '\s+', ' ', 'g'), 160) AS sample
FROM provision p
JOIN instrument i ON i.id = p.instrument_id
JOIN provision_version pv ON pv.provision_id = p.id AND pv.effective_to IS NULL
CROSS JOIN LATERAL (
  VALUES
    -- A row of a table, not a provision. The parsers render table cells pipe-separated, so the pipe is the
    -- tell: "1. | 2106 90 20 | Pan masala" is a line of the GST tariff schedule that became provision 1(6)
    -- of the CGST Rules, and "2. | Pharmaceutical Sector" is a line of a FEM sector schedule. 78 rows.
    ('table_row',
     'The text is pipe-separated and short, which is how a row of a schedule or tariff table looks once parsed.',
     pv.text LIKE '%|%' AND length(btrim(pv.text)) < 200),

    -- A heading with no provision under it. "278. Effect of winding up order." is the whole of what is held
    -- for that section of the Companies Act: MCA's e-Book lists it and the body never arrived. Bounded by
    -- length and by the absence of any clause punctuation, because a real provision of under ninety
    -- characters with no comma, semicolon or colon in it is vanishingly rare. 162 rows.
    ('heading_only',
     'Short, with no clause punctuation: the provision''s heading appears to have been captured without its text.',
     length(btrim(pv.text)) < 90 AND pv.text NOT LIKE '%|%' AND pv.text !~ '[,;:]'),

    -- The FEMA failure itself, kept as a regression guard. Finds nothing today, which is the point: those
    -- 150 provisions were deleted, and if a splitter ever reads page footnotes as sections again this is
    -- what says so on the next run rather than after someone reads the Act.
    ('footnote',
     'Begins like an amendment footnote ("Ins. by...", "Subs. by...") rather than like a provision.',
     pv.text ~* '^\s*(\d+[A-Za-z]?\.?\s*)?(Ins\.|Inserted by|Subs\.|Substituted by|Omitted by|Vide|Prior to its)\b'),

    -- The same words held under two numbers of one instrument. Always a parse that split something that was
    -- not a provision: the RBI office list in the overseas-investment Master Direction became provisions 1
    -- and 2 of Part II, holding "1. | AH | RO Ahmedabad" and "2. | BG | RO Bengaluru". 31 rows.
    ('duplicate_text',
     'Identical to the text held under another number of the same instrument.',
     EXISTS (
       SELECT 1 FROM provision_version o
         JOIN provision op ON op.id = o.provision_id
        WHERE op.instrument_id = p.instrument_id AND op.id <> p.id
          AND o.effective_to IS NULL AND md5(o.text) = md5(pv.text)
     ))
) AS f(flag, detail, hit)
WHERE p.level <> 'chapter'
  AND pv.text IS NOT NULL
  AND f.hit
  -- A provision the regulator has deleted really does read "2.1 [Deleted]" or "10. Omitted", and that is
  -- the correct text for it, not a parse that lost the body. Nine of the first 162 heading_only flags were
  -- these, and leaving them in would have made a fifth of that check's output wrong on day one -- which is
  -- how a review list stops being read.
  AND btrim(pv.text) !~* '\[?\s*(deleted|omitted|blank|repealed|reserved|\*{3,})\s*\]?\s*$';

COMMENT ON VIEW provision_quality_flag IS
  'Provisions whose stored text does not look like a provision. One definition, read by cli.py quality and by /quality.';
