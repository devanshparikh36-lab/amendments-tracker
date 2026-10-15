import { getPool } from "@/db";

/* Everything this site holds about one reader, as a CSV they can keep.
 *
 * Two reasons it exists, and the second is the one that makes it non-negotiable. It is useful -- a list of
 * followed sections is worth having in a spreadsheet. And the DPDP Act gives a person the right to a copy
 * of their own data, which is cheap to honour properly and awkward to bolt on later.
 *
 * So it exports *everything*, not a tidy summary: the account row, every follow, every bookmark, every
 * note and every saved search. A partial export would satisfy the feature and not the right.
 *
 * POST, not GET, and no rate limit of its own: the address is in the body rather than the URL so that a
 * reader's email never lands in a server log, a Referer header or a browser history entry.
 */

export const dynamic = "force-dynamic";

const MAX_EMAIL = 254;

function validEmail(v: string): boolean {
  return v.length >= 5 && v.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/* RFC 4180: quote everything, double the quotes inside. Statutory titles carry commas constantly and a
 * note can carry anything at all, including the newline that would otherwise end the row early. */
function cell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/* Timestamps as "2026-10-14 14:12", in IST.
 *
 * The driver hands back Date objects and String() turns those into
 * "Wed Oct 14 2026 14:12:32 GMT+0530 (India Standard Time)" -- which is the runtime's idea of a date,
 * not a reader's, and which no spreadsheet will parse into a date column. Sortable, unambiguous, and in
 * the zone everything else on this site is shown in. */
function when(v: unknown): string {
  if (!v) return "";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase().slice(0, MAX_EMAIL);
  if (!validEmail(email)) return new Response("bad email", { status: 400 });

  const pool = getPool();
  try {
    const me = await pool.query<{ id: number; name: string | null; created_at: string; alerts_on: boolean; source: string }>(
      "SELECT id, name, created_at, alerts_on, source FROM reader WHERE lower(email) = $1",
      [email],
    );
    const r = me.rows[0];
    if (!r) return new Response("no such reader", { status: 404 });

    const [watches, notes, searches] = await Promise.all([
      pool.query(
        `SELECT w.kind, coalesce(p.number, '') AS number, i.short_code, i.title, w.created_at
           FROM reader_watch w
           LEFT JOIN provision p  ON p.id = w.provision_id
           LEFT JOIN instrument i ON i.id = coalesce(w.instrument_id, p.instrument_id)
          WHERE w.reader_id = $1 ORDER BY w.created_at`,
        [r.id],
      ),
      pool.query(
        `SELECT p.number, i.short_code, n.body, n.updated_at
           FROM reader_note n
           JOIN provision p  ON p.id = n.provision_id
           JOIN instrument i ON i.id = p.instrument_id
          WHERE n.reader_id = $1 ORDER BY n.updated_at`,
        [r.id],
      ),
      pool.query("SELECT q, created_at FROM reader_search WHERE reader_id = $1 ORDER BY created_at", [r.id]),
    ]);

    /* One file, several blocks, each with its own header row. Not strictly a CSV table -- a spreadsheet
     * shows it as sections with blank lines between, which is what a person opening this actually wants.
     * A machine-readable export would be JSON, and nobody has asked for one. */
    const rows: string[] = [];
    rows.push(["type", "a", "b", "c", "d"].map(cell).join(","));
    /* `source` is in here because the reader is entitled to know it. An address added from the admin
     * console was never asked for, and someone requesting their own data should be able to see that that
     * is how it got here rather than being told they signed up. */
    rows.push(
      [
        "account",
        email,
        r.name ?? "",
        when(r.created_at),
        `alerts ${r.alerts_on ? "daily" : "off"}, ${r.source === "admin" ? "added by the site owner" : "self signed-up"}`,
      ]
        .map(cell)
        .join(","),
    );
    rows.push("");
    rows.push(["kind", "instrument", "section", "title", "saved"].map(cell).join(","));
    for (const w of watches.rows as Record<string, unknown>[]) {
      rows.push([w.kind, w.short_code, w.number, w.title, when(w.created_at)].map(cell).join(","));
    }
    rows.push("");
    rows.push(["note", "instrument", "section", "text", "updated"].map(cell).join(","));
    for (const n of notes.rows as Record<string, unknown>[]) {
      rows.push(["note", n.short_code, n.number, n.body, when(n.updated_at)].map(cell).join(","));
    }
    rows.push("");
    rows.push(["search", "query", "", "", "saved"].map(cell).join(","));
    for (const s of searches.rows as Record<string, unknown>[]) {
      rows.push(["search", s.q, "", "", when(s.created_at)].map(cell).join(","));
    }

    // The BOM is for Excel, which otherwise reads a UTF-8 CSV as the system codepage and mangles the
    // rupee sign and every curly quote in a statutory title.
    return new Response("﻿" + rows.join("\r\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="as-amended-my-data.csv"',
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("export route:", err);
    return new Response("unavailable", { status: 503 });
  }
}
