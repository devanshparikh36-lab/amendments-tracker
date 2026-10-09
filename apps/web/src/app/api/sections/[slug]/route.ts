import { NextResponse } from "next/server";
import { getInstrument, listProvisionIndex } from "@/lib/queries";

export const dynamic = "force-dynamic";

// The full contents list for an instrument, fetched by the sidebar after the page has rendered.
//
// The reading view used to receive all 935 sections as props, which meant they were written into the HTML and
// serialised again for hydration -- the list paid for twice, 600 KB for a single section. Now the page ships a
// short window around what you are reading and the rest arrives here, so the first paint carries the provision
// you asked for rather than the table of contents.
//
// As public as the page that calls it, which is the whole site: the passcode gate was removed on 14 Sept 2026
// because everything served here is already public -- the regulators' own documents.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const inst = await getInstrument(slug);
  if (!inst) return NextResponse.json({ error: "unknown instrument" }, { status: 404 });

  const index = await listProvisionIndex(inst.id);
  const items = index.map((i) => ({
    id: i.id,
    number: i.number,
    level: i.level,
    machine: i.machine,
    differs: i.differs,
    heading: i.heading && i.heading.length > 80 ? `${i.heading.slice(0, 80)}…` : i.heading,
  }));
  return NextResponse.json(
    { items },
    {
      // `public`, not `private`, and that one word is the whole cost of this route.
      //
      // The sidebar asks for this on every page within an instrument, and `private` tells the CDN it may not
      // store the response -- so it was held only in each reader's own browser, and every new reader, and
      // every reader after ten minutes, cost a function invocation Netlify's edge could have answered for
      // nothing. There is nothing per-visitor in here to protect: it is a list of section numbers and
      // headings from an Act, identical for everyone, and the passcode gate that might once have argued for
      // caution was removed on 14 Sept 2026.
      //
      // Same shape as /api/suggest, with one difference: no Netlify-Vary is needed. Netlify's CDN drops
      // query parameters from the cache key unless told otherwise, which is the trap that route documents --
      // but the slug here is a path segment, and path segments are always part of the key.
      headers: { "cache-control": "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400" },
    },
  );
}
