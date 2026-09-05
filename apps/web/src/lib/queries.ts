import { query } from "@/db";

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
};

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
};

export async function listInstruments(): Promise<InstrumentRow[]> {
  return query<InstrumentRow>(`
    SELECT i.id, i.slug, i.short_code, i.title, i.kind, i.official_url, i.official_updated_as_on, i.seeded_at,
           r.code AS regulator_code,
           (SELECT count(*) FROM provision p WHERE p.instrument_id = i.id)::int AS provision_count,
           (SELECT count(*) FROM provision p JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
              WHERE p.instrument_id = i.id AND v.source_kind = 'machine_merged')::int AS machine_count,
           (SELECT count(DISTINCT t.document_id) FROM document_tag t WHERE t.instrument_id = i.id)::int AS doc_count
    FROM instrument i JOIN regulator r ON r.id = i.regulator_id
    ORDER BY i.kind, i.title`);
}

export async function getInstrument(slug: string): Promise<InstrumentRow | null> {
  const rows = await query<InstrumentRow>(
    `SELECT i.*, r.code AS regulator_code, 0 AS provision_count, 0 AS machine_count, 0 AS doc_count
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
            v.id AS version_id, v.text, v.source_kind, v.effective_from, v.footnote, v.merge_confidence,
            (SELECT count(*) FROM amendment_effect e WHERE e.provision_id = p.id)::int AS effect_count,
            (SELECT count(*) FROM amendment_effect e WHERE e.provision_id = p.id AND e.verification_status = 'differs_from_official')::int AS differs
     FROM provision p ${versionJoin}
     WHERE p.instrument_id = $1
     ORDER BY p.sort_key, v.id DESC`,
    params,
  );
}

export async function provisionDocuments(provisionId: number) {
  return query<{
    id: number; title: string; number: string | null; date_issued: string | null; change_type: string | null;
    verification_status: string | null; relation: string | null;
  }>(
    `SELECT DISTINCT d.id, d.title, d.number, d.date_issued, e.change_type, e.verification_status, t.relation
     FROM document d
     LEFT JOIN amendment_effect e ON e.document_id = d.id AND e.provision_id = $1
     LEFT JOIN document_tag t ON t.document_id = d.id AND t.provision_id = $1
     WHERE e.id IS NOT NULL OR t.id IS NOT NULL
     ORDER BY d.date_issued DESC NULLS LAST`,
    [provisionId],
  );
}

export async function instrumentDocuments(instrumentId: number) {
  return query<DocumentRow & { relation: string }>(
    `SELECT d.id, d.title, d.number, d.doc_type, d.date_issued, d.date_effective, d.source_url, d.source_adapter,
            r.code AS regulator_code, d.is_amending, d.tag_status, d.first_seen_at, min(t.relation) AS relation
     FROM document_tag t JOIN document d ON d.id = t.document_id JOIN regulator r ON r.id = d.regulator_id
     WHERE t.instrument_id = $1
     GROUP BY d.id, r.code ORDER BY d.date_issued DESC NULLS LAST LIMIT 500`,
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
  }>(
    `SELECT v.id, v.text, v.effective_from, v.effective_to, v.source_kind, v.footnote, v.merge_confidence, v.created_at,
            d.id AS document_id, d.title AS document_title, d.number AS document_number,
            (SELECT e.verification_status FROM amendment_effect e WHERE e.new_version_id = v.id LIMIT 1) AS verification_status
     FROM provision_version v LEFT JOIN document d ON d.id = v.created_by_document_id
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
               WHERE t.document_id = d.id AND t.relation IN ('amends','supersedes')) AS affects
     FROM document d JOIN regulator r ON r.id = d.regulator_id
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
     WHERE v.effective_to IS NULL AND to_tsvector('english', v.text) @@ ${ts}
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
  return { provisions, documents, attachments };
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
  );
}

export async function jobStats() {
  return query<{ type: string; status: string; n: number; last_error: string | null }>(
    `SELECT type, status, count(*)::int AS n, max(error) AS last_error FROM job GROUP BY type, status ORDER BY type, status`,
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
