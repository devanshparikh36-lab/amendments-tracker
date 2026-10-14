import { NextResponse } from "next/server";
import { getPool } from "@/db";

/* A reader's own note against a provision: read, write, delete.
 *
 * This is the one route on the site that carries a reader's own words rather than a pointer at public
 * law, and the identity guarding it is an email address anyone can type. That is stated at the point the
 * note is written, not only here -- see NoteBox -- because a warning in a policy protects nobody.
 *
 * The 2,000-character cap is enforced in three places: the textarea, here, and a CHECK on the table. The
 * database one is the only one that matters; the other two exist so a reader meets the limit as guidance
 * rather than as a failed request.
 */

export const dynamic = "force-dynamic";

const MAX_EMAIL = 254;
const MAX_BODY = 2000;

function validEmail(v: string): boolean {
  return v.length >= 5 && v.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

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
    const r = await pool.query<{ id: number }>(
      /* Deliberately does NOT touch last_seen_at. That column anchors "since you were last here", and
       * identify owns it -- it advances only after a thirty-minute gap so the window survives a refresh.
       * Setting it here defeated that completely: following a section, saving a note or keeping a search
       * each slammed the clock to now(), so the list of what had landed emptied itself the moment a
       * reader touched anything. Found by probing the routes in order and watching previousSeen move. */
      `INSERT INTO reader (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = reader.email
       RETURNING id`,
      [email],
    );
    const readerId = r.rows[0]?.id;
    if (!readerId) return NextResponse.json({ error: "unavailable" }, { status: 503 });

    const action = typeof body.action === "string" ? body.action : "get";

    if (action === "list") {
      const rows = await pool.query(
        `SELECT n.provision_id, n.body, n.updated_at, p.number, i.slug, i.short_code
           FROM reader_note n
           JOIN provision p  ON p.id = n.provision_id
           JOIN instrument i ON i.id = p.instrument_id
          WHERE n.reader_id = $1
          ORDER BY n.updated_at DESC
          LIMIT 300`,
        [readerId],
      );
      return NextResponse.json({ ok: true, notes: rows.rows });
    }

    const provisionId = id(body.provisionId);
    if (provisionId === null) return NextResponse.json({ error: "bad provision" }, { status: 400 });

    if (action === "get") {
      const rows = await pool.query<{ body: string; updated_at: string }>(
        "SELECT body, updated_at FROM reader_note WHERE reader_id = $1 AND provision_id = $2",
        [readerId, provisionId],
      );
      return NextResponse.json({ ok: true, note: rows.rows[0] ?? null });
    }

    const text = (typeof body.body === "string" ? body.body : "").trim().slice(0, MAX_BODY);

    /* An empty note is a deleted note. Saving a blank textarea is how a reader removes one, and offering a
     * separate Delete for something already erased on screen is a button that explains nothing. */
    if (action === "delete" || !text) {
      await pool.query("DELETE FROM reader_note WHERE reader_id = $1 AND provision_id = $2", [readerId, provisionId]);
      return NextResponse.json({ ok: true, note: null });
    }

    await pool.query(
      `INSERT INTO reader_note (reader_id, provision_id, body) VALUES ($1, $2, $3)
       ON CONFLICT (reader_id, provision_id) DO UPDATE SET body = $3, updated_at = now()`,
      [readerId, provisionId, text],
    );
    return NextResponse.json({ ok: true, note: { body: text } });
  } catch (err) {
    console.error("notes route:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
