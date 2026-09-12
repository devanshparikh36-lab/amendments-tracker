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
// Behind the passcode gate like every other route: the middleware matches this path, so it is no more public
// than the page that calls it.
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
    // The contents of an Act change only when collection re-reads it, so this is safe to hold for a while,
    // and holding it is the point: the sidebar asks for it on every page within the instrument.
    { headers: { "cache-control": "private, max-age=600" } },
  );
}
