import { LIVE_SECONDS, query } from "@/db";

export type DocumentRow = {
  id: number;
  title: string;
  number: string | null;
  doc_type: string;
  date_issued: string | null;
  date_effective: string | null;
  source_url: string;
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
    `SELECT DISTINCT d.id, d.title, d.number, d.date_issued, d.source_url, d.doc_type,
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
    `SELECT d.id, d.title, d.number, d.doc_type, d.date_issued, d.date_effective, d.source_url, d.source_adapter,
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
  regulator?: string; docType?: string; instrument?: string; q?: string; from?: string; to?: string; limit?: number; offset?: number;
}) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (opts.regulator) add("r.code = ?", opts.regulator);
  if (opts.docType) add("d.doc_type = ?", opts.docType);
  if (opts.from) add("d.date_issued >= ?::date", opts.from);
  if (opts.to) add("d.date_issued <= ?::date", opts.to);
  if (opts.instrument) add("EXISTS (SELECT 1 FROM document_tag t JOIN instrument i ON i.id = t.instrument_id WHERE t.document_id = d.id AND i.slug = ?)", opts.instrument);
  if (opts.q) add("(d.title ILIKE '%' || ? || '%' OR d.number ILIKE '%' || ? || '%')".replace("?", `$${params.length + 1}`).replace("?", `$${params.length + 1}`), opts.q);
  const limit = Math.min(opts.limit ?? 100, 1000);
  const offset = opts.offset ?? 0;
  const rows = await query<DocumentRow>(
    `SELECT d.id, d.title, d.number, d.doc_type, d.date_issued, d.date_effective, d.source_url, d.source_adapter,
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

export async function search(q: string, limit = 50) {
  const ts = `websearch_to_tsquery('english', $1)`;
  const provisions = await query<{
    provision_id: number; number: string; instrument_slug: string; instrument_title: string; snippet: string; rank: number;
  }>(
    `SELECT p.id AS provision_id, p.number, i.slug AS instrument_slug, i.title AS instrument_title,
            ts_headline('english', v.text, ${ts}, 'MaxFragments=2, MaxWords=25, MinWords=10') AS snippet,
            ts_rank(to_tsvector('english', v.text), ${ts}) AS rank
     FROM provision_version v JOIN provision p ON p.id = v.provision_id JOIN instrument i ON i.id = p.instrument_id
     WHERE v.effective_to IS NULL AND NOT i.pdf_only AND to_tsvector('english', v.text) @@ ${ts}
     ORDER BY rank DESC LIMIT $2`,
    [q, limit],
  );
  const documents = await query<{ id: number; title: string; number: string | null; date_issued: string | null; snippet: string; rank: number }>(
    `SELECT d.id, d.title, d.number, d.date_issued,
            ts_headline('english', coalesce(d.extracted_text, d.title), ${ts}, 'MaxFragments=2, MaxWords=25, MinWords=10') AS snippet,
            ts_rank(to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.extracted_text,'')), ${ts}) AS rank
     FROM document d
     WHERE to_tsvector('english', coalesce(d.title,'') || ' ' || coalesce(d.extracted_text,'')) @@ ${ts}
     ORDER BY rank DESC LIMIT $2`,
    [q, limit],
  );
  const attachments = await query<{ id: number; document_id: number; filename: string; document_title: string; snippet: string }>(
    `SELECT a.id, a.document_id, a.filename, d.title AS document_title,
            ts_headline('english', a.extracted_text, ${ts}, 'MaxFragments=2, MaxWords=25, MinWords=10') AS snippet
     FROM attachment a JOIN document d ON d.id = a.document_id
     WHERE a.extracted_text IS NOT NULL AND to_tsvector('english', a.extracted_text) @@ ${ts}
     ORDER BY ts_rank(to_tsvector('english', a.extracted_text), ${ts}) DESC LIMIT $2`,
    [q, limit],
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
  return { provisions, documents: [...byNumber, ...documents.filter((d) => !seen.has(d.id))], attachments };
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
export async function lastRevised(): Promise<{ checked: string | null; added: string | null }> {
  const rows = await query<{ checked: string | null; added: string | null }>(
    `SELECT (SELECT max(finished_at) FROM source_run WHERE ok) AS checked,
            (SELECT max(first_seen_at) FROM document) AS added`,
    [],
    LIVE_SECONDS,
  );
  return rows[0] ?? { checked: null, added: null };
}

// ----------------------------------------------------------------------------- definitions

export type DefinitionHit = {
  slug: string;
  instrument_title: string;
  short_code: string;
  kind: string;
  pdf_storage_key: string | null;
  number: string;
  heading: string | null;
  pdf_page: number | null;
  snippet: string;
  in_definitions_section: boolean;
};

// How Indian drafting introduces a defined term. Kept deliberately narrow: "means" and "includes" after a
// quoted term are definitional, whereas the same words in running prose are not, which is why the quotes are
// required rather than optional.
const DEFINING = "(means|includes|shall\\s+mean|shall\\s+include|shall\\s+be\\s+deemed|has\\s+the\\s+meaning|shall\\s+have\\s+the\\s+meaning)";

/** Every place a word is *defined*, across every Act, Rule and Regulation that has text. */
export async function searchDefinitions(term: string, limit = 80): Promise<DefinitionHit[]> {
  const cleaned = term.trim();
  if (!cleaned) return [];
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Text read out of a PDF uses curly quotes as often as straight ones, and drops the space after the opening
  // quote unpredictably, so accept either. The bounded gap allows "'X', in relation to a company, means ..."
  // without letting a match run on into the next sentence.
  // \y, not \b: this regex runs in Postgres, whose POSIX syntax reads \b as a literal backspace, so a pattern
  // written with \b matches nothing at all and does it silently.
  const pattern = `[“"'‘]\\s*${escaped}\\s*[”"'’][^.;]{0,90}?\\y${DEFINING}\\y`;
  return query<DefinitionHit>(
    `SELECT i.slug, i.title AS instrument_title, i.short_code, i.kind, i.pdf_storage_key,
            p.number, p.heading,
            coalesce(p.pdf_page, pg.page_no) AS pdf_page,
            substring(v.text from greatest(1, strpos(lower(v.text), lower($2)) - 60) for 420) AS snippet,
            (p.heading ~* '(definition|interpretation)') AS in_definitions_section
       FROM provision p
       JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
       JOIN instrument i ON i.id = p.instrument_id
       -- provision.pdf_page is only filled in for instruments the regulator publishes as a PDF -- 156 of
       -- several thousand provisions. For the rest we still hold the official PDF page by page, so look the
       -- definition up there with the same pattern: the page that states the definition is the page to open.
       LEFT JOIN LATERAL (
         SELECT ip.page_no FROM instrument_page ip
          WHERE ip.instrument_id = i.id AND ip.text ~* $1
          ORDER BY ip.page_no LIMIT 1
       ) pg ON p.pdf_page IS NULL
      WHERE v.text ILIKE '%' || $2 || '%' AND v.text ~* $1
      ORDER BY (p.heading ~* '(definition|interpretation)') DESC, i.title, p.sort_key
      LIMIT $3`,
    // The cheap ILIKE runs first and throws out almost everything before the regex is considered.
    [pattern, cleaned, limit],
  );
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
export async function suggest(raw: string, limit = 12): Promise<Suggestion[]> {
  const q = raw.trim();
  if (q.length < 2) return [];
  const prefix = `${q}%`;
  const anywhere = `%${q}%`;

  return query<Suggestion>(
    `(SELECT 'section' AS kind, p.number AS label, p.heading AS sub,
             i.short_code AS context, i.slug AS slug, NULL::int AS doc_id,
             -- an exact number first, then the shortest: typing "80" should offer 80 before 80-IBA
             (lower(p.number) = lower($1)) AS exact, length(p.number) AS len, 1 AS grp
        FROM provision p JOIN instrument i ON i.id = p.instrument_id
       WHERE NOT i.pdf_only AND p.number ILIKE $2
       ORDER BY exact DESC, len, i.short_code
       LIMIT 8)
     UNION ALL
     (SELECT 'section', p.number, p.heading, i.short_code, i.slug, NULL::int,
             false, length(coalesce(p.heading, '')), 2
        FROM provision p JOIN instrument i ON i.id = p.instrument_id
       WHERE NOT i.pdf_only AND p.heading ILIKE $3
       ORDER BY length(coalesce(p.heading, '')), i.short_code
       LIMIT 5)
     UNION ALL
     -- short_code is matched anywhere, not as a prefix. Every code carries its regulator in front of it
     -- (SEBI-LODR, FEM-EXPORT-AND-IMPORT-OF, CO-INC-2014), so prefix matching answers "LODR" with nothing
     -- while the site's own placeholder invites exactly that.
     (SELECT 'instrument', i.title, i.short_code, upper(i.kind), i.slug, NULL::int,
             (lower(coalesce(i.short_code, '')) = lower($1)), length(i.title), 3
        FROM instrument i
       WHERE i.title ILIKE $3 OR i.short_code ILIKE $3
       ORDER BY 7 DESC, length(i.title)
       LIMIT 5)
     UNION ALL
     -- Numbers matched anywhere, not just from the start. A citation is usually recalled by its distinctive
     -- middle -- "357(E)", "256/02" -- rather than by the boilerplate it opens with, and half the corpus
     -- begins with the words "Notification No.".
     (SELECT 'notification', d.number, d.title, r.code, NULL, d.id,
             (lower(d.number) = lower($1)), 0, 4
        FROM document d JOIN regulator r ON r.id = d.regulator_id
       WHERE d.number ILIKE $3
       ORDER BY 7 DESC, d.date_issued DESC NULLS LAST
       LIMIT 5)
     ORDER BY grp, exact DESC, len
     LIMIT $4`,
    [q, prefix, anywhere, limit],
  );
}
