import { NextRequest, NextResponse } from "next/server";
import { mapEntries } from "@/lib/queries";

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
    },
  });
}
