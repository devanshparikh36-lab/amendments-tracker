import { NextRequest, NextResponse } from "next/server";
import { mapEntries } from "@/lib/queries";

/* The Netlify-Vary header further down is what makes this route's cache correct.
 *
 * Netlify does not key its CDN cache on the whole URL: the Next runtime emits
 * `netlify-vary: query=__nextDataReq|_rsc`, so without naming them, `q` and `entity` drop out of the key
 * and one stored CSV is served for every filter until the TTL expires. Measured on production -- ?q=salary
 * and ?q=capital returned byte-identical files.
 *
 * The header below used to say "this endpoint takes no parameters, so the path is the whole cache key".
 * It does take two, and has since the filters were added; the comment outlived the code it described,
 * which is how the bug survived in plain sight.
 *
 * force-dynamic stays, but it is not the fix and was briefly mistaken for one. Dev has no CDN, so none of
 * this is visible before deploying.
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
      // stopping anyone from asking repeatedly.
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      // The two filters this route actually reads. A day-long cache keyed without them served one filter's
      // CSV to every other filter. See the note at the top of this file.
      "Netlify-Vary": "query=q|entity",
    },
  });
}
