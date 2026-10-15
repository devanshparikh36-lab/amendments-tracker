import { NextResponse } from "next/server";
import { getPool } from "@/db";
import { MAX_EMAIL, authorised, validEmail } from "@/lib/admin";

/* Add an address to the list, or remove one and everything behind it.
 *
 * The first route on this site that an administrator can use to write. Everything else here either reads
 * public law or is a reader acting on their own row, so this is the only place where one person's action
 * reaches another person's data -- which is why it is a separate file with its own guard rather than a
 * server action tucked inside the page.
 *
 * The key goes in the body, not the query string. The admin page itself takes it in the URL, which is
 * already a compromise it documents; there is no reason to repeat it somewhere it would also land in a
 * Referer header and a browser history entry on every write.
 *
 * Deleting is not reversible and not soft. It removes the reader row, and every follow, bookmark, note and
 * saved search goes with it by ON DELETE CASCADE -- the same operation the reader's own delete button
 * performs, deliberately, because an administrator's delete must not leave behind a shadow of somebody the
 * site claims to have forgotten.
 */

export const dynamic = "force-dynamic";

type Body = { key?: unknown; action?: unknown; email?: unknown };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key : "";
  if (!authorised(key)) {
    // 404, not 403. An unauthenticated caller learns nothing about whether this route exists.
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const email = (typeof body.email === "string" ? body.email : "").trim().toLowerCase().slice(0, MAX_EMAIL);
  const action = typeof body.action === "string" ? body.action : "";

  if (!validEmail(email)) return NextResponse.json({ error: "that is not an email address" }, { status: 400 });

  const pool = getPool();
  try {
    if (action === "add") {
      /* ON CONFLICT DO NOTHING, and that choice is the whole ethics of this endpoint.
       *
       * The obvious version updates on conflict and switches alerts on, so that "add" always results in an
       * address that receives mail. It would also silently reverse the decision of a reader who signed up
       * and deliberately left alerts off -- their opt-out overridden by an administrator typing their
       * address, with nothing anywhere recording that it happened.
       *
       * So an address already present is left exactly as it is and reported back as already present. The
       * list shows its real state; if it should be mailed, that is a decision to make while looking at the
       * fact that its owner said no.
       *
       * source = 'admin' marks the row as carrying no evidence of consent from its owner. See 0017.
       */
      const r = await pool.query<{ id: number }>(
        `INSERT INTO reader (email, alerts_on, alert_freq, source)
         VALUES ($1, TRUE, 'daily', 'admin')
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [email],
      );
      if (r.rows[0]) return NextResponse.json({ ok: true, created: true, email });

      // Already there. Say what state it is actually in rather than implying the add did something.
      const existing = await pool.query<{ alerts_on: boolean; source: string }>(
        "SELECT alerts_on, source FROM reader WHERE lower(email) = $1",
        [email],
      );
      return NextResponse.json({
        ok: true,
        created: false,
        email,
        alertsOn: existing.rows[0]?.alerts_on ?? false,
        source: existing.rows[0]?.source ?? "self",
      });
    }

    if (action === "delete") {
      const r = await pool.query("DELETE FROM reader WHERE lower(email) = $1", [email]);
      return NextResponse.json({ ok: true, deleted: (r.rowCount ?? 0) > 0, email });
    }

    if (action === "alerts-off") {
      /* Provided, while turning somebody else's alerts *on* is not.
       *
       * Stopping mail to a person who has asked for it to stop is something an administrator must be able
       * to do immediately, without waiting for them to find the account panel -- it is the mechanism behind
       * any unsubscribe request that arrives by mail. Starting mail to someone is the opposite kind of act
       * and is not offered here.
       */
      const r = await pool.query(
        "UPDATE reader SET alerts_on = FALSE WHERE lower(email) = $1",
        [email],
      );
      return NextResponse.json({ ok: true, changed: (r.rowCount ?? 0) > 0, email });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    console.error("admin readers route:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
