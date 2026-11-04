import { NextResponse } from "next/server";
import { authorised } from "@/lib/admin";

/* TEMPORARY. Delete this file once the admin console opens again.
 *
 * Why it exists: the console refuses every key, including a freshly-set short test value, and from outside
 * there is no way to tell the two causes apart. `authorised()` returns false both when ADMIN_KEY is unset
 * in the function's environment and when it is set to something other than what was typed, and the page
 * renders the same "Not available" either way. That ambiguity has cost several rounds of guessing at the
 * Netlify dashboard, so the question is asked of the running function instead.
 *
 * What it reveals, and why each field is safe to serve publicly:
 *
 *   configured    whether ADMIN_KEY reached the function at all. The "Not available" page already tells
 *                 the world that this site has an ADMIN_KEY, so this adds nothing an attacker can use.
 *   given_chars   the length of what ARRIVED in the query string, which is not necessarily what was typed:
 *                 an unescaped "&" truncates it, a "+" becomes a space, a "%" starts an escape. Echoing the
 *                 count back is how that class of mangling becomes visible.
 *   length_match  whether the two lengths agree. A length is discoverable by trying lengths regardless, and
 *                 lib/admin.ts already states the position this follows: the length of a secret is not the
 *                 part worth hiding. It is compared separately there for the same reason.
 *   exact_match   identical to what the admin page computes, so it discloses nothing the page does not.
 *
 * The key itself is never echoed, logged or hashed into the response.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const given = new URL(req.url).searchParams.get("key") ?? "";
  const want = process.env.ADMIN_KEY ?? "";

  return NextResponse.json(
    {
      configured: want.length > 0,
      given_chars: given.length,
      length_match: want.length > 0 && given.length === want.length,
      exact_match: authorised(given),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
