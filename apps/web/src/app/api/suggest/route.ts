import { NextRequest, NextResponse } from "next/server";
import { provisionHref } from "@/lib/lookup";
import { suggest } from "@/lib/queries";

export const dynamic = "force-dynamic";

// What to offer while somebody is still typing.
//
// Called on a keystroke, so it has to be cheap and it has to be cacheable. The query underneath is prefix and
// substring matching over three small tables and is cached by text like every other read here, which matters
// more than it sounds: everyone types the same first two letters, so the common prefixes are served without
// touching Neon at all.
//
// The href is built here rather than in SQL so that provisionHref stays the single place that knows how a
// provision URL is spelt -- it has been changed once already, and a second copy in a query would have been
// missed.
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  const rows = await suggest(q);
  const items = rows.map((r) => ({
    kind: r.kind,
    label: r.label,
    sub: r.sub,
    context: r.context,
    href:
      r.kind === "notification"
        ? `/documents/${r.doc_id}`
        : r.kind === "instrument"
          ? `/browse/${r.slug}`
          : provisionHref(r.slug ?? "", r.label),
  }));

  return NextResponse.json(
    { items },
    {
      headers: {
        // Let the browser reuse a prefix the reader has already typed -- backspacing through a word
        // otherwise re-requests everything it just asked for.
        "Cache-Control": "public, max-age=60, stale-while-revalidate=600",
        // Netlify-Vary is not optional here, and getting it wrong is silent.
        //
        // Netlify's CDN does not key its cache on the whole URL. The Next.js runtime sets
        // `netlify-vary: query=__nextDataReq|_rsc`, so only those two parameters form part of the key --
        // ?q=80C and ?q=LODR are the same entry. With a public Cache-Control and without this line, the
        // first search of the minute was cached and then returned to everyone: every query answered with
        // somebody else's suggestions, at a convincing 140ms.
        "Netlify-Vary": "query=q",
      },
    },
  );
}
