import { INSTRUMENT_ALIASES } from "@/lib/catalogue";
import { findInstruments, findProvisionsByNumber, type LookupInstrument, type LookupProvision } from "@/lib/queries";

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

export type LookupResult = {
  parsed: ParsedQuery;
  jumpTo: string | null;
  provisions: Candidate[];
  instruments: LookupInstrument[];
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

  let jumpTo: string | null = null;
  if (provisions.length) {
    const [top, next] = provisions;
    const decisive = provisions.length === 1 || (top.score > 0 && (!next || top.score > next.score));
    if (decisive) jumpTo = provisionHref(top.instrument_slug, top.number);
  } else if (!parsed.number && instruments.length) {
    const [top, next] = instruments;
    if (!next || top.rank > next.rank) jumpTo = `/browse/${top.slug}`;
  }
  return { parsed, jumpTo, provisions: provisions.slice(0, 40), instruments: instruments.slice(0, 12) };
}

export function provisionHref(slug: string, number: string, extra?: string): string {
  return `/browse/${slug}?p=${encodeURIComponent(number)}${extra ?? ""}`;
}
