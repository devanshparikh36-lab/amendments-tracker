import { NextRequest, NextResponse } from "next/server";
import { suggestDefinedTerms } from "@/lib/queries";

/* Defined terms starting with what has been typed, for the box on /definitions.
 *
 * Separate from /api/suggest, which offers sections, instruments and notifications. That is the right
 * answer in the masthead and the wrong one here: this box takes a word to be defined, and a section number
 * is not a candidate for it.
 *
 * Cached by the query helper like every other read, which matters more than usual on a keystroke endpoint:
 * everyone types the same first two or three letters, so the common prefixes are served without the regex
 * scan running at all.
 *
 * force-dynamic, and it is not optional: `export const revalidate` here answered every prefix with the
 * first one typed after a deploy. Netlify builds its CDN cache key from a `Netlify-Vary: query=...` header
 * the Next runtime emits, and on a route Next considers cacheable that header lists only Next's internal
 * params -- so `q` leaves the key and one stored answer serves every prefix for the whole TTL. Caught on
 * production, where ?q=inp returned the six "capital ..." terms. The masthead's /api/suggest was right all
 * along by declaring force-dynamic; this one copied the wrong neighbour.
 *
 * Neither development nor the build shows it: dev has no CDN and Next disables the data cache there. The
 * Cache-Control header below is still honoured, so the edge caching this wanted is not lost.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  try {
    const items = await suggestDefinedTerms(q, 8);
    return NextResponse.json(
      { items },
      {
        // An hour at the edge. A defined term does not stop being defined, and the set changes only when
        // collection adds an instrument -- once a day at most.
        headers: { "cache-control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400" },
      },
    );
  } catch (err) {
    /* A suggestion list is a convenience: if the database is waking, the box still takes a word and the
     * form still submits, so an empty answer is the right response to the reader.
     *
     * But it is logged. Swallowing this silently cost me twenty minutes -- the endpoint returned an empty
     * list for every prefix while the SQL underneath, run by hand, was returning exactly the right terms,
     * and there was nothing anywhere to say why. Quiet to the reader, loud to the log. */
    console.error("definition suggest:", err);
    return NextResponse.json({ items: [] });
  }
}
