import { INSTRUMENT_ALIASES } from "@/lib/catalogue";
import {
  findInstruments,
  findProvisionsByNumber,
  searchInstrumentPages,
  type LookupInstrument,
  type LookupProvision,
  type PageHit,
} from "@/lib/queries";

// "80C", "regulation 17 LODR", "rule 8 incorporation" -> a provision, in one hop where possible.

const UNIT_WORDS: Record<string, string | null> = {
  section: "act",
  sections: "act",
  sec: "act",
  "s.": "act",
  u_s: "act",
  rule: "rules",
  rules: "rules",
  regulation: "regulations",
  regulations: "regulations",
  reg: "regulations",
  para: null,
  paragraph: null,
  clause: null,
  article: null,
};

const NOISE = new Set(["of", "the", "in", "under", "for", "a", "an", "and", "to", "as", "per", "read", "with", "no", "no."]);

export type ParsedQuery = {
  raw: string;
  number: string | null;
  words: string[];
  kindHint: string | null;
};

export function parseQuery(raw: string): ParsedQuery {
  const q = raw.trim().replace(/\s+/g, " ");
  const tokens = q.split(" ").filter(Boolean);
  let number: string | null = null;
  let kindHint: string | null = null;
  const words: string[] = [];

  for (const t of tokens) {
    const bare = t.replace(/^[([{]+|[)\]}.,;:]+$/g, "");
    const lower = bare.toLowerCase();
    if (lower in UNIT_WORDS) {
      kindHint = kindHint ?? UNIT_WORDS[lower];
      continue;
    }
    if (!number && isProvisionNumber(bare)) {
      number = normaliseNumber(bare);
      continue;
    }
    if (NOISE.has(lower) || lower.length < 2) continue;
    words.push(lower);
  }
  // "u/s 80C" and "s.80C" arrive as one token.
  if (!number) {
    const glued = q.match(/(?:^|\b)(?:u\/s|s|sec|section|rule|r|regulation|reg)[.\s/]*(\d{1,4}[A-Za-z]{0,4})\b/i);
    if (glued && !isYear(glued[1])) number = normaliseNumber(glued[1]);
  }
  return { raw: q, number, words, kindHint };
}

function isYear(s: string): boolean {
  return /^\d{4}$/.test(s) && Number(s) >= 1850 && Number(s) <= 2100;
}

function isProvisionNumber(s: string): boolean {
  if (!s) return false;
  if (isYear(s)) return false; // "1961" is the Act, not section 1961
  return /^\d{1,4}[A-Za-z]{0,4}(\(\d{1,3}[A-Za-z]?\))?$/.test(s) || /^\d{1,3}(\.\d{1,3}){1,3}$/.test(s);
}

export function normaliseNumber(s: string): string {
  return s.replace(/\s+/g, "").toUpperCase();
}

export type Candidate = LookupProvision & { score: number };

function scoreInstrument(
  words: string[],
  kindHint: string | null,
  inst: { slug: string; title: string; short_code: string; kind: string },
): number {
  let score = 0;
  const hay = `${inst.slug} ${inst.short_code} ${inst.title}`.toLowerCase();
  const phrase = words.join(" ");
  for (const [alias, slug] of Object.entries(INSTRUMENT_ALIASES)) {
    if (!phrase.includes(alias)) continue;
    if (inst.slug === slug) score += 10 + alias.length / 10;
  }
  for (const w of words) if (hay.includes(w)) score += 4;
  if (kindHint && inst.kind === kindHint) score += 1;
  if (kindHint === "regulations" && inst.kind === "master_direction") score += 0.5;
  return score;
}

// A page of a regulator's own PDF, offered as a one-click answer.
export type PageCandidate = PageHit & {
  instrument_slug: string;
  instrument_title: string;
  short_code: string;
  pdf_storage_key: string | null;
  pdf_source_url: string | null;
};

export type LookupResult = {
  parsed: ParsedQuery;
  jumpTo: string | null;
  provisions: Candidate[];
  instruments: LookupInstrument[];
  pages: PageCandidate[];
};

export async function resolveLookup(raw: string): Promise<LookupResult> {
  const parsed = parseQuery(raw);
  const [rows, instruments] = await Promise.all([
    parsed.number ? findProvisionsByNumber(parsed.number) : Promise.resolve([]),
    parsed.words.length ? findInstruments(parsed.words) : Promise.resolve([]),
  ]);

  const provisions: Candidate[] = rows
    .map((r) => ({ ...r, score: scoreInstrument(parsed.words, parsed.kindHint, r) }))
    .sort((a, b) => b.score - a.score || b.instrument_size - a.instrument_size);

  // Instruments served as the regulator's PDF have no provision rows to match, so the pages of that
  // file answer instead. Only the instruments the query actually named are searched.
  const pdfTargets = instruments.filter((i) => i.pdf_only && i.page_count > 0).slice(0, 3);
  const pageLists = await Promise.all(pdfTargets.map((i) => pagesFor(i, parsed)));
  // Stable: each instrument keeps the order its own page search returned, and pages carrying the
  // asked-for number as a heading come first across all of them.
  const pages: PageCandidate[] = pageLists.flat().sort((a, b) => Number(b.heading_hit) - Number(a.heading_hit));

  let jumpTo: string | null = null;
  if (provisions.length) {
    const [top, next] = provisions;
    const decisive = provisions.length === 1 || (top.score > 0 && (!next || top.score > next.score));
    if (decisive) jumpTo = provisionHref(top.instrument_slug, top.number);
  }
  // The query named exactly one PDF-served instrument: land on it with the search already run, so the
  // reader sees the page inside the regulator's file. With a number, only when a page actually carries
  // that number as a heading — otherwise the list of pages is the honest answer.
  if (!jumpTo && pages.length && pdfTargets.length === 1 && (!parsed.number || pages[0].heading_hit)) {
    jumpTo = pdfPageHref(pages[0].instrument_slug, pages[0].page_no, parsed.raw);
  }
  if (!jumpTo && !parsed.number && !pages.length && instruments.length) {
    const [top, next] = instruments;
    if (!next || top.rank > next.rank) jumpTo = `/browse/${top.slug}`;
  }
  return {
    parsed,
    jumpTo,
    provisions: provisions.slice(0, 40),
    instruments: instruments.slice(0, 12),
    pages: pages.slice(0, 12),
  };
}

async function pagesFor(inst: LookupInstrument, parsed: ParsedQuery): Promise<PageCandidate[]> {
  const wrap = (hits: PageHit[]) =>
    hits.map((h) => ({
      ...h,
      instrument_slug: inst.slug,
      instrument_title: inst.title,
      short_code: inst.short_code,
      pdf_storage_key: inst.pdf_storage_key,
      pdf_source_url: inst.pdf_source_url,
    }));
  let hits = await searchInstrumentPages(inst.id, parsed.raw, { number: parsed.number, limit: 8 });
  // "mutual funds valuation" needs every word on one page; if that finds nothing, any word will do.
  if (!hits.length && parsed.words.length > 1) {
    hits = await searchInstrumentPages(inst.id, parsed.words.join(" or "), { number: parsed.number, limit: 8 });
  }
  return wrap(hits);
}

// The reading view for one provision. /browse/<slug> is the instrument's landing page; the text lives
// one level down, and old ?p= links to the landing page are redirected there.
export function provisionHref(slug: string, number: string, extra?: string): string {
  return `/browse/${slug}/text?p=${encodeURIComponent(number)}${extra ?? ""}`;
}

// The instrument's own page, showing the official PDF opened at page N with the search still in the box.
export function pdfPageHref(slug: string, page: number, q?: string): string {
  const qs = q ? `&pq=${encodeURIComponent(q)}` : "";
  return `/browse/${slug}/text?page=${page}${qs}`;
}
