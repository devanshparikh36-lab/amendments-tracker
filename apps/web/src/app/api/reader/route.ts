import { NextResponse } from "next/server";
import { getPool } from "@/db";

/* Everything a reader can do to their own record: arrive, be renamed, switch alerts on, be forgotten.
 *
 * One route rather than four, because they share all of their validation and none of them is more than a
 * statement or two. The action is in the body.
 *
 * There is no authentication here and that is the design, not an omission: the address is a name badge,
 * not a credential (see packages/db/migrations/0015_reader.sql). The consequence is that anyone who knows
 * an address can read and change that reader's watchlist, so nothing may be stored against a reader that
 * they would mind a stranger seeing. A list of sections someone finds interesting clears that bar. If
 * anything ever stored here does not, this needs replacing with real sign-in rather than extending.
 *
 * The one thing that genuinely cannot be left open is *sending mail*: without a confirmation step, anyone
 * could type a stranger's address, switch alerts on, and have this site mail them daily. So alerts are
 * armed here and only ever sent to an address that has clicked a confirmation link.
 */

export const dynamic = "force-dynamic";

const MAX_NAME = 60;
const MAX_EMAIL = 254;
const SINCE_LIMIT = 20;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

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

  const email = clean(body.email, MAX_EMAIL).toLowerCase();
  if (!validEmail(email)) return NextResponse.json({ error: "bad email" }, { status: 400 });

  const action = clean(body.action, 20) || "identify";
  const pool = getPool();

  try {
    if (action === "forget") {
      /* Erasure, which the DPDP Act requires and which costs nothing to honour properly. The watchlist
       * goes with the row by ON DELETE CASCADE, so there is no orphan left behind holding a reader id. */
      await pool.query("DELETE FROM reader WHERE lower(email) = $1", [email]);
      return NextResponse.json({ ok: true, forgotten: true });
    }

    if (action === "rename") {
      const name = clean(body.name, MAX_NAME);
      await pool.query(
        "UPDATE reader SET name = NULLIF($2, ''), last_seen_at = now() WHERE lower(email) = $1",
        [email, name],
      );
      return NextResponse.json({ ok: true, name: name || null });
    }

    if (action === "alerts") {
      const on = body.on === true;
      /* 'daily' matches the collector, which runs once each morning -- anything more frequent would be a
       * promise the pipeline cannot keep. 'weekly' exists because a digest nobody opens is worse than no
       * digest. An unknown value falls back rather than failing: this is a preference, not a command. */
      const freq = body.freq === "weekly" ? "weekly" : "daily";
      /* Switching alerts on does not start mail arriving. It records the wish; alerts_ok_at is what
       * permits a send, and only a click on a confirmation link sets that. Switching off is immediate
       * and unconditional, because the one thing that must never need a round trip is stopping. */
      const r = await pool.query<{ alerts_on: boolean; alert_freq: string; confirmed: boolean }>(
        `UPDATE reader SET alerts_on = $2, alert_freq = $3, last_seen_at = now()
          WHERE lower(email) = $1
      RETURNING alerts_on, alert_freq, (alerts_ok_at IS NOT NULL) AS confirmed`,
        [email, on, freq],
      );
      const row = r.rows[0];
      return NextResponse.json({
        ok: true,
        alertsOn: row?.alerts_on ?? on,
        alertFreq: row?.alert_freq ?? freq,
        alertsConfirmed: row?.confirmed ?? false,
      });
    }

    // --- identify: arrive, and find out what happened while away ------------------------------------
    const name = clean(body.name, MAX_NAME);

    /* The upsert deliberately does NOT touch last_seen_at, so RETURNING hands back the *previous* visit.
     * That value is the entire basis of "since you were last here", and RETURNING always reports the row
     * as it is after the statement -- so setting the clock here would return now(), the window would be
     * zero wide, and the feature would quietly report nothing for ever. The clock is moved by the second
     * statement below, once the old value is safely in hand. */
    const up = await pool.query<{
      id: number; name: string | null; previous_seen: string;
      alerts_on: boolean; alert_freq: string; confirmed: boolean;
    }>(
      `INSERT INTO reader (email, name)
            VALUES ($1, NULLIF($2, ''))
       ON CONFLICT (email) DO UPDATE
               -- COALESCE and not a plain assignment: arriving without a name must not erase the one
               -- already chosen, and the drawer sends no name on an ordinary visit.
               SET name = COALESCE(NULLIF($2, ''), reader.name)
         RETURNING id,
                   name,
                   -- On insert this is the column default, now(), so a reader arriving for the first
                   -- time gets an empty window rather than the entire history of the corpus.
                   last_seen_at AS previous_seen,
                   alerts_on,
                   alert_freq,
                   (alerts_ok_at IS NOT NULL) AS confirmed`,
      [email, name],
    );

    const me = up.rows[0];
    if (!me) return NextResponse.json({ error: "could not identify" }, { status: 500 });

    const prev = me.previous_seen;
    /* Only after a real gap, not on every load.
     *
     * Advancing this unconditionally made "since you were last here" destroy itself: a reader arrived,
     * saw three notifications against their sections, refreshed or opened a second tab, and the window
     * was now zero wide and the list empty. The one feature that brings somebody back erased its own
     * answer the moment they looked at it.
     *
     * Thirty minutes is the width of a visit. Inside that the window holds still, so the list survives a
     * refresh, a second tab and a trip through five sections; beyond it the next arrival is a new visit
     * and the clock moves. The cost is that "last seen" in the admin table is accurate to half an hour,
     * which is a precision nothing there needs. */
    await pool.query(
      "UPDATE reader SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '30 minutes'",
      [me.id],
    );

    /* Every count in one round trip. Four separate queries would each wake the same connection to ask
     * the same database a one-number question, on a serverless function that pays per invocation. */
    const counts = await pool.query<{ follows: string; bookmarks: string; notes: string; searches: string }>(
      `SELECT (SELECT count(*) FROM reader_watch  WHERE reader_id = $1 AND kind = 'follow')::text   AS follows,
              (SELECT count(*) FROM reader_watch  WHERE reader_id = $1 AND kind = 'bookmark')::text AS bookmarks,
              (SELECT count(*) FROM reader_note   WHERE reader_id = $1)::text                       AS notes,
              (SELECT count(*) FROM reader_search WHERE reader_id = $1)::text                       AS searches`,
      [me.id],
    );
    const c = counts.rows[0];

    /* What landed against anything this reader follows, since they were last here.
     *
     * Two kinds of watch, so two halves: a followed instrument matches any document tagged to it, and a
     * followed provision matches an amendment recorded against that provision. Bounded, newest first --
     * a reader back after six months wants the most recent twenty, not six months of everything. */
    const since = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (d.id)
                d.id, d.title, d.date_issued, d.first_seen_at,
                r.code AS regulator_code,
                i.short_code AS about
           FROM reader_watch w
           JOIN document_tag t ON t.instrument_id = w.instrument_id
           JOIN document d     ON d.id = t.document_id
           JOIN regulator r    ON r.id = d.regulator_id
           JOIN instrument i   ON i.id = w.instrument_id
          WHERE w.reader_id = $1 AND w.kind = 'follow' AND w.instrument_id IS NOT NULL AND d.first_seen_at > $2
         UNION
         SELECT DISTINCT ON (d.id)
                d.id, d.title, d.date_issued, d.first_seen_at,
                r.code AS regulator_code,
                p.number AS about
           FROM reader_watch w
           -- document_tag rather than amendment_effect, and on purpose: the tag is what the digest's
           -- "Affects" column reports, so a reader following a section is told about exactly the
           -- documents the daily mail would have named. amendment_effect is narrower -- it holds only
           -- changes that were resolved to a provision version -- and following a section would then
           -- miss a circular that plainly concerns it.
           JOIN document_tag t ON t.provision_id = w.provision_id
           JOIN document d     ON d.id = t.document_id
           JOIN regulator r    ON r.id = d.regulator_id
           JOIN provision p    ON p.id = w.provision_id
          WHERE w.reader_id = $1 AND w.kind = 'follow' AND w.provision_id IS NOT NULL AND d.first_seen_at > $2
       ) x
       ORDER BY first_seen_at DESC
       LIMIT ${SINCE_LIMIT}`,
      [me.id, prev],
    );

    return NextResponse.json({
      ok: true,
      name: me.name,
      watching: Number(c?.follows ?? 0),
      bookmarks: Number(c?.bookmarks ?? 0),
      notes: Number(c?.notes ?? 0),
      searches: Number(c?.searches ?? 0),
      alertsOn: me.alerts_on,
      alertFreq: me.alert_freq,
      alertsConfirmed: me.confirmed,
      previousSeen: prev,
      since: since.rows,
    });
  } catch (err) {
    /* A reader who cannot be identified gets a page that works and no greeting, which is the right
     * failure: none of this is load-bearing for reading the law. */
    console.error("reader route:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
