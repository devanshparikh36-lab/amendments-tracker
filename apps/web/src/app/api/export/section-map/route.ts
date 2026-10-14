import { NextRequest, NextResponse } from "next/server";
import { mapEntries } from "@/lib/queries";

/* force-dynamic, and it is not optional: without it this route answers every query with the first one.
 *
 * Netlify builds its CDN cache key from a `Netlify-Vary: query=...` header that the Next runtime emits,
 * and on a route Next considers cacheable that header lists only Next's own internal params -- so `q` and
 * `entity` drop out of the key entirely and one stored response is served for every filter for the whole
 * TTL. Measured on production: ?q=salary and ?q=capital returned byte-identical CSVs.
 *
 * Invisible in development, which has neither the CDN nor the data cache, and invisible in the build log.
 * The sibling /api/export/documents route escapes it; /api/suggest escapes it by declaring force-dynamic,
 * which is the one reliable way to keep the query string in the cache key. The Cache-Control header below
 * still gets honoured, so this costs nothing in cache hits.
 */
export const dynamic = "force-dynamic";

function csv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rows = await mapEntries("income-tax", {
    q: sp.get("q") || undefined,
    entity: sp.get("entity") || undefined,
    limit: 3000,
  });
  const header = ["type", "old_instrument", "old_number", "old_title", "new_instrument", "new_number", "new_title", "status"];
  const lines = [header.join(",")].concat(
    rows.map((r) =>
      [
        r.entity_type,
        r.old_instrument,
        r.old_number,
        r.old_title,
        r.new_instrument,
        r.new_number,
        r.new_title,
        !r.new_number ? "no counterpart in 2025" : !r.old_number ? "new in 2025" : "mapped",
      ]
        .map(csv)
        .join(","),
    ),
  );
  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="income-tax-1961-vs-2025-mapping.csv"',
      // CBDT's own 1961-to-2025 concordance, which changes when the department republishes it and not
      // otherwise -- so a day at the edge, and uncached it was a full table scan per call with nothing
      // stopping anyone from asking repeatedly. No Netlify-Vary: this endpoint takes no parameters, so
      // every caller gets the same file and the path is the whole cache key.
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
