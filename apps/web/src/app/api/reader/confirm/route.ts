import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/db";

/* Turn a token into a confirmed address.
 *
 * A POST, and that is the whole reason /confirm is a page with a button rather than a link that just
 * works. A confirmation link in an email is fetched by things that are not the reader: corporate mail
 * gateways, spam scanners and link previewers follow URLs in incoming mail as a matter of course. If
 * opening the link were enough, those would confirm addresses on readers' behalf -- which is precisely
 * the consent this step exists to establish, granted by a machine that cannot consent to anything.
 *
 * So the mail's link opens a page, and the page asks for one deliberate press. One extra click, and the
 * difference between a verification that means something and one that means a scanner was awake.
 */

export const dynamic = "force-dynamic";

const MAX_TOKEN = 128;
/* 48 hours, matching what the mail promises. Long enough to survive a weekend and a mail read on Monday,
 * short enough that a token sitting in an old inbox is not a standing key to somebody's subscription. */
const TTL_HOURS = 48;

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const token = (typeof body.token === "string" ? body.token : "").trim().slice(0, MAX_TOKEN);
  if (token.length < 20) return NextResponse.json({ error: "bad token" }, { status: 400 });

  const pool = getPool();
  try {
    /* Single-use and time-bounded in one statement.
     *
     * The token is cleared in the same UPDATE that sets alerts_ok_at, so a second press -- or a second
     * device, or the scanner arriving late -- matches nothing. Being idempotent in the response rather
     * than in the write is the right way round here: the reader sees "confirmed" either way, and only one
     * write ever happens.
     *
     * The expiry is computed from confirm_sent_at rather than stored as a deadline, because the mail
     * quotes 48 hours from when it was sent and those two must be the same number.
     */
    /* The unsubscribe token is minted here, in the same statement, because this is the first instant the
     * reader can begin receiving anything -- and every digest they get has to carry a working opt-out.
     * COALESCE so that a second confirmation of the same address, were one ever possible, keeps the token
     * already printed in digests that have gone out. */
    const unsub = randomBytes(24).toString("base64url");
    const r = await pool.query<{ email: string }>(
      `UPDATE reader
          SET alerts_ok_at = now(),
              alerts_on = TRUE,
              confirm_token = NULL,
              unsub_token = COALESCE(unsub_token, $3)
        WHERE confirm_token = $1
          AND confirm_sent_at > now() - make_interval(hours => $2)
      RETURNING email`,
      [token, TTL_HOURS, unsub],
    );

    if (r.rows.length === 0) {
      /* Either it was used already, or it expired, or it never existed. The page says so in one sentence
       * and offers the way out -- press the button again from the account panel -- which is the right
       * answer to all three and does not require knowing which it was. */
      return NextResponse.json({ ok: false, reason: "not-valid" }, { status: 404 });
    }

    // The address is returned so the page can say which one was confirmed. A reader who manages two
    // addresses needs to know which of them they just switched on.
    return NextResponse.json({ ok: true, email: r.rows[0].email });
  } catch (err) {
    console.error("confirm route:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
