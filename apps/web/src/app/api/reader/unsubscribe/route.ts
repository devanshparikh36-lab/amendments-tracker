import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/db";

/* Stop the digest, in one press, from inside the mail client.
 *
 * This is the endpoint behind the List-Unsubscribe headers the digest carries. Gmail and Outlook show
 * their own unsubscribe control when they see those headers and POST here when it is pressed -- the reader
 * never leaves their inbox and never signs in to anything.
 *
 * Worth being clear why that matters more than it looks: the alternative to an easy unsubscribe is not a
 * retained reader, it is a spam report. Those cost the sending account its standing with every mailbox
 * provider, and this account also sends the operator's own digest -- so a reader who cannot find the exit
 * can quietly break the one mail the site actually depends on.
 *
 * POST does the work. GET is accepted too and does nothing but redirect to a page, because some clients
 * and most link scanners will fetch the URL out of curiosity, and a GET that unsubscribed people would
 * mean a scanner could end somebody's subscription. Same reasoning as /confirm, opposite direction.
 */

export const dynamic = "force-dynamic";

const MAX_TOKEN = 128;

async function stop(token: string): Promise<"stopped" | "unknown"> {
  const pool = getPool();
  /* Only alerts_on is cleared. Not the account, not the follows, not the notes, and not alerts_ok_at.
   *
   * Unsubscribing is "stop mailing me", not "forget me" -- a reader who stops the digest almost always
   * wants to keep their bookmarks, and deleting the lot would be answering a question nobody asked.
   * Keeping alerts_ok_at also means turning alerts back on later needs no second verification: the address
   * was proved once and that fact has not expired.
   *
   * Idempotent: a second press, or a scanner arriving after the fact, finds alerts already off and the
   * reader still sees the same page. */
  const r = await pool.query("UPDATE reader SET alerts_on = FALSE WHERE unsub_token = $1", [token]);
  return (r.rowCount ?? 0) > 0 ? "stopped" : "unknown";
}

export async function POST(req: NextRequest) {
  /* The token arrives in the query string, which is the one place it can: RFC 8058 says the client POSTs
   * to the URL in the header with a fixed body of "List-Unsubscribe=One-Click", so the URL has to carry
   * the identity. It is a bearer secret in a link -- the same trade every unsubscribe link in existence
   * makes -- and all it can do is switch off mail to the address it belongs to. */
  const token = (req.nextUrl.searchParams.get("t") ?? "").trim().slice(0, MAX_TOKEN);
  if (token.length < 16) return NextResponse.json({ error: "bad token" }, { status: 400 });

  try {
    const result = await stop(token);
    // 200 either way. A mail client showing "unsubscribed" to the reader and then an error because the
    // token was already used is a worse outcome than telling them the truth, which is that they are off.
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("unsubscribe route:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}

export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get("t") ?? "").trim().slice(0, MAX_TOKEN);
  // Nothing is changed on a GET. The page it lands on has the button.
  return NextResponse.redirect(new URL(`/unsubscribe?t=${encodeURIComponent(token)}`, req.nextUrl.origin));
}
