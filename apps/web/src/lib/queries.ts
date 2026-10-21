import { LIVE_SECONDS, query } from "@/db";

export type DocumentRow = {
  id: number;
  title: string;
  number: string | null;
  doc_type: string;
  date_issued: string | null;
  date_effective: string | null;
  source_url: string;
  /** The page a reader should open, when the seeder's URL is not one. Null for most regulators. */
  reader_url?: string | null;
  source_adapter: string;
  regulator_code: string;
  is_amending: boolean | null;
  tag_status: string;
  first_seen_at: string;
  extracted_text?: string | null;
  affects?: string | null;
} & OfficialFile;

export type InstrumentRow = {
  id: number;
  slug: string;
  short_code: string;
  title: string;
  kind: string;
  official_url: string | null;
  official_updated_as_on: string | null;
  seeded_at: string | null;
  regulator_code: string;
  provision_count: number;
  machine_count: number;
  doc_count: number;
  pdf_storage_key: string | null;
  pdf_source_url: string | null;
  pdf_page_count: number | null;
  // True when the regulator publishes this instrument only as a PDF: we serve that file and index its
  // pages, rather than inventing a section split the official document does not have.
  pdf_only: boolean;
  page_count: number;
};

export type ProvisionRow = {
  id: number;
  number: string;
  heading: string | null;
  level: string;
  parent_id: number | null;
  sort_key: number;
  version_id: number | null;
  text: string | null;
  source_kind: string | null;
  effective_from: string | null;
  footnote: string | null;
  merge_confidence: number | null;
  effect_count: number;
  differs: number;
  html?: string | null;
  pdf_storage_key?: string | null;
  pdf_page?: number | null;
  source_url?: string | null;
};

export async function listInstruments(): Promise<InstrumentRow[]> {
  return query<InstrumentRow>(`
    SELECT i.id, i.slug, i.short_code, i.title, i.kind, i.official_url, i.official_updated_as_on, i.seeded_at,
           i.pdf_storage_key, i.pdf_source_url, i.pdf_page_count, i.pdf_only,
           r.code AS regulator_code,
           (SELECT count(*) FROM instrument_page ip WHERE ip.instrument_id = i.id)::int AS page_count,
           (SELECT count(*) FROM provision p WHERE p.instrument_id = i.id)::int AS provision_count,
           (SELECT count(*) FROM provision p JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
              WHERE p.instrument_id = i.id AND v.source_kind = 'machine_merged')::int AS machine_count,
           (SELECT count(DISTINCT t.document_id) FROM document_tag t WHERE t.instrument_id = i.id)::int AS doc_count
    FROM instrument i JOIN regulator r ON r.id = i.regulator_id
    ORDER BY i.kind, i.title`);
}

export async function getInstrument(slug: string): Promise<InstrumentRow | null> {
  const rows = await query<InstrumentRow>(
    `SELECT i.*, r.code AS regulator_code, 0 AS provision_count, 0 AS machine_count, 0 AS doc_count,
            (SELECT count(*) FROM instrument_page ip WHERE ip.instrument_id = i.id)::int AS page_count
     FROM instrument i JOIN regulator r ON r.id = i.regulator_id WHERE i.slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function listProvisions(instrumentId: number, asOn?: string): Promise<ProvisionRow[]> {
  // Current version by default; with asOn, the version in force on that date (point-in-time view).
  const versionJoin = asOn
    ? `LEFT JOIN provision_version v ON v.provision_id = p.id
         AND (v.effective_from IS NULL OR v.effective_from <= $2::date)
         AND (v.effective_to IS NULL OR v.effective_to > $2::date)`
    : `LEFT JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL`;
  const params: unknown[] = asOn ? [instrumentId, asOn] : [instrumentId];
  return query<ProvisionRow>(
    `SELECT p.id, p.number, p.heading, p.level, p.parent_id, p.sort_key,
            p.pdf_storage_key, p.pdf_page, p.source_url,
            v.id AS version_id, v.text, v.html, v.source_kind, v.effective_from, v.footnote, v.merge_confidence,
            coalesce(ec.effect_count, 0) AS effect_count,
            coalesce(ec.differs, 0) AS differs
     FROM provision p ${versionJoin}
     -- Both counts in one grouped pass rather than two correlated subqueries per provision: reading the whole
     -- Income-tax Act meant 1,870 of them for numbers that come from a table of barely a thousand rows.
     LEFT JOIN (
       SELECT provision_id,
              count(*)::int AS effect_count,
              count(*) FILTER (WHERE verification_status = 'differs_from_official')::int AS differs
         FROM amendment_effect GROUP BY provision_id
     ) ec ON ec.provision_id = p.id
     WHERE p.instrument_id = $1
     ORDER BY p.sort_key, v.id DESC`,
    params,
  );
}

// Sidebar / contents list: numbers and headings only, so a 900-section Act renders instantly.
export type ProvisionIndexRow = {
  id: number;
  number: string;
  heading: string | null;
  level: string;
  parent_id: number | null;
  sort_key: number;
  machine: boolean;
  differs: number;
};

export async function listProvisionIndex(instrumentId: number): Promise<ProvisionIndexRow[]> {
  return query<ProvisionIndexRow>(
    // The discrepancy count is joined once and grouped, not asked per provision. As a correlated subquery it
    // ran 935 times for the Income-tax Act -- 360ms of the page -- to produce a column that is currently zero
    // everywhere, since nothing has populated verification_status yet. Grouped, the same answer costs 156ms.
    `SELECT p.id, p.number, p.heading, p.level, p.parent_id, p.sort_key,
            coalesce(v.source_kind = 'machine_merged', false) AS machine,
            coalesce(d.differs, 0) AS differs
     FROM provision p
     LEFT JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
     LEFT JOIN (
       SELECT provision_id, count(*)::int AS differs
         FROM amendment_effect WHERE verification_status = 'differs_from_official'
        GROUP BY provision_id
     ) d ON d.provision_id = p.id
     WHERE p.instrument_id = $1
     ORDER BY p.sort_key, p.id`,
    [instrumentId],
  );
}

// One provision with everything needed to lead with the official source.
export async function getProvision(instrumentId: number, number: string, asOn?: string): Promise<ProvisionRow | null> {
  const versionJoin = asOn
    ? `LEFT JOIN provision_version v ON v.provision_id = p.id
         AND (v.effective_from IS NULL OR v.effective_from <= $3::date)
         AND (v.effective_to IS NULL OR v.effective_to > $3::date)`
    : `LEFT JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL`;
  const params: unknown[] = asOn ? [instrumentId, number, asOn] : [instrumentId, number];
  const rows = await query<ProvisionRow>(
    `SELECT p.id, p.number, p.heading, p.level, p.parent_id, p.sort_key,
            p.pdf_storage_key, p.pdf_page, p.source_url,
            v.id AS version_id, v.text, v.html, v.source_kind, v.effective_from, v.footnote, v.merge_confidence,
            (SELECT count(*) FROM amendment_effect e WHERE e.provision_id = p.id)::int AS effect_count,
            (SELECT count(*) FROM amendment_effect e WHERE e.provision_id = p.id AND e.verification_status = 'differs_from_official')::int AS differs
     FROM provision p ${versionJoin}
     WHERE p.instrument_id = $1 AND (p.number = $2 OR upper(p.number) = upper($2))
     ORDER BY v.id DESC LIMIT 1`,
    params,
  );
  return rows[0] ?? null;
}

/** Every dated text held for one provision, oldest first.
 *
 * Point-in-time reading was reachable but not navigable: a bare date picker, and no way to know which dates
 * mean anything. Asking for 2019 returned "No text recorded for this date" -- true, and indistinguishable
 * from a bug, because nothing said that this archive begins when the tracker started watching rather than
 * when the provision was enacted.
 *
 * So the dates it actually holds are listed. For most provisions that is one entry, which is itself the
 * honest answer: 751 of 5,254 have more than one, and 4,049 of 6,014 versions are dated 2026 because that
 * is when each instrument was first read. The archive deepens forward and cannot be backfilled.
 */
export async function provisionVersionDates(provisionId: number) {
  return query<{ effective_from: string | null; effective_to: string | null; chars: number }>(
    `SELECT effective_from, effective_to, length(coalesce(text, ''))::int AS chars
       FROM provision_version
      WHERE provision_id = $1
      ORDER BY effective_from NULLS FIRST, id`,
    [provisionId],
  );
}

export type LookupProvision = {
  id: number;
  number: string;
  heading: string | null;
  level: string;
  instrument_slug: string;
  instrument_title: string;
  short_code: string;
  slug: string;
  title: string;
  kind: string;
  regulator_code: string;
  instrument_size: number;
  snippet: string | null;
};

// Exact provision-number match across every instrument (whitespace-insensitive: "2 (2)" == "2(2)").
// pdf_only instruments are left out on purpose: they are served as the regulator's own file, and any
// provision rows left behind for them are not what the reader is shown. Pages answer those queries instead.
export async function findProvisionsByNumber(number: string): Promise<LookupProvision[]> {
  return query<LookupProvision>(
    `SELECT p.id, p.number, p.heading, p.level,
            i.slug AS instrument_slug, i.title AS instrument_title, i.slug, i.title, i.short_code, i.kind,
            r.code AS regulator_code,
            (SELECT count(*) FROM provision x WHERE x.instrument_id = i.id)::int AS instrument_size,
            left(regexp_replace(coalesce(v.text, ''), '\\s+', ' ', 'g'), 220) AS snippet
     FROM provision p
     JOIN instrument i ON i.id = p.instrument_id
     JOIN regulator r ON r.id = i.regulator_id
     LEFT JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
     WHERE replace(upper(p.number), ' ', '') = replace(upper($1), ' ', '')
       AND p.level <> 'chapter'
       AND NOT i.pdf_only
     LIMIT 80`,
    [number],
  );
}

// ---------------------------------------------------------------------------
// The regulator's own PDF, page by page.
//
// SEBI's consolidated Regulations exist only as PDFs whose layout defeats a section parse, so the
// pipeline stores the official file and indexes each page. Search runs over that extracted page text —
// a finding aid — and every result opens the actual PDF at the page it was found on.

export type PageHit = { page_no: number; snippet: string; rank: number; heading_hit: boolean };

// Regex-safe stem of a provision number: "17(1)" -> "17", "12A" -> "12A". Only [0-9A-Za-z] survives,
// so the string can be interpolated into a POSIX regex without escaping.
export function headingStem(number: string | null | undefined): string | null {
  if (!number) return null;
  const m = number.trim().match(/^(\d{1,4}[A-Za-z]{0,4})/);
  return m ? m[1] : null;
}

// Search one instrument's PDF pages. A number ("regulation 17") is matched separately from the words,
// because a page carrying the heading "17. (1) ..." is the answer even when the words are elsewhere.
export async function searchInstrumentPages(
  instrumentId: number,
  q: string,
  opts: { number?: string | null; limit?: number } = {},
): Promise<PageHit[]> {
  const text = q.trim();
  const stem = headingStem(opts.number);
  if (!text && !stem) return [];
  const limit = Math.min(opts.limit ?? 20, 100);
  // '(^|[^0-9A-Za-z])17\.' — the number as a heading, not as part of a date, amount or cross-reference.
  // Non-capturing groups only: substring(text from pattern) returns the capture group when there is one.
  // "(?![0-9])" keeps "17.5.2024" in a footnote from posing as regulation 17.
  const headingRe = stem ? `(?:^|[^0-9A-Za-z])${stem}\\.(?![0-9])` : null;
  const openerRe = stem ? `(?:^|[^0-9A-Za-z])${stem}\\.[[:space:]]*[(A-Z]` : null;
  return query<PageHit>(
    `WITH q AS (SELECT websearch_to_tsquery('english', $2) AS tsq),
          hit AS (
            SELECT ip.page_no, ip.text,
                   to_tsvector('english', ip.text) @@ q.tsq AS words,
                   ts_rank(to_tsvector('english', ip.text), q.tsq) AS word_rank,
                   ($3::text IS NOT NULL AND ip.text ~ $3) AS heading,
                   ($4::text IS NOT NULL AND ip.text ~ $4) AS opener
            FROM instrument_page ip, q
            WHERE ip.instrument_id = $1
          )
     SELECT page_no,
            CASE WHEN words THEN ts_headline('english', text, (SELECT tsq FROM q),
                   'MaxFragments=2, MaxWords=26, MinWords=12, StartSel=<b>, StopSel=</b>')
                 ELSE '…' || replace(replace(replace(
                        coalesce(substring(text from '.{0,70}' || $3 || '.{0,220}'), left(text, 240)),
                        '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '…'
            END AS snippet,
            (CASE WHEN words THEN word_rank ELSE 0 END
             + CASE WHEN opener THEN 0.9 WHEN heading THEN 0.25 ELSE 0 END)::float8 AS rank,
            opener AS heading_hit
     FROM hit
     WHERE words OR heading
     -- A page that opens "17. (1) …" is the answer to "regulation 17". Where several pages do (the
     -- body, then a schedule repeating the number), the earliest is the numbered provision itself.
     ORDER BY opener DESC, CASE WHEN opener THEN page_no END ASC, rank DESC, page_no
     LIMIT $5`,
    [instrumentId, text, headingRe, openerRe, limit],
  );
}

export type PageSearchHit = PageHit & {
  instrument_slug: string;
  instrument_title: string;
  short_code: string;
  pdf_storage_key: string | null;
  pdf_source_url: string | null;
};

/** Phrase search across the pages of every instrument the regulator publishes only as a PDF.
 *
 * These are 107 of the 195 Acts, Rules and Regulations here -- more than half -- and until now their text
 * was only reachable if the query also named the instrument, because pages were searched for matched
 * instruments rather than for matched words. Someone searching a phrase got nothing from any of them, with
 * no indication that half the library had not been looked at.
 *
 * No bounding needed and none wanted: a page averages 2,023 characters and tops out at about 7,000, so
 * ranking the whole of one costs nothing, which is exactly what makes a page the right unit to search. It
 * is also the right unit to return, because the answer is "that document, at that page".
 */
export async function searchAllPages(q: string, limit = 12): Promise<PageSearchHit[]> {
  const text = q.trim();
  if (!text) return [];
  const tsq = `websearch_to_tsquery('english', $1)`;
  return query<PageSearchHit>(
    `SELECT ip.page_no, i.slug AS instrument_slug, i.title AS instrument_title, i.short_code,
            i.pdf_storage_key, i.pdf_source_url,
            ts_headline('english', ip.text, ${tsq},
                        'MaxFragments=1, MaxWords=26, MinWords=12, StartSel=<b>, StopSel=</b>') AS snippet,
            ts_rank(to_tsvector('english', ip.text), ${tsq})::float8 AS rank,
            false AS heading_hit
       FROM instrument_page ip JOIN instrument i ON i.id = ip.instrument_id
      WHERE to_tsvector('english', ip.text) @@ ${tsq}
      ORDER BY rank DESC, i.title, ip.page_no
      LIMIT $2`,
    [text, limit],
  );
}

export type LookupInstrument = InstrumentRow & { rank: number };

export async function findInstruments(words: string[]): Promise<LookupInstrument[]> {
  if (!words.length) return [];
  const rows = await query<InstrumentRow>(
    `SELECT i.id, i.slug, i.short_code, i.title, i.kind, i.official_url, i.official_updated_as_on, i.seeded_at,
            i.pdf_storage_key, i.pdf_source_url, i.pdf_page_count, i.pdf_only, r.code AS regulator_code,
            (SELECT count(*) FROM instrument_page ip WHERE ip.instrument_id = i.id)::int AS page_count,
            (SELECT count(*) FROM provision p WHERE p.instrument_id = i.id)::int AS provision_count,
            0 AS machine_count,
            (SELECT count(DISTINCT t.document_id) FROM document_tag t WHERE t.instrument_id = i.id)::int AS doc_count
     FROM instrument i JOIN regulator r ON r.id = i.regulator_id`,
  );
  return rows
    .map((i) => {
      const hay = `${i.slug} ${i.short_code} ${i.title}`.toLowerCase();
      const hits = words.filter((w) => hay.includes(w)).length;
      const hasText = i.provision_count > 0 || i.page_count > 0;
      return { ...i, rank: hits === words.length ? hits * 10 + (hasText ? 5 : 0) : hits };
    })
    .filter((i) => i.rank > 0)
    .sort((a, b) => b.rank - a.rank || b.provision_count + b.page_count - (a.provision_count + a.page_count))
    .slice(0, 20);
}

export type SubjectCount = {
  regulator_code: string;
  documents: number;
  last30: number;
  last90: number;
  amending: number;
  effects: number;
  latest: string | null;
};

// One row per regulator: how much there is, how much of it is recent, and how many changes to the
// consolidated text those documents produced. Feeds the bifurcated "what's new" on the home page.
export async function documentCountsByRegulator(): Promise<SubjectCount[]> {
  return query<SubjectCount>(
    `SELECT r.code AS regulator_code,
            count(d.id)::int AS documents,
            count(d.id) FILTER (WHERE d.date_issued >= current_date - INTERVAL '30 days')::int AS last30,
            count(d.id) FILTER (WHERE d.date_issued >= current_date - INTERVAL '90 days')::int AS last90,
            count(d.id) FILTER (WHERE d.is_amending)::int AS amending,
            max(d.date_issued)::text AS latest,
            (SELECT count(*) FROM amendment_effect e
               JOIN provision p ON p.id = e.provision_id
               JOIN instrument i ON i.id = p.instrument_id
             WHERE i.regulator_id = r.id)::int AS effects
     FROM regulator r LEFT JOIN document d ON d.regulator_id = r.id
     GROUP BY r.id, r.code`,
  );
}

export type FeedItem = {
  id: number;
  title: string;
  number: string | null;
  doc_type: string;
  date_issued: string | null;
  regulator_code: string;
  is_amending: boolean | null;
  affects: string | null;
  effects: number;
};

// The most recent documents for every regulator in one pass, so the home page can show each subject's
// own feed side by side instead of one mixed list.
export async function recentByRegulator(perRegulator = 6): Promise<FeedItem[]> {
  return query<FeedItem>(
    `WITH ranked AS (
       SELECT d.id, d.title, d.number, d.doc_type, d.date_issued, d.is_amending, r.code AS regulator_code,
              row_number() OVER (PARTITION BY r.code ORDER BY d.date_issued DESC NULLS LAST, d.id DESC) AS rn
       FROM document d JOIN regulator r ON r.id = d.regulator_id
     )
     SELECT k.id, k.title, k.number, k.doc_type, k.date_issued, k.is_amending, k.regulator_code,
            (SELECT string_agg(DISTINCT i.short_code, ', ') FROM document_tag t JOIN instrument i ON i.id = t.instrument_id
               WHERE t.document_id = k.id AND t.relation IN ('amends','supersedes')) AS affects,
            (SELECT count(*) FROM amendment_effect e WHERE e.document_id = k.id)::int AS effects
     FROM ranked k WHERE k.rn <= $1
     ORDER BY k.regulator_code, k.rn`,
    [perRegulator],
  );
}

// ---------------------------------------------------------------------------
// The per-instrument landing page: what this Act/Rules/Regulation is, and what has happened to it.

export type InstrumentOverview = {
  provisions: number;
  chapters: number;
  machine: number;
  official_html: number;
  effects: number;
  effects_differ: number;
  documents: number;
  amending_documents: number;
  latest_amendment: string | null;
  first_document: string | null;
  earliest_in_force: string | null;
};

export async function instrumentOverview(instrumentId: number): Promise<InstrumentOverview> {
  const [row] = await query<InstrumentOverview>(
    `SELECT
       (SELECT count(*) FROM provision p WHERE p.instrument_id = $1 AND p.level <> 'chapter')::int AS provisions,
       (SELECT count(*) FROM provision p WHERE p.instrument_id = $1 AND p.level = 'chapter')::int AS chapters,
       (SELECT count(*) FROM provision p JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
          WHERE p.instrument_id = $1 AND v.source_kind = 'machine_merged')::int AS machine,
       (SELECT count(*) FROM provision p JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
          WHERE p.instrument_id = $1 AND v.html IS NOT NULL AND v.html <> '')::int AS official_html,
       (SELECT count(*) FROM amendment_effect e JOIN provision p ON p.id = e.provision_id
          WHERE p.instrument_id = $1)::int AS effects,
       (SELECT count(*) FROM amendment_effect e JOIN provision p ON p.id = e.provision_id
          WHERE p.instrument_id = $1 AND e.verification_status = 'differs_from_official')::int AS effects_differ,
       (SELECT count(DISTINCT t.document_id) FROM document_tag t WHERE t.instrument_id = $1)::int AS documents,
       (SELECT count(DISTINCT t.document_id) FROM document_tag t
          WHERE t.instrument_id = $1 AND t.relation IN ('amends','supersedes'))::int AS amending_documents,
       (SELECT max(d.date_issued)::text FROM document_tag t JOIN document d ON d.id = t.document_id
          WHERE t.instrument_id = $1 AND t.relation IN ('amends','supersedes')) AS latest_amendment,
       (SELECT min(d.date_issued)::text FROM document_tag t JOIN document d ON d.id = t.document_id
          WHERE t.instrument_id = $1) AS first_document,
       (SELECT min(v.effective_from)::text FROM provision p JOIN provision_version v ON v.provision_id = p.id
          WHERE p.instrument_id = $1) AS earliest_in_force`,
    [instrumentId],
  );
  return row;
}

export type InstrumentAmendment = {
  id: number;
  title: string;
  number: string | null;
  doc_type: string;
  date_issued: string | null;
  relation: string;
  provisions: string | null;
  effects: number;
};

// Documents that changed this instrument, newest first, with the provisions each one touched.
export async function instrumentAmendments(instrumentId: number, limit = 8): Promise<InstrumentAmendment[]> {
  return query<InstrumentAmendment>(
    `SELECT d.id, d.title, d.number, d.doc_type, d.date_issued, min(t.relation) AS relation,
            (SELECT string_agg(DISTINCT p.number, ', ') FROM amendment_effect e JOIN provision p ON p.id = e.provision_id
               WHERE e.document_id = d.id AND p.instrument_id = $1) AS provisions,
            (SELECT count(*) FROM amendment_effect e JOIN provision p ON p.id = e.provision_id
               WHERE e.document_id = d.id AND p.instrument_id = $1)::int AS effects
     FROM document_tag t JOIN document d ON d.id = t.document_id
     WHERE t.instrument_id = $1 AND t.relation IN ('amends','supersedes')
     GROUP BY d.id
     ORDER BY d.date_issued DESC NULLS LAST, d.id DESC
     LIMIT $2`,
    [instrumentId, limit],
  );
}

export type ChapterRow = { id: number; number: string; heading: string | null; sort_key: number };

// Chapter headings only — the shape of the Act, for the landing page's contents card.
export async function instrumentChapters(instrumentId: number): Promise<ChapterRow[]> {
  return query<ChapterRow>(
    `SELECT id, number, heading, sort_key FROM provision
     WHERE instrument_id = $1 AND level = 'chapter' ORDER BY sort_key LIMIT 60`,
    [instrumentId],
  );
}

// The first handful of provisions, so the landing page can show what the numbering looks like.
export async function instrumentOpeningProvisions(instrumentId: number, limit = 12): Promise<ProvisionIndexRow[]> {
  return query<ProvisionIndexRow>(
    `SELECT p.id, p.number, p.heading, p.level, p.parent_id, p.sort_key,
            coalesce(v.source_kind = 'machine_merged', false) AS machine, 0 AS differs
     FROM provision p
     LEFT JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
     WHERE p.instrument_id = $1 AND p.level <> 'chapter'
     ORDER BY p.sort_key, p.id LIMIT $2`,
    [instrumentId, limit],
  );
}

// Everything the home page needs about instruments, in one grouped pass.
export async function instrumentIndex(): Promise<InstrumentRow[]> {
  return query<InstrumentRow>(
    `SELECT i.id, i.slug, i.short_code, i.title, i.kind, i.official_url, i.official_updated_as_on, i.seeded_at,
            i.pdf_storage_key, i.pdf_source_url, i.pdf_page_count, i.pdf_only, r.code AS regulator_code,
            coalesce(pc.n, 0)::int AS provision_count, 0 AS machine_count, coalesce(dc.n, 0)::int AS doc_count,
            coalesce(gc.n, 0)::int AS page_count
     FROM instrument i
     JOIN regulator r ON r.id = i.regulator_id
     LEFT JOIN (SELECT instrument_id, count(*) n FROM provision GROUP BY instrument_id) pc ON pc.instrument_id = i.id
     LEFT JOIN (SELECT instrument_id, count(*) n FROM instrument_page GROUP BY instrument_id) gc ON gc.instrument_id = i.id
     LEFT JOIN (SELECT instrument_id, count(DISTINCT document_id) n FROM document_tag GROUP BY instrument_id) dc ON dc.instrument_id = i.id
     ORDER BY provision_count DESC, i.title`,
  );
}

export type ProvisionDocument = {
  id: number; title: string; number: string | null; date_issued: string | null; change_type: string | null;
  verification_status: string | null; relation: string | null; source_url: string; doc_type: string;
  reader_url: string | null;
} & OfficialFile;

/** The stored official file for a document, so a notification number can link straight to the PDF it was
 * issued as rather than only to our page about it. */
export type OfficialFile = {
  pdf_storage_key?: string | null;
  pdf_source_url?: string | null;
  pdf_mime?: string | null;
};

/** Joins the one file worth linking to, for a query that already has `document d` in scope.
 *
 * Preference order matters. A notification often carries several attachments -- the PDF, a corrigendum, an
 * annexure spreadsheet -- and `is_primary` alone picks the wrong one often enough to notice, because the
 * collectors set it from the order the regulator listed files in. So prefer an actual PDF first and fall back
 * to primary, rather than trusting either on its own.
 *
 * Rows with no stored file yield nulls and the number renders as plain text: a link that 404s would be worse
 * than no link, and "not downloaded yet" is a real state here. */
const OFFICIAL_FILE_JOIN = `
     LEFT JOIN LATERAL (
       SELECT a.storage_key, a.source_url, a.mime
       FROM attachment a
       WHERE a.document_id = d.id AND a.storage_key IS NOT NULL
       ORDER BY (a.mime = 'application/pdf' OR a.filename ILIKE '%.pdf') DESC, a.is_primary DESC, a.id
       LIMIT 1
     ) af ON true`;

const OFFICIAL_FILE_COLS = `af.storage_key AS pdf_storage_key, af.source_url AS pdf_source_url, af.mime AS pdf_mime`;

export async function provisionDocuments(provisionId: number): Promise<ProvisionDocument[]> {
  return query<ProvisionDocument>(
    `SELECT DISTINCT d.id, d.title, d.number, d.date_issued, d.source_url, d.reader_url, d.doc_type,
            e.change_type, e.verification_status, t.relation, ${OFFICIAL_FILE_COLS}
     FROM document d
     LEFT JOIN amendment_effect e ON e.document_id = d.id AND e.provision_id = $1
     LEFT JOIN document_tag t ON t.document_id = d.id AND t.provision_id = $1${OFFICIAL_FILE_JOIN}
     WHERE e.id IS NOT NULL OR t.id IS NOT NULL
     ORDER BY d.date_issued DESC NULLS LAST`,
    [provisionId],
  );
}

// The most recent document that actually amends this provision (as opposed to merely citing it), so the
// reader is told what last changed the text and can open that notification.
export function lastAmendment(docs: ProvisionDocument[]): ProvisionDocument | null {
  const amending = docs.filter(
    (d) => (d.change_type && d.change_type !== "cannot_apply") || d.relation === "amends" || d.relation === "supersedes",
  );
  return amending[0] ?? null;
}

export async function instrumentDocuments(instrumentId: number) {
  return query<DocumentRow & { relation: string }>(
    `SELECT d.id, d.title, d.number, d.doc_type, d.date_issued, d.date_effective, d.source_url, d.reader_url, d.source_adapter,
            r.code AS regulator_code, d.is_amending, d.tag_status, d.first_seen_at, min(t.relation) AS relation,
            ${OFFICIAL_FILE_COLS}
     FROM document_tag t JOIN document d ON d.id = t.document_id JOIN regulator r ON r.id = d.regulator_id${OFFICIAL_FILE_JOIN}
     WHERE t.instrument_id = $1
     GROUP BY d.id, r.code, af.storage_key, af.source_url, af.mime
     ORDER BY d.date_issued DESC NULLS LAST LIMIT 500`,
    [instrumentId],
  );
}

export async function provisionHistory(instrumentId: number, provisionNumber: string) {
  const prov = await query<{ id: number; number: string; heading: string | null }>(
    `SELECT id, number, heading FROM provision WHERE instrument_id = $1 AND number = $2`,
    [instrumentId, provisionNumber],
  );
  if (!prov[0]) return null;
  const versions = await query<{
    id: number; text: string; effective_from: string | null; effective_to: string | null; source_kind: string;
    footnote: string | null; merge_confidence: number | null; created_at: string; document_id: number | null;
    document_title: string | null; document_number: string | null; verification_status: string | null;
  } & OfficialFile>(
    `SELECT v.id, v.text, v.effective_from, v.effective_to, v.source_kind, v.footnote, v.merge_confidence, v.created_at,
            d.id AS document_id, d.title AS document_title, d.number AS document_number,
            (SELECT e.verification_status FROM amendment_effect e WHERE e.new_version_id = v.id LIMIT 1) AS verification_status,
            ${OFFICIAL_FILE_COLS}
     FROM provision_version v LEFT JOIN document d ON d.id = v.created_by_document_id${OFFICIAL_FILE_JOIN}
     WHERE v.provision_id = $1 ORDER BY v.id`,
    [prov[0].id],
  );
  return { provision: prov[0], versions };
}

export async function listDocuments(opts: {
  regulator?: string; regulators?: string[]; docType?: string; instrument?: string; q?: string; from?: string; to?: string; limit?: number; offset?: number;
  /** Restrict to documents carrying one of these `document_tag.relation` values. Empty means all. */
  relations?: string[];
}) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (opts.regulator) add("r.code = ?", opts.regulator);
  // A subject can span more than one regulator -- FEMA is RBI and the Ministry of Finance -- so the subject
  // chips filter on a set rather than on one code.
  if (opts.regulators?.length) add("r.code = ANY(?)", opts.regulators);
  if (opts.docType) add("d.doc_type = ?", opts.docType);
  if (opts.from) add("d.date_issued >= ?::date", opts.from);
  if (opts.to) add("d.date_issued <= ?::date", opts.to);
  /* Instrument and relation, and when both are given they must describe the *same* tag.
   *
   * `document_tag.relation` is one of amends, supersedes, clarifies, references, and the difference matters
   * more than it looks. Browsing an instrument's documents should show all of them -- a circular that
   * merely cites section 195 is still worth finding. A feed should not: it answers "what changed", and the
   * Income-tax Act, 1961 carries 2,011 `references`, mostly RBI circulars mentioning it in passing.
   *
   * The first attempt put the relation in an EXISTS of its own, which is subtly useless: a document that
   * `clarifies` some FEMA regulation and merely `references` the Income-tax Act satisfies both clauses
   * independently and comes back anyway. Eleven RBI circulars arrived in the Act's feed that way. One
   * EXISTS, both conditions on the same `t`, is the only form that means what it says. */
  if (opts.instrument && opts.relations?.length) {
    params.push(opts.instrument, opts.relations);
    where.push(
      `EXISTS (SELECT 1 FROM document_tag t JOIN instrument i ON i.id = t.instrument_id
                WHERE t.document_id = d.id AND i.slug = $${params.length - 1} AND t.relation = ANY($${params.length}))`,
    );
  } else if (opts.instrument) {
    add("EXISTS (SELECT 1 FROM document_tag t JOIN instrument i ON i.id = t.instrument_id WHERE t.document_id = d.id AND i.slug = ?)", opts.instrument);
  } else if (opts.relations?.length) {
    add("EXISTS (SELECT 1 FROM document_tag t WHERE t.document_id = d.id AND t.relation = ANY(?))", opts.relations);
  }
  if (opts.q) add("(d.title ILIKE '%' || ? || '%' OR d.number ILIKE '%' || ? || '%')".replace("?", `$${params.length + 1}`).replace("?", `$${params.length + 1}`), opts.q);
  const limit = Math.min(opts.limit ?? 100, 1000);
  const offset = opts.offset ?? 0;
  const rows = await query<DocumentRow>(
    `SELECT d.id, d.title, d.number, d.doc_type, d.date_issued, d.date_effective, d.source_url, d.reader_url, d.source_adapter,
            r.code AS regulator_code, d.is_amending, d.tag_status, d.first_seen_at,
            (SELECT string_agg(DISTINCT i.short_code, ', ') FROM document_tag t JOIN instrument i ON i.id = t.instrument_id
               WHERE t.document_id = d.id AND t.relation IN ('amends','supersedes')) AS affects,
            ${OFFICIAL_FILE_COLS}
     FROM document d JOIN regulator r ON r.id = d.regulator_id${OFFICIAL_FILE_JOIN}
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY d.date_issued DESC NULLS LAST, d.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return rows;
}

export async function getDocument(id: number) {
  const docs = await query<DocumentRow & { raw_html: string | null }>(
    `SELECT d.*, r.code AS regulator_code FROM document d JOIN regulator r ON r.id = d.regulator_id WHERE d.id = $1`,
    [id],
  );
  if (!docs[0]) return null;
  const attachments = await query<{
    id: number; filename: string; mime: string | null; source_url: string; storage_key: string | null; size_bytes: number | null;
    page_count: number | null; extracted_text: string | null; ocr_used: boolean; is_primary: boolean;
  }>(`SELECT * FROM attachment WHERE document_id = $1 ORDER BY is_primary DESC, id`, [id]);
  const tags = await query<{ slug: string; title: string; relation: string; provision_number: string | null; confidence: number | null }>(
    `SELECT i.slug, i.title, t.relation, p.number AS provision_number, t.confidence
     FROM document_tag t JOIN instrument i ON i.id = t.instrument_id LEFT JOIN provision p ON p.id = t.provision_id
     WHERE t.document_id = $1 ORDER BY i.title, p.sort_key`,
    [id],
  );
  const effects = await query<{
    id: number; change_type: string; confidence: number | null; ai_note: string | null; verification_status: string;
    provision_number: string; instrument_slug: string; instrument_title: string; old_text: string | null; new_text: string | null;
    footnote: string | null;
  }>(
    `SELECT e.id, e.change_type, e.confidence, e.ai_note, e.verification_status, p.number AS provision_number,
            i.slug AS instrument_slug, i.title AS instrument_title, ov.text AS old_text, nv.text AS new_text, nv.footnote
     FROM amendment_effect e JOIN provision p ON p.id = e.provision_id JOIN instrument i ON i.id = p.instrument_id
     LEFT JOIN provision_version ov ON ov.id = e.old_version_id LEFT JOIN provision_version nv ON nv.id = e.new_version_id
     WHERE e.document_id = $1 ORDER BY i.title, p.sort_key`,
    [id],
  );
  return { doc: docs[0], attachments, tags, effects };
}

/** Full-text search. `within` confines every result to one instrument, for searching inside an open Act. */
export async function search(q: string, limit = 50, within?: string | null) {
  const ts = `websearch_to_tsquery('english', $1)`;
  const scope = within ?? null;
  const provisions = await query<{
    provision_id: number; number: string; instrument_slug: string; instrument_title: string; snippet: string; rank: number;
  }>(
    `SELECT p.id AS provision_id, p.number, i.slug AS instrument_slug, i.title AS instrument_title,
            ts_headline('english', v.text, ${ts}, 'MaxFragments=2, MaxWords=25, MinWords=10') AS snippet,
            ts_rank(to_tsvector('english', v.text), ${ts}) AS rank
     FROM provision_version v JOIN provision p ON p.id = v.provision_id JOIN instrument i ON i.id = p.instrument_id
     WHERE v.effective_to IS NULL AND NOT i.pdf_only AND to_tsvector('english', v.text) @@ ${ts}
       AND ($3::text IS NULL OR i.slug = $3)
     ORDER BY rank DESC LIMIT $2`,
    [q, limit, scope],
  );
  // Ranked and excerpted on the first 20,000 characters, not on the whole document.
  //
  // The index finds the matches in under a millisecond; the time went entirely into ts_rank re-reading and
  // re-tokenising each matched document in full. That is affordable for the median document, which is 3,260
  // characters, and ruinous for the ones common words actually match: the 373 documents containing "input
  // tax credit" average 173,018 characters and run to 6.4 million, so ranking them meant detoasting and
  // tokenising 62 MB on every search. Measured at 9.6 seconds, against 3.2 bounded.
  //
  // This changes the order of results, not the set: a document whose only mention of the term is beyond
  // 20,000 characters is still returned, it simply ranks on what came before. The alternative -- a stored
  // tsvector column -- would be faster still and cost about 32 MB plus its index, taking the database from
  // 49% to roughly 61% of the free tier, which is the wrong trade here.
  //
  // The WHERE below matches on the first 500,000 characters rather than the complete text. That is a real,
  // if narrow, limit and it is deliberate: unbounded, the index could not be written at all for the longest
  // documents (see 0008_bounded_fts.sql), so the choice was never "whole text or part" but "part of the
  // longest documents, or none of them".
  const documents = await query<{ id: number; title: string; number: string | null; date_issued: string | null; snippet: string; rank: number }>(
    `SELECT d.id, d.title, d.number, d.date_issued,
            ts_headline('english', left(coalesce(d.extracted_text, d.title), 20000), ${ts},
                        'MaxFragments=2, MaxWords=25, MinWords=10') AS snippet,
            ts_rank(to_tsvector('english', coalesce(d.title,'') || ' ' || left(coalesce(d.extracted_text,''), 20000)), ${ts}) AS rank
     FROM document d
     -- Character-for-character identical to document_fts_idx in packages/db/migrations/0008_bounded_fts.sql,
     -- and it has to stay that way: Postgres uses an expression index only when the query repeats the
     -- expression exactly, and a mismatch does not error -- it quietly sequential-scans 182 MB of OCR text.
     -- The left(...) bound is there because an unbounded tsvector over the longest documents exceeds the
     -- 1 MB tsvector cap and made them unwritable; 500,000 characters is about a 200-page PDF.
     WHERE to_tsvector('english', left(coalesce(d.title,'') || ' ' || coalesce(d.extracted_text,''), 500000)) @@ ${ts}
       -- Scoped by the tags the pipeline already records, so "inside this Act" means the notifications and
       -- circulars filed against it rather than everything that happens to mention its name.
       AND ($3::text IS NULL OR EXISTS (
             SELECT 1 FROM document_tag dt JOIN instrument di ON di.id = dt.instrument_id
              WHERE dt.document_id = d.id AND di.slug = $3))
     ORDER BY rank DESC, d.date_issued DESC NULLS LAST LIMIT $2`,
    [q, limit, scope],
  );

  // Finding a notification by its own number, as its own query.
  //
  // The text index covers the title and the extracted text, and a citation like 256/02/2026-GST or
  // G.S.R. 357(E) is in neither, so full-text search could not find a notification by the very thing it is
  // cited as. Substring rather than prefix: people quote the distinctive middle of a citation ("357(E)")
  // far more often than they type the boilerplate it opens with, and a third of the corpus begins with the
  // words "Notification No.".
  //
  // Separate, and not OR'd into the query above, because that is the difference between 120ms and 23
  // seconds. `document_fts_idx` is a GIN index on the tsvector expression; OR-ing an ILIKE beside it makes
  // the whole condition unindexable and Postgres falls back to scanning 182 MB of OCR text. Alone, the
  // number match is trivial.
  const byNumber = await query<{ id: number; title: string; number: string | null; date_issued: string | null; snippet: string; rank: number }>(
    `SELECT d.id, d.title, d.number, d.date_issued, coalesce(d.title, '') AS snippet,
            -- above any ts_rank, which is well below 1: an exact citation is the least ambiguous thing
            -- anyone can type, so it belongs at the top.
            CASE WHEN lower(d.number) = lower($1) THEN 100 ELSE 50 END AS rank
       FROM document d
      WHERE d.number ILIKE '%' || $1 || '%'
      ORDER BY rank DESC, d.date_issued DESC NULLS LAST
      LIMIT $2`,
    [q, Math.min(limit, 20)],
  );

  const seen = new Set(byNumber.map((d) => d.id));
  return { provisions, documents: [...byNumber, ...documents.filter((d) => !seen.has(d.id))] };
}

export type MapRow = {
  id: number;
  old_number: string | null;
  old_title: string | null;
  new_number: string | null;
  new_title: string | null;
  entity_type: string;
  old_instrument: string;
  new_instrument: string;
  sort_order: number;
};

export async function mapEntries(mapKey: string, opts: { q?: string; entity?: string; limit?: number } = {}) {
  const params: unknown[] = [mapKey];
  const where: string[] = ["map_key = $1"];
  if (opts.entity) {
    params.push(opts.entity);
    where.push(`entity_type = $${params.length}`);
  }
  if (opts.q) {
    params.push(opts.q);
    const i = params.length;
    where.push(
      `(old_number ILIKE '%' || $${i} || '%' OR new_number ILIKE '%' || $${i} || '%' OR old_title ILIKE '%' || $${i} || '%' OR new_title ILIKE '%' || $${i} || '%')`,
    );
  }
  const limit = Math.min(opts.limit ?? 400, 3000);
  return query<MapRow>(
    `SELECT id, old_number, old_title, new_number, new_title, entity_type, old_instrument, new_instrument, sort_order
     FROM section_map WHERE ${where.join(" AND ")}
     ORDER BY sort_order, id LIMIT ${limit}`,
    params,
  );
}

export async function provisionText(instrumentSlug: string, number: string) {
  const rows = await query<{ text: string; heading: string | null; source_kind: string; effective_from: string | null; number: string }>(
    `SELECT v.text, p.heading, v.source_kind, v.effective_from, p.number
     FROM provision p
     JOIN instrument i ON i.id = p.instrument_id
     JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
     WHERE i.slug = $1 AND (p.number = $2 OR upper(p.number) = upper($2))
     LIMIT 1`,
    [instrumentSlug, number],
  );
  return rows[0] ?? null;
}

export async function mapCounts(mapKey: string) {
  const [r] = await query<{ total: number; mapped: number; dropped: number; added: number; sections: number; rules: number }>(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE old_number IS NOT NULL AND new_number IS NOT NULL)::int mapped,
            count(*) FILTER (WHERE new_number IS NULL)::int dropped,
            count(*) FILTER (WHERE old_number IS NULL)::int added,
            count(*) FILTER (WHERE entity_type = 'section')::int sections,
            count(*) FILTER (WHERE entity_type <> 'section')::int rules
     FROM section_map WHERE map_key = $1`,
    [mapKey],
  );
  return r;
}

export async function homeStats() {
  const [s] = await query<{
    documents: number; instruments: number; provisions: number; machine_versions: number; cannot_apply: number; differs: number;
    pending: number; last_run: string | null;
  }>(`
    SELECT (SELECT count(*) FROM document)::int AS documents,
           (SELECT count(*) FROM instrument WHERE seeded_at IS NOT NULL OR EXISTS (SELECT 1 FROM provision p WHERE p.instrument_id = instrument.id))::int AS instruments,
           (SELECT count(*) FROM provision)::int AS provisions,
           (SELECT count(*) FROM provision_version WHERE source_kind = 'machine_merged' AND effective_to IS NULL)::int AS machine_versions,
           (SELECT count(*) FROM amendment_effect WHERE change_type = 'cannot_apply')::int AS cannot_apply,
           (SELECT count(*) FROM amendment_effect WHERE verification_status = 'differs_from_official')::int AS differs,
           (SELECT count(*) FROM job WHERE status IN ('queued','running'))::int AS pending,
           (SELECT max(finished_at)::text FROM source_run) AS last_run`);
  return s;
}

export async function sourceRuns() {
  return query<{ id: number; adapter: string; started_at: string; finished_at: string | null; docs_found: number; docs_new: number; ok: boolean | null; error: string | null }>(
    `SELECT * FROM source_run ORDER BY started_at DESC LIMIT 60`,
    [],
    LIVE_SECONDS,
  );
}

/** Instruments the regulator itself publishes nothing for — a gap in the source, not a collection failure.
 *
 * Worth its own panel on /status rather than leaving three permanent failures in the jobs table. A backlog
 * nobody can clear teaches people to stop reading the backlog, and then the entries that *are* actionable go
 * unread with it. Here the gap is stated once, with the date it was last confirmed and the regulator's own
 * page, so it can be checked rather than merely tolerated.
 */
export async function sourceGaps() {
  return query<{ slug: string; title: string; short_code: string; regulator_code: string; source_state: string; source_state_at: string | null; official_url: string | null }>(
    `SELECT i.slug, i.title, i.short_code, r.code AS regulator_code, i.source_state, i.source_state_at,
            i.official_url
       FROM instrument i JOIN regulator r ON r.id = i.regulator_id
      WHERE i.source_state IS NOT NULL
      ORDER BY r.code, i.title`,
    [],
    LIVE_SECONDS,
  );
}

/** Record the outcome of one search. Never throws, never blocks the page.
 *
 * Fire-and-forget on purpose. This is instrumentation: a reader who searched for something should get their
 * results whether or not we managed to write a row about it, and a logging failure that produced a 500
 * would be the instrument breaking the thing it measures.
 *
 * The query text is kept only when nothing was found -- see migration 0012. A search that succeeded has
 * already told us what we needed, and in a tax practice its wording may name a live matter.
 */
export async function logSearch(o: {
  query: string;
  found: boolean;
  scope?: string | null;
  provisions?: number;
  documents?: number;
  pages?: number;
  instruments?: number;
}): Promise<void> {
  const key = o.found ? null : o.query.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
  try {
    await query(
      `INSERT INTO search_log (query, query_key, found, scope, provisions, documents, pages, instruments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        o.found ? null : o.query.slice(0, 500),
        key,
        o.found,
        o.scope ?? null,
        o.provisions ?? 0,
        o.documents ?? 0,
        o.pages ?? 0,
        o.instruments ?? 0,
      ],
    );
  } catch {
    /* instrumentation must never be the reason a search fails */
  }
}

/** What readers looked for and did not find, most asked first. */
export async function searchesWithNoResults(days = 90, limit = 60) {
  return query<{ query: string; query_key: string; times: number; last_at: string }>(
    `SELECT min(query) AS query, query_key, count(*)::int AS times, max(at) AS last_at
       FROM search_log
      WHERE found IS FALSE AND at > now() - ($1 || ' days')::interval
      GROUP BY query_key ORDER BY times DESC, last_at DESC LIMIT $2`,
    [days, limit],
    LIVE_SECONDS,
  );
}

/** Volume and hit rate by day. No query text involved. */
export async function searchVolume(days = 30) {
  return query<{ day: string; searches: number; found: number }>(
    `SELECT to_char(at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day,
            count(*)::int AS searches,
            count(*) FILTER (WHERE found)::int AS found
       FROM search_log
      WHERE at > now() - ($1 || ' days')::interval
      GROUP BY 1 ORDER BY 1 DESC`,
    [days],
    LIVE_SECONDS,
  );
}

export type QualityFlag = {
  provision_id: number;
  instrument_slug: string;
  number: string;
  heading: string | null;
  flag: string;
  detail: string;
  sample: string;
};

/** Provisions whose stored text does not look like a provision, and a count per flag.
 *
 * Reads the `provision_quality_flag` view, which is also what `cli.py quality` reads. The predicates live
 * in the view (migration 0011) and not in this file on purpose: two definitions of what counts as a defect
 * would eventually disagree, and a quality check that disagrees with itself is worse than none.
 */
export async function qualityFlags(opts: { flag?: string; instrument?: string; limit?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.flag) {
    params.push(opts.flag);
    where.push(`flag = $${params.length}`);
  }
  if (opts.instrument) {
    params.push(opts.instrument);
    where.push(`instrument_slug = $${params.length}`);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, byFlag, byInstrument] = await Promise.all([
    query<QualityFlag>(
      `SELECT provision_id, instrument_slug, number, heading, flag, detail, sample
         FROM provision_quality_flag ${clause}
        ORDER BY instrument_slug, number LIMIT ${Math.min(opts.limit ?? 300, 1000)}`,
      params,
      LIVE_SECONDS,
    ),
    query<{ flag: string; n: number; detail: string }>(
      `SELECT flag, count(*)::int AS n, min(detail) AS detail FROM provision_quality_flag
        GROUP BY flag ORDER BY n DESC`,
      [],
      LIVE_SECONDS,
    ),
    query<{ instrument_slug: string; n: number }>(
      `SELECT instrument_slug, count(*)::int AS n FROM provision_quality_flag
        GROUP BY instrument_slug ORDER BY n DESC, instrument_slug LIMIT 20`,
      [],
      LIVE_SECONDS,
    ),
  ]);
  return { rows, byFlag, byInstrument };
}

export async function jobStats() {
  return query<{ type: string; status: string; n: number; last_error: string | null }>(
    `SELECT type, status, count(*)::int AS n, max(error) AS last_error FROM job GROUP BY type, status ORDER BY type, status`,
    [],
    LIVE_SECONDS,
  );
}

export async function recentEffects(limit = 50) {
  return query<{
    id: number; change_type: string; verification_status: string; confidence: number | null; created_at: string; ai_note: string | null;
    provision_number: string; instrument_slug: string; instrument_title: string; document_id: number; document_title: string;
  }>(
    `SELECT e.id, e.change_type, e.verification_status, e.confidence, e.created_at, e.ai_note, p.number AS provision_number,
            i.slug AS instrument_slug, i.title AS instrument_title, d.id AS document_id, d.title AS document_title
     FROM amendment_effect e JOIN provision p ON p.id = e.provision_id JOIN instrument i ON i.id = p.instrument_id
     JOIN document d ON d.id = e.document_id ORDER BY e.created_at DESC LIMIT $1`,
    [limit],
  );
}

// When the collection last ran successfully, and when a document was last added: what "as of" means for
// everything on the site.
/** The "Last checked" stamp in the header.
 *
 * An hour, not the thirty seconds the status page uses, and the difference matters far more than it looks.
 * This runs in the root layout, so it is part of every page; Next takes the shortest revalidate anywhere
 * in a route's tree as the route's own. At thirty seconds it was capping every cacheable page on the site
 * at a thirty-second CDN window -- for a value that changes once a day, when collection runs.
 *
 * Ten minutes had the same fault in miniature and it was invisible until provisions became cacheable.
 * Every route that matters declares 3600 and every one of them was being handed 600, because this and the
 * query cache's own default were both 600 and the shortest wins. Measured on the live site: provision
 * pages came back `ttl=595`. Raising the root layout's revalidate alone changed nothing, which is the tell
 * that the ceiling was never the layout.
 *
 * It decides what a crawl costs. At ten minutes a provision can re-render six times an hour under
 * sustained crawling; at an hour, once. With 4,464 provisions in the sitemap that is the difference
 * between a cheap crawl and most of the saving given back -- for freshness nobody asked for on a number
 * that moves once a day.
 */
const HEADER_STAMP_SECONDS = 3600;

export async function lastRevised(): Promise<{ checked: string | null; added: string | null }> {
  const rows = await query<{ checked: string | null; added: string | null }>(
    `SELECT (SELECT max(finished_at) FROM source_run WHERE ok) AS checked,
            (SELECT max(first_seen_at) FROM document) AS added`,
    [],
    HEADER_STAMP_SECONDS,
  );
  return rows[0] ?? { checked: null, added: null };
}

// ----------------------------------------------------------------------------- definitions

export type DefinitionHit = {
  slug: string;
  /** Which regulator issued the instrument. Drives the filter on /definitions. */
  regulator_code: string;
  instrument_title: string;
  short_code: string;
  kind: string;
  pdf_storage_key: string | null;
  number: string | null;
  heading: string | null;
  pdf_page: number | null;
  snippet: string;
  in_definitions_section: boolean;
  /** The term appeared in quotes -- how Indian drafting marks a term being defined. */
  quoted: boolean;
  /** Read out of the regulator's PDF rather than from parsed provisions. */
  from_pdf: boolean;
};

// How Indian drafting introduces a defined term.
//
// The quotes are not required, and that is the difference between this covering the library and covering a
// third of it. Requiring them was defensible while only parsed text was searched, where quotation marks
// survive. Most of what this searches now is text read out of a PDF, where opening quotes are routinely
// lost, mangled into stray characters, or swallowed by OCR -- and a definition does not stop being one
// because the extraction dropped its punctuation. What the quotes buy, when present, is the licence to
// look further along the sentence for the defining verb; without them the verb has to follow the term
// almost at once. Quoted hits are still ranked first, so the cleanest evidence leads.
const DEFINING = "(means|includes|shall\\s+mean|shall\\s+include|shall\\s+be\\s+deemed|has\\s+the\\s+meaning|shall\\s+have\\s+the\\s+meaning)";

/** Every place a word is *defined*, across every Act, Rule and Regulation that has text. */
/* `regulator` narrows the search itself, not the results afterwards.
 *
 * Filtering the returned rows was the first attempt and it was wrong in two ways. The filter disappeared
 * whenever every hit happened to share a regulator -- so on most searches the control simply was not there.
 * And it could only ever hide rows the unfiltered ranking had already chosen: asking for "turnover in GST"
 * could not surface a GST definition that sat at position 90 of the unfiltered order, because the query had
 * already stopped at eighty. Narrowing in SQL asks the real question. */
export async function searchDefinitions(
  term: string,
  limit = 80,
  regulator?: string | null,
): Promise<DefinitionHit[]> {
  const cleaned = term.trim();
  if (!cleaned) return [];
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Text read out of a PDF uses curly quotes as often as straight ones, and drops the space after the opening
  // quote unpredictably, so accept either. The bounded gap allows "'X', in relation to a company, means ..."
  // without letting a match run on into the next sentence.
  // \y, not \b: this regex runs in Postgres, whose POSIX syntax reads \b as a literal backspace, so a pattern
  // written with \b matches nothing at all and does it silently.
  // Two ways a definition is recognised, and the difference between them is what keeps this honest.
  //
  // Quoted, the term may sit some distance from the defining verb: «"capital asset", in relation to an
  // assessee, means ...» is plainly a definition, and the quotation marks are what prove it.
  //
  // Unquoted, there is no such proof, so the verb must follow almost immediately -- "capital asset means".
  // Allowing the same 90-character gap without quotes was a mistake I made and measured: it took "control"
  // from 15 hits to 67, of which five in six were not definitions at all but prose that happened to contain
  // "means" somewhere nearby ("internal controls to ensure compliance with the requirements ... means").
  // Adjacency costs a little coverage and buys back nearly all the precision: control 67 → 21, turnover
  // 23 → 3, while "capital asset" still finds 8 where quoting alone finds 2.
  const quotedPattern = `[“"'‘]\\s*${escaped}\\s*[”"'’][^.;]{0,90}?\\y${DEFINING}\\y`;
  const pattern = `(?:${quotedPattern}|\\y${escaped}\\y[ ,]{0,3}\\y${DEFINING}\\y)`;
  return query<DefinitionHit>(
    `(SELECT i.slug, i.title AS instrument_title, i.short_code, i.kind, i.pdf_storage_key,
            reg.code AS regulator_code,
            p.number, p.heading,
            coalesce(p.pdf_page, pg.page_no) AS pdf_page,
            substring(v.text from greatest(1, strpos(lower(v.text), lower($2)) - 60) for 420) AS snippet,
            (p.heading ~* '(definition|interpretation)') AS in_definitions_section,
            (v.text ~* $4) AS quoted,
            false AS from_pdf
       FROM provision p
       JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
       JOIN instrument i ON i.id = p.instrument_id
       JOIN regulator reg ON reg.id = i.regulator_id
       -- provision.pdf_page is only filled in for instruments the regulator publishes as a PDF -- 156 of
       -- several thousand provisions. For the rest we still hold the official PDF page by page, so look the
       -- definition up there with the same pattern: the page that states the definition is the page to open.
       LEFT JOIN LATERAL (
         SELECT ip.page_no FROM instrument_page ip
          WHERE ip.instrument_id = i.id AND ip.text ~* $1
          ORDER BY ip.page_no LIMIT 1
       ) pg ON p.pdf_page IS NULL
      WHERE v.text ILIKE '%' || $2 || '%' AND v.text ~* $1
        AND ($5::text IS NULL OR reg.code = $5))
     UNION ALL
     -- The other 107 of 195 instruments.
     --
     -- SEBI's regulations, the FEMA Act and every gazette-published text are served as the regulator's own
     -- PDF, and seeding deletes their provision rows outright -- so a search over provision_version could
     -- not see them at all. More than half the library was silently absent from a page that promises "every
     -- Act, Rule and Regulation whose text we hold". Their pages are indexed, so they can be searched with
     -- the same pattern; a page hit carries no provision number, only the page it is printed on, which is
     -- exactly what is needed to open the official file at the right place.
     (SELECT i.slug, i.title, i.short_code, i.kind, i.pdf_storage_key,
             reg.code,
             NULL::text, NULL::text,
             ip.page_no,
             substring(ip.text from greatest(1, strpos(lower(ip.text), lower($2)) - 60) for 420),
             (ip.text ~* '(definition|interpretation)'),
             (ip.text ~* $4),
             true
        FROM instrument_page ip
        JOIN instrument i ON i.id = ip.instrument_id
        JOIN regulator reg ON reg.id = i.regulator_id
       WHERE ip.text ILIKE '%' || $2 || '%' AND ip.text ~* $1
         AND ($5::text IS NULL OR reg.code = $5))
      -- Quoted first, being the clearest evidence; then a dedicated definitions clause; then parsed text
      -- ahead of text read out of a PDF, which is a finding aid and should not outrank the real thing.
      ORDER BY quoted DESC, in_definitions_section DESC, from_pdf, instrument_title, pdf_page NULLS LAST
      LIMIT $3`,
    // The cheap ILIKE runs first and throws out almost everything before either regex is considered.
    [pattern, cleaned, limit, quotedPattern, regulator || null],
  );
}

/* Defined terms beginning with what has been typed.
 *
 * The definitions box had no suggestions at all, and the reason recorded for that was sound as far as it
 * went: offering section numbers and notifications in a box that takes a word to be defined answers a
 * question nobody asked. The conclusion drawn from it was too broad. The right suggestion here is the one
 * thing the page is about -- terms that are actually defined somewhere in the library.
 *
 * Extracted live rather than from an index. The regex is the same shape the search itself uses: a quoted
 * term, then within ninety characters a defining verb. The ILIKE narrows which provisions are scanned
 * before any regex runs -- without it this reads every current provision version and takes seconds; with
 * it, measured against the real corpus, "cap" takes 0.48s and most prefixes about 0.2s.
 *
 * The prefix is then applied to the *extracted term*, not to the provision text. Filtering the text alone
 * was the first attempt: it found provisions that contain some term starting with "cap" and then offered
 * every definition in them, so typing "cap" suggested "royalty".
 *
 * Every backslash in the pattern below is doubled, and must be. This is a JavaScript template literal, so
 * a lone backslash-s is not an escape JavaScript recognises and it drops the backslash silently: Postgres
 * received a pattern matching the letter s rather than whitespace. It matched nothing, raised no error, and
 * the endpoint returned an empty list for every prefix while the same SQL run by hand returned the right
 * terms. Writing the explanation inside the literal then broke the build for the same reason.
 *
 * Ordered by how many instruments define the term, which puts the one a reader is most likely to mean at
 * the top: "capital asset" is defined in both Income-tax Acts, "capital value of such units" in one.
 */
export async function suggestDefinedTerms(prefix: string, limit = 8): Promise<string[]> {
  const cleaned = prefix.trim().toLowerCase();
  // Two characters is where this becomes a suggestion rather than a list of everything.
  if (cleaned.length < 2) return [];
  // Only the characters a defined term can start with. Anything else cannot match and would send a
  // pointless regex scan to the database on a keystroke.
  if (!/^[a-z][a-z ’'-]*$/.test(cleaned)) return [];
  const rows = await query<{ term: string }>(
    `SELECT term FROM (
       SELECT lower(btrim(m[1], ' ,-')) AS term
         FROM provision_version v,
              LATERAL regexp_matches(v.text,
                '["“‘]\\s*([A-Za-z][A-Za-z ,\\-]{2,48}?)\\s*["”’][^.;]{0,90}?\\y(means|includes|shall mean)\\y',
                'g') m
        WHERE v.effective_to IS NULL AND v.text ILIKE '%"' || $1 || '%'
     ) x
      WHERE term LIKE $1 || '%'
      GROUP BY term
      /* Fewest words first, and that ordering is the whole difference between a useful list and a list.
       *
       * Frequency alone put "capital sum" above "capital asset" and "capital value of such units" above
       * "capital goods" -- because the ranking measured how often a phrase is defined across the corpus,
       * which is not what somebody typing three letters is asking. They are asking for the term they
       * already have in mind, and that is almost always the short canonical one.
       *
       * So: an exact hit first, then by word count, and only then by how often it is defined. Frequency
       * still decides between terms of equal length, where it is a fair proxy for which one a reader
       * means. string_to_array rather than a regexp_split: this SQL lives inside a JS template literal,
       * where every backslash has to be doubled, and a silently de-escaped \s once cost an afternoon. */
      ORDER BY (term = $1) DESC,
               array_length(string_to_array(term, ' '), 1) ASC,
               count(*) DESC,
               length(term) ASC,
               term
      LIMIT $2`,
    [cleaned, limit],
  );
  return rows.map((r) => r.term);
}

export type Suggestion = {
  kind: "section" | "instrument" | "notification";
  /** The thing being suggested: a section number, an instrument title, a notification number. */
  label: string;
  /** The line under it, giving the label meaning: a section heading, a notification title. */
  sub: string | null;
  /** A short tag saying where it lives: ITA-1961, CBDT. */
  context: string | null;
  slug: string | null;
  doc_id: number | null;
};

/** What to offer while somebody is still typing.
 *
 * Deliberately not the full-text search. That one computes to_tsvector over every provision and every
 * attachment on each call, which is right for a considered search and hopeless on a keystroke -- it would
 * scan the whole corpus several times a second and still be waiting when the next letter arrived.
 *
 * These are prefix and substring matches over three small tables (195 instruments, 5,882 provisions, 8,003
 * documents), so a plain ILIKE scan finishes in single-digit milliseconds warm, and the result is cached by
 * query text like every other read here: the same prefixes get typed constantly.
 *
 * Numbers are matched as prefixes and titles as substrings, because that is how each is recalled -- nobody
 * half-remembers a section number from its middle, and nobody remembers an Act's title from its first word.
 */
/** Suggestions for the search box. `within` restricts every branch to one instrument, which is what makes
 * searching from inside an Act answer about that Act instead of about everything. */
export async function suggest(
  raw: string,
  limit = 12,
  within?: string | null,
): Promise<{ items: Suggestion[]; complete: boolean }> {
  const q = raw.trim();
  if (q.length < 2) return { items: [], complete: true };
  const prefix = `${q}%`;
  const anywhere = `%${q}%`;
  const scope = within ?? null;

  const rows = await query<Suggestion & { grp: number }>(
    `(SELECT 'section' AS kind, p.number AS label, p.heading AS sub,
             i.short_code AS context, i.slug AS slug, NULL::int AS doc_id,
             -- an exact number first, then the shortest: typing "80" should offer 80 before 80-IBA
             (lower(p.number) = lower($1)) AS exact, length(p.number) AS len, 1 AS grp
        FROM provision p JOIN instrument i ON i.id = p.instrument_id
       WHERE NOT i.pdf_only AND p.number ILIKE $2 AND ($5::text IS NULL OR i.slug = $5)
       ORDER BY exact DESC, len, i.short_code
       LIMIT ${BRANCH_BY_NUMBER})
     UNION ALL
     (SELECT 'section', p.number, p.heading, i.short_code, i.slug, NULL::int,
             false, length(coalesce(p.heading, '')), 2
        FROM provision p JOIN instrument i ON i.id = p.instrument_id
       WHERE NOT i.pdf_only AND p.heading ILIKE $3 AND ($5::text IS NULL OR i.slug = $5)
       ORDER BY length(coalesce(p.heading, '')), i.short_code
       LIMIT ${BRANCH_BY_HEADING})
     UNION ALL
     -- short_code is matched anywhere, not as a prefix. Every code carries its regulator in front of it
     -- (SEBI-LODR, FEM-EXPORT-AND-IMPORT-OF, CO-INC-2014), so prefix matching answers "LODR" with nothing
     -- while the site's own placeholder invites exactly that.
     (SELECT 'instrument', i.title, i.short_code, upper(i.kind), i.slug, NULL::int,
             (lower(coalesce(i.short_code, '')) = lower($1)), length(i.title), 3
        FROM instrument i
       WHERE (i.title ILIKE $3 OR i.short_code ILIKE $3) AND ($5::text IS NULL OR i.slug = $5)
       ORDER BY 7 DESC, length(i.title)
       LIMIT ${BRANCH_INSTRUMENT})
     UNION ALL
     -- Numbers matched anywhere, not just from the start. A citation is usually recalled by its distinctive
     -- middle -- "357(E)", "256/02" -- rather than by the boilerplate it opens with, and half the corpus
     -- begins with the words "Notification No.".
     (SELECT 'notification', d.number, d.title, r.code, NULL, d.id,
             (lower(d.number) = lower($1)), 0, 4
        FROM document d JOIN regulator r ON r.id = d.regulator_id
       WHERE d.number ILIKE $3
         AND ($5::text IS NULL OR EXISTS (
               SELECT 1 FROM document_tag dt JOIN instrument di ON di.id = dt.instrument_id
                WHERE dt.document_id = d.id AND di.slug = $5))
       ORDER BY 7 DESC, d.date_issued DESC NULLS LAST
       LIMIT ${BRANCH_NOTIFICATION})
     ORDER BY grp, exact DESC, len
     LIMIT $4`,
    [q, prefix, anywhere, limit, scope],
  );

  // Whether this is the whole answer, or only as much of it as the limits allowed.
  //
  // The caller uses this to decide if it may filter these rows itself for a longer query instead of asking
  // again. That shortcut is only sound on a complete answer, and completeness is not just a matter of the
  // overall limit: each branch has its own, so the section list can be cut off at eight while the total sits
  // well under twenty. Typing "80C" then "80CC" hit exactly that -- twelve rows back, comfortably under the
  // limit, yet the sections among them were already truncated, so filtering them lost a result that the
  // server would have returned.
  //
  // A branch that returns exactly its own limit is treated as truncated. It might have found precisely that
  // many, but there is no way to tell from here, and the safe reading is the one that asks again.
  const perBranch = new Map<number, number>();
  for (const r of rows) perBranch.set(r.grp, (perBranch.get(r.grp) ?? 0) + 1);
  const complete =
    rows.length < limit && [...SUGGEST_BRANCH_LIMITS].every(([grp, cap]) => (perBranch.get(grp) ?? 0) < cap);

  return { items: rows, complete };
}

/** How many rows each branch of the suggest query may return, interpolated into the SQL itself so the
 * completeness check below cannot drift out of step with it.
 *
 * Set well above what a specific query returns, and for a reason beyond variety. A branch that comes back
 * full might have had more to give, and there is no way to tell from the outside, so the answer has to be
 * called truncated -- which stops the search box narrowing it for the next keystroke and costs a round trip.
 * At five apiece almost every answer looked truncated, including "depre" with five rows in total, and the
 * shortcut never fired. Higher caps mean a full branch is genuinely unusual.
 *
 * The overall LIMIT still decides how many survive, so raising these widens what is considered, not what
 * comes back.
 */
const BRANCH_BY_NUMBER = 14;
const BRANCH_BY_HEADING = 12;
const BRANCH_INSTRUMENT = 10;
const BRANCH_NOTIFICATION = 12;

/** Keyed by the query's `grp` column. */
const SUGGEST_BRANCH_LIMITS: ReadonlyArray<readonly [number, number]> = [
  [1, BRANCH_BY_NUMBER],
  [2, BRANCH_BY_HEADING],
  [3, BRANCH_INSTRUMENT],
  [4, BRANCH_NOTIFICATION],
];

/* What has been read lately, by route and by instrument.
 *
 * Reads `page_view_day`, which holds one row per route per day and nothing about any reader -- so these
 * are views, never visitors. See migration 0014 for why that distinction is a design decision rather than
 * a shortcoming.
 */
export async function pageViews(days = 30) {
  const [byPath, byInstrument, daily, total] = await Promise.all([
    query<{ path: string; views: number }>(
      `SELECT path, SUM(views)::int AS views
         FROM page_view_day WHERE day > CURRENT_DATE - $1::int
        GROUP BY path ORDER BY views DESC`,
      [days],
      LIVE_SECONDS,
    ),
    // The question this table exists to answer: which Acts are actually opened. Joined to `instrument` so a
    // slug that has since been renamed or withdrawn shows as itself rather than as a dangling row.
    query<{ slug: string; title: string | null; views: number }>(
      `SELECT v.slug, i.title, SUM(v.views)::int AS views
         FROM page_view_day v
         LEFT JOIN instrument i ON i.slug = v.slug
        WHERE v.day > CURRENT_DATE - $1::int AND v.slug <> ''
        GROUP BY v.slug, i.title ORDER BY views DESC LIMIT 15`,
      [days],
      LIVE_SECONDS,
    ),
    query<{ day: string; views: number }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(views)::int AS views
         FROM page_view_day WHERE day > CURRENT_DATE - $1::int
        GROUP BY day ORDER BY day`,
      [days],
      LIVE_SECONDS,
    ),
    query<{ views: number }>(
      `SELECT COALESCE(SUM(views), 0)::int AS views FROM page_view_day WHERE day > CURRENT_DATE - $1::int`,
      [days],
      LIVE_SECONDS,
    ),
  ]);
  return { byPath, byInstrument, daily, total: total[0]?.views ?? 0, days };
}
