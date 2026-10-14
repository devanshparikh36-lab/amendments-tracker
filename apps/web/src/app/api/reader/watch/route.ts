import { NextResponse } from "next/server";
import { getPool } from "@/db";

/* Follows and bookmarks, and the list of both.
 *
 * One route for two kinds because they are one row with a different intent -- see 0016_reader_extras.sql.
 * They are independent: unfollowing something must not quietly throw away a bookmark on it.
 *
 * A watch is on an instrument ("anything in the CGST Rules") or on a provision ("just section 68"), never
 * both -- the database enforces that with a CHECK, so a malformed request fails loudly here rather than
 * leaving a row nobody can interpret.
 *
 * The email identifies, it does not authenticate. Someone who knows an address can change that reader's
 * lists. What is behind them is a set of pointers at public law, which is why that trade holds.
 */

export const dynamic = "force-dynamic";

const MAX_EMAIL = 254;
const KINDS = new Set(["follow", "bookmark"]);

function validEmail(v: string): boolean {
  return v.length >= 5 && v.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/** A positive integer, or null. Ids arrive from the client and are never trusted as given. */
function id(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  return Number.isInteger(n) && n > 0 && n < 2_147_483_647 ? n : null;
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase().slice(0, MAX_EMAIL);
  if (!validEmail(email)) return NextResponse.json({ error: "bad email" }, { status: 400 });

  const kindRaw = typeof body.kind === "string" ? body.kind : "follow";
  const kind = KINDS.has(kindRaw) ? kindRaw : "follow";

  const pool = getPool();

  try {
    /* The reader row must exist before anything can reference it. A follow is often the first thing
     * someone does after typing their address, and the two requests race -- so this creates the row if
     * the identify call has not landed yet rather than failing on a foreign key. */
    const r = await pool.query<{ id: number }>(
      `INSERT INTO reader (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET last_seen_at = now()
       RETURNING id`,
      [email],
    );
    const readerId = r.rows[0]?.id;
    if (!readerId) return NextResponse.json({ error: "unavailable" }, { status: 503 });

    const action = typeof body.action === "string" ? body.action : "toggle";

    if (action === "list") {
      /* Both kinds in one response. A section page carries a Follow and a Bookmark side by side, and a
       * contents page can carry fifty of each -- two requests per page to answer one question about the
       * same reader would be the obvious design and twice the cost. */
      const rows = await pool.query(
        `SELECT w.kind, 'instrument' AS target, i.id, i.short_code AS label, i.title, i.slug,
                NULL::text AS number, w.created_at
           FROM reader_watch w JOIN instrument i ON i.id = w.instrument_id
          WHERE w.reader_id = $1
          UNION ALL
         SELECT w.kind, 'provision' AS target, p.id, i.short_code AS label, i.title, i.slug,
                p.number, w.created_at
           FROM reader_watch w
           JOIN provision p  ON p.id = w.provision_id
           JOIN instrument i ON i.id = p.instrument_id
          WHERE w.reader_id = $1
          ORDER BY created_at DESC
          LIMIT 1000`,
        [readerId],
      );
      return NextResponse.json({ ok: true, watches: rows.rows });
    }

    const instrumentId = id(body.instrumentId);
    const provisionId = id(body.provisionId);
    if ((instrumentId === null) === (provisionId === null)) {
      return NextResponse.json({ error: "give exactly one of instrumentId, provisionId" }, { status: 400 });
    }

    const col = instrumentId !== null ? "instrument_id" : "provision_id";
    const value = instrumentId ?? provisionId;

    if (body.on === false) {
      await pool.query(
        `DELETE FROM reader_watch WHERE reader_id = $1 AND ${col} = $2 AND kind = $3`,
        [readerId, value, kind],
      );
      return NextResponse.json({ ok: true, on: false, kind });
    }

    /* ON CONFLICT DO NOTHING against the partial unique indexes: doing this twice is the same as doing it
     * once, and a double click should not be an error the reader has to understand. */
    await pool.query(
      `INSERT INTO reader_watch (reader_id, ${col}, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [readerId, value, kind],
    );
    return NextResponse.json({ ok: true, on: true, kind });
  } catch (err) {
    console.error("watch route:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
