import { NextRequest, NextResponse } from "next/server";
import { listDocuments } from "@/lib/queries";
import { documentPageUrl } from "@/lib/source";

function csv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* The filtered document list as CSV.
 *
 * Cached, which it was not. Every call ran a thousand-row query and a thousand-row string build on a fresh
 * function invocation, with no cache headers at all -- so anyone who wanted to could loop this endpoint and
 * spend the account's invocations and Neon compute as fast as the network allowed. Nothing malicious is
 * needed either: a browser that retries a stalled download, or a script someone writes to poll it, does the
 * same thing by accident.
 *
 * An hour at the edge is generous rather than tight because collection runs once a day: two exports taken
 * ten minutes apart cannot differ, so serving the second from the CDN costs nothing in freshness. The CSV
 * for one filter is also identical for every caller, which is what makes it cacheable at all -- there is no
 * per-reader state anywhere in it.
 */
const CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

// Every parameter that changes the result has to be named, or the CDN answers one filter's request with
// another's file. Learnt the expensive way: the same omission served scoped search suggestions across Acts.
const VARY = "query=regulator|type|instrument|q|from|to";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rows = await listDocuments({
    regulator: sp.get("regulator") ?? undefined,
    docType: sp.get("type") ?? undefined,
    instrument: sp.get("instrument") ?? undefined,
    q: sp.get("q") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    limit: 1000,
  });
  // `official_page` rather than the raw `source_url`. For CBDT that column held a headless-delivery JSON
  // endpoint, so every CSV taken of income-tax notifications carried 2,234 addresses that open an API
  // response -- the same defect that was fixed on the pages, still present in the file people take away.
  // Both columns are kept: one is what a reader opens, the other is what the collector read, and a
  // practitioner reconciling an export against our records needs to be able to tell them apart.
  const header = [
    "date_issued",
    "regulator",
    "doc_type",
    "number",
    "title",
    "affects",
    "date_effective",
    "official_page",
    "source_url",
  ];
  const lines = [header.join(",")].concat(
    rows.map((r) =>
      [
        r.date_issued,
        r.regulator_code,
        r.doc_type,
        r.number,
        r.title,
        r.affects,
        r.date_effective,
        documentPageUrl(r) ?? "",
        r.source_url,
      ]
        .map(csv)
        .join(","),
    ),
  );
  return new NextResponse(lines.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="documents.csv"`,
      "Cache-Control": CACHE,
      "Netlify-Vary": VARY,
    },
  });
}
