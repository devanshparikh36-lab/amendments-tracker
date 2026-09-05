import { NextRequest, NextResponse } from "next/server";
import { listDocuments } from "@/lib/queries";

function csv(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

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
  const header = ["date_issued", "regulator", "doc_type", "number", "title", "affects", "date_effective", "source_url"];
  const lines = [header.join(",")].concat(
    rows.map((r) => [r.date_issued, r.regulator_code, r.doc_type, r.number, r.title, r.affects, r.date_effective, r.source_url].map(csv).join(",")),
  );
  return new NextResponse(lines.join("\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="documents.csv"` },
  });
}
