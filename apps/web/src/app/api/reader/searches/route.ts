import { NextResponse } from "next/server";
import { getPool } from "@/db";

/* Saved searches: keep, list, forget.
 *
 * This stores query text, which `search_log` deliberately refuses to keep -- and the difference is the
 * whole justification. search_log records what everyone typed, so it keeps outcomes and drops the words,
 * because a record of what a tax practice searched for is a disclosure risk nobody consented to. This
 * holds what one reader asked to keep, at their request, shown back to them, deleted when they say so.
 *
 * A search is saved only on a deliberate press. Nothing here is written as a side effect of searching.
 */

export const dynamic = "force-dynamic";

const MAX_EMAIL = 254;
const MAX_Q = 200;
/* A cap with a quiet eviction rather than an error. The right answer to a fiftieth saved search is to
 * drop the oldest; refusing it would make a reader tidy a list to save a thing they wanted now. */
const KEEP = 50;

function validEmail(v: string): boolean {
  return v.length >= 5 && v.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
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
      `INSERT INTO reader (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET last_seen_at = now() RETURNING id`,
      [email],
    );
    const readerId = r.rows[0]?.id;
    if (!readerId) return NextResponse.json({ error: "unavailable" }, { status: 503 });

    const action = typeof body.action === "string" ? body.action : "list";

    if (action === "save") {
      const q = (typeof body.q === "string" ? body.q : "").trim().replace(/\s+/g, " ").slice(0, MAX_Q);
      if (!q) return NextResponse.json({ error: "empty" }, { status: 400 });
      await pool.query(
        `INSERT INTO reader_search (reader_id, q) VALUES ($1, $2)
         ON CONFLICT (reader_id, lower(q)) DO UPDATE SET created_at = now()`,
        [readerId, q],
      );
      await pool.query(
        `DELETE FROM reader_search
           WHERE reader_id = $1
             AND id NOT IN (SELECT id FROM reader_search WHERE reader_id = $1 ORDER BY created_at DESC LIMIT $2)`,
        [readerId, KEEP],
      );
    }

    if (action === "forget") {
      const q = (typeof body.q === "string" ? body.q : "").trim().slice(0, MAX_Q);
      await pool.query("DELETE FROM reader_search WHERE reader_id = $1 AND lower(q) = lower($2)", [readerId, q]);
    }

    const rows = await pool.query(
      "SELECT q, created_at FROM reader_search WHERE reader_id = $1 ORDER BY created_at DESC LIMIT $2",
      [readerId, KEEP],
    );
    return NextResponse.json({ ok: true, searches: rows.rows });
  } catch (err) {
    console.error("searches route:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
