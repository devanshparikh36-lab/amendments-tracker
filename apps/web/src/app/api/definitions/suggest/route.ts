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
 * The Netlify-Vary header below is what makes this correct, and it is not optional.
 *
 * Netlify does not key its CDN cache on the whole URL. The Next runtime emits
 * `netlify-vary: query=__nextDataReq|_rsc`, so only those two parameters form part of the key and every
 * value of `q` is the same entry -- the first prefix anyone typed after a deploy was then served to
 * everybody for the whole hour. On production, ?q=inp answered with the six "capital ..." terms and
 * ?q=cap suggested "digital signature".
 *
 * Worth recording how long that took to pin down, because the wrong fix looked right twice. First
 * `export const revalidate` was swapped for force-dynamic, on the theory that Next only emitted the
 * restricted header for routes it considered cacheable. That shipped and changed nothing. The actual
 * mechanism was documented forty lines into /api/suggest the whole time, which had hit this exact bug
 * earlier and fixed it with the one line below -- and comparing the two files' `export const` declarations,
 * rather than reading them, is what missed it.
 *
 * Neither development nor the build can show this: dev has no CDN. It is only visible by asking production
 * two different questions and comparing the answers.
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
        headers: {
          "cache-control": "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400",
          // Without this, every prefix shares one cache entry. See the note at the top of this file.
          "Netlify-Vary": "query=q",
        },
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
