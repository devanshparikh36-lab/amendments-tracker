import { notFound, redirect } from "next/navigation";
import { slugifyNumber } from "@/lib/format";
import { getInstrument, listProvisionIndex } from "@/lib/queries";
import { ReadingView, readingMetadata } from "../_reading";

/* One provision, at an address with no question mark in it. The reason the site is affordable.
 *
 * `/browse/ita-1961/text?p=80C` reads the query string, which makes Next mark the route dynamic and send
 * `private, no-cache, no-store`. Netlify's CDN obeys that header: measured on production, every request
 * came back `Netlify Durable: fwd=bypass`, so each one started a function, opened a connection to Neon and
 * ran six queries -- 3.1 seconds of database work -- then threw the result away. The next reader of the
 * same section paid it again.
 *
 * That is survivable for readers, who return to a handful of sections, and fatal for a crawler, which never
 * asks for the same page twice. 4,464 provision URLs in the sitemap was ~27,000 queries in a burst, and it
 * emptied the account in October. The pages have been robots-disallowed and out of the sitemap ever since,
 * which is to say the statutory text this site exists to publish has been unfindable.
 *
 * This route reads no query string at all, so it prerenders and the CDN holds it. The evidence it works was
 * already here before the change: /browse/ita-1961/80c/history has always been path-based, and a second
 * request for it answers `Durable: hit; ttl=594` while the query form answers `fwd=bypass`. Same site, same
 * database, same provision -- the only difference is the shape of the address.
 *
 * WHAT MUST NOT COME BACK. Anything that reads searchParams here makes the route dynamic again and undoes
 * all of it, silently -- the page keeps working and only the Cache-Status header changes. The point-in-time
 * view, the whole-Act view and the PDF reader keep their parameters and keep their dynamic route next door;
 * they are rare, they are not in the sitemap, and nothing crawls them.
 */

export const revalidate = 3600;

/* Nothing prerendered at build, everything cached on first request.
 *
 * The same arrangement as [prov]/history, and for the same reason: 5,606 provisions would make every
 * deploy absurd to prepare pages nobody opens, but a segment with parameters and no generateStaticParams
 * at all is treated as fully dynamic and sends no-store -- which is the bug this file exists to fix.
 * Declaring the function and returning nothing from it puts the route on the static path, so each
 * provision is rendered once on first request and then served from the CDN for an hour.
 */
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

type Params = Promise<{ slug: string; prov: string }>;

/* Resolve the slug in the URL back to the provision it names.
 *
 * Slugified rather than percent-encoded because provision numbers are not URL-safe: 'Schedule 1' and
 * '1 (Annex 10)' are real numbers in this corpus and a space or a slash in a path segment means something
 * else. listProvisionIndex rather than getProvision for the same reason the history page uses it -- the
 * lookup is from slug back to number, which only the index can do, and it carries no provision text.
 *
 * Both calls are shared with the page body below and with generateMetadata: db/index.ts wraps reads in
 * React's cache(), so all three resolve to one round trip per render. And a render happens once an hour
 * per provision, not once per reader, which is the entire change.
 */
async function resolve(slug: string, prov: string) {
  const inst = await getInstrument(slug);
  if (!inst) notFound();
  const index = await listProvisionIndex(inst.id);
  const match = index.find((p) => slugifyNumber(p.number) === prov);
  return { inst, match };
}

export async function generateMetadata({ params }: { params: Params }) {
  const { slug, prov } = await params;
  const { match } = await resolve(slug, prov);
  if (!match) return { title: "Not found" };
  return readingMetadata(slug, { p: match.number });
}

export default async function ProvisionPage({ params }: { params: Params }) {
  const { slug, prov } = await params;
  const { inst, match } = await resolve(slug, prov);

  /* A PDF-only instrument has no provisions to address, so this URL cannot mean anything on one. Sending
   * the reader to the instrument's own reading view is better than a 404: they asked for text that exists,
   * just not split into sections the regulator never published. */
  if (inst.pdf_only) redirect(`/browse/${slug}/text`);

  /* A number that resolves to nothing is a real 404, decided here, before any JSX is returned and so before
   * the Suspense boundary inside ReadingView starts the response. Settle the status above the boundary or
   * it cannot be set at all -- app/definitions/loading.tsx has the full reasoning. */
  if (!match) notFound();

  return <ReadingView slug={slug} sp={{ p: match.number }} />;
}
