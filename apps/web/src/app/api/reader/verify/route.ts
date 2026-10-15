import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getPool } from "@/db";
import { mailConfigured, send } from "@/lib/mail";
import { VERIFY_SUBJECT, verifyHtml, verifyText } from "@/lib/verifymail";

/* Send the one mail that turns an address somebody typed into an address somebody owns.
 *
 * Asked for explicitly, by a link in the account panel, rather than fired automatically when the alerts
 * box is ticked. That is the design and it is the better one: an accidental tick sends nothing, and a
 * reader whose mail did not arrive can ask again without having to toggle a setting off and on.
 *
 * Until this is clicked and the link in the mail is opened, `alerts_ok_at` stays null and nothing will ever
 * be sent to the address. That column is the gate the digest reads -- the tick alone is a wish.
 */

export const dynamic = "force-dynamic";

const MAX_EMAIL = 254;
/* Two minutes between sends to one address.
 *
 * Not politeness -- quota. Gmail allows roughly 500 recipients a day for the whole account, shared with
 * the digest, and a verify button with no cooldown is a free way for anyone to spend that on a single
 * address and leave every other reader unmailed for the rest of the day. The edge rate limit bounds
 * requests per IP; this bounds mail per address, which is the resource that actually runs out.
 */
const COOLDOWN_SECONDS = 120;

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

  if (!mailConfigured()) {
    console.error("verify: SMTP is not configured on this deployment");
    return NextResponse.json({ error: "mail is not set up yet" }, { status: 503 });
  }

  const pool = getPool();
  try {
    /* One statement, because the cooldown has to be decided by the database rather than by this code.
     *
     * Reading `confirm_sent_at` and then writing it is two round trips with a gap in the middle, and two
     * clicks landing in that gap both pass the check and both send. The UPDATE itself carries the
     * condition, so the second one matches no row and sends nothing.
     *
     * Already-confirmed readers are excluded here too: re-verifying a confirmed address would mint a new
     * token and mail it for no reason.
     */
    const token = randomBytes(32).toString("base64url");
    const r = await pool.query<{ already: boolean }>(
      `UPDATE reader
          SET confirm_token = $2, confirm_sent_at = now()
        WHERE lower(email) = $1
          AND alerts_ok_at IS NULL
          AND (confirm_sent_at IS NULL OR confirm_sent_at < now() - make_interval(secs => $3))
      RETURNING (alerts_ok_at IS NOT NULL) AS already`,
      [email, token, COOLDOWN_SECONDS],
    );

    if (r.rows.length === 0) {
      /* Nothing matched, and the three reasons are deliberately answered the same way.
       *
       * No such reader, already confirmed, or asked again inside the cooldown -- the response does not say
       * which. This endpoint takes an address and nothing else, so distinguishing them would turn it into
       * a way to ask "does this person have an account here", which is a question about somebody's reading
       * that the rest of this site refuses to answer. The honest-looking version is the leak.
       */
      return NextResponse.json({ ok: true, sent: false });
    }

    const ok = await send({
      to: email,
      subject: VERIFY_SUBJECT,
      html: verifyHtml(token),
      text: verifyText(token),
    });

    if (!ok) {
      /* The send failed, so the token is withdrawn. Leaving it would start the 48-hour clock on a link
       * nobody received, and -- worse -- leave confirm_sent_at set, so the reader pressing the button
       * again inside two minutes would be refused by a cooldown protecting a mail that never went. */
      await pool.query(
        "UPDATE reader SET confirm_token = NULL, confirm_sent_at = NULL WHERE lower(email) = $1",
        [email],
      );
      return NextResponse.json({ error: "could not send" }, { status: 503 });
    }

    return NextResponse.json({ ok: true, sent: true });
  } catch (err) {
    console.error("verify route:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
