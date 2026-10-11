import { getPool } from "@/db";

/* Counts a page view. Takes a path, returns nothing, stores no one.
 *
 * Why a beacon rather than counting during render, which would need no extra request: a count written
 * while rendering is a side effect inside a cached render. Pages here are served from a prerender or an
 * edge cache whenever they can be, so the count would be wrong in exactly the proportion the caching is
 * working -- and making it right would mean turning the caching off to measure it.
 *
 * Why first-party rather than an analytics script: the site loads no third-party anything, which is what
 * lets it carry no consent banner and make a short, true privacy statement. One script from one vendor
 * would end all three of those and put the reading habits of a tax practice on someone else's server.
 */

// Never cached, never prerendered: it is a write.
export const dynamic = "force-dynamic";

/* The entire vocabulary of paths this will store.
 *
 * The client sends `location.pathname` and the server decides what that *means*; nothing the client says
 * is written. Two reasons, and the second is the important one.
 *
 * Bounded cardinality: a table keyed on raw paths grows with traffic and with whatever a crawler invents,
 * and `/browse/<anything>` is an unbounded space. Matching against a fixed list means the table grows with
 * the calendar and the number of routes, both of which are small.
 *
 * And disclosure: it guarantees no query string is ever stored. `/find?q=section+68+cash+credits+<client>`
 * is a plausible URL on this site. `search_log` was deliberately shaped so a successful query's text is
 * never kept; writing paths verbatim here would put it back, in a table nobody would think to look at.
 */
const ROUTES: { re: RegExp; path: string; slug?: boolean }[] = [
  { re: /^\/$/, path: "/" },
  { re: /^\/browse$/, path: "/browse" },
  { re: /^\/browse\/([a-z0-9-]{1,80})$/, path: "/browse/[slug]", slug: true },
  { re: /^\/browse\/([a-z0-9-]{1,80})\/text$/, path: "/browse/[slug]/text", slug: true },
  { re: /^\/browse\/([a-z0-9-]{1,80})\/[^/]{1,80}\/history$/, path: "/browse/[slug]/[prov]/history", slug: true },
  { re: /^\/documents$/, path: "/documents" },
  // The id is dropped. Eight thousand document pages would be eight thousand rows a day for a number that
  // answers nothing the instrument slug does not answer better.
  { re: /^\/documents\/\d+$/, path: "/documents/[id]" },
  { re: /^\/definitions$/, path: "/definitions" },
  { re: /^\/find$/, path: "/find" },
  { re: /^\/search$/, path: "/search" },
  { re: /^\/compare\/income-tax$/, path: "/compare/income-tax" },
  { re: /^\/about$/, path: "/about" },
  { re: /^\/privacy$/, path: "/privacy" },
  { re: /^\/cookies$/, path: "/cookies" },
  { re: /^\/terms$/, path: "/terms" },
  // Maintenance screens. Counted because "is anyone actually reading /status" is worth knowing.
  { re: /^\/status$/, path: "/status" },
  { re: /^\/quality$/, path: "/quality" },
];

function classify(raw: string): { path: string; slug: string } | null {
  // Defence in depth: the client is told to send a bare pathname, so anything carrying a query or a
  // fragment is either a bug or someone probing, and in both cases the tail is discarded rather than
  // trusted. Then the whole thing must still match a pattern below.
  const bare = raw.split(/[?#]/)[0];
  for (const r of ROUTES) {
    const m = r.re.exec(bare);
    if (m) return { path: r.path, slug: r.slug ? (m[1] ?? "") : "" };
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  // 204 on every path out of here, including the failures. A counter must never be a reason a page reports
  // an error, and `sendBeacon` has nowhere to show one anyway.
  const done = new Response(null, { status: 204 });
  try {
    const body = (await request.json()) as { path?: unknown };
    if (typeof body?.path !== "string" || body.path.length > 300) return done;

    const hit = classify(body.path);
    if (!hit) return done;

    // getPool directly rather than the `query` helper: that one reads through a cache, which for a write
    // would mean the second view of a page quietly did nothing at all.
    await getPool().query(
      `INSERT INTO page_view_day (day, path, slug, views)
            VALUES (CURRENT_DATE, $1, $2, 1)
       ON CONFLICT (day, path, slug) DO UPDATE SET views = page_view_day.views + 1`,
      [hit.path, hit.slug],
    );
  } catch {
    /* counting is never worth a visible failure */
  }
  return done;
}
