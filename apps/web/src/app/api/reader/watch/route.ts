import { NextResponse } from "next/server";
import { getPool } from "@/db";

/* Follow and unfollow, and the list of what is followed.
 *
 * A watch is on an instrument ("anything in the CGST Rules") or on a provision ("just section 68"), never
 * both -- the database enforces that with a CHECK, so a malformed request fails loudly here rather than
 * leaving a row nobody can interpret.
 *
 * The same caveat as the parent route applies: the email identifies, it does not authenticate. Someone who
 * knows an address can change that reader's watchlist. The thing behind it is a list of sections, which is
 * why this is an acceptable trade and would not be if anything private sat here.
 */

export const dynamic = "force-dynamic";

const MAX_EMAIL = 254;

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

  const pool = getPool();

  try {
    /* The reader row must exist before anything can reference it. A follow is often the very first thing
     * someone does after typing their address, and the two requests race -- so this creates the row if the
     * identify call has not landed yet rather than failing on a foreign key. */
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
      const rows = await pool.query(
        `SELECT 'instrument' AS kind, i.id, i.short_code AS label, i.title, i.slug, NULL::text AS number, w.created_at
           FROM reader_watch w JOIN instrument i ON i.id = w.instrument_id
          WHERE w.reader_id = $1
          UNION ALL
         SELECT 'provision' AS kind, p.id, i.short_code AS label, i.title, i.slug, p.number, w.created_at
           FROM reader_watch w
           JOIN provision p  ON p.id = w.provision_id
           JOIN instrument i ON i.id = p.instrument_id
          WHERE w.reader_id = $1
          ORDER BY created_at DESC
          LIMIT 500`,
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
      await pool.query(`DELETE FROM reader_watch WHERE reader_id = $1 AND ${col} = $2`, [readerId, value]);
      return NextResponse.json({ ok: true, following: false });
    }

    /* ON CONFLICT DO NOTHING against the partial unique indexes: following something twice is the same as
     * following it once, and a double click should not be an error the reader has to understand. */
    await pool.query(
      `INSERT INTO reader_watch (reader_id, ${col}) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [readerId, value],
    );
    return NextResponse.json({ ok: true, following: true });
  } catch (err) {
    console.error("watch route:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
