import { redirect } from "next/navigation";
import { slugifyNumber } from "@/lib/format";
import { ReadingView, readingMetadata, type ReadingParams } from "./_reading";

/* The contents list, the whole-Act view, the point-in-time view and the PDF reader.
 *
 * Everything served here reads the query string, so this route is dynamic and uncached, and that is the
 * right answer for all four: one page per instrument rather than one per provision, none of them in the
 * sitemap, and nothing crawls them. The 4,464 pages that made uncached rendering ruinous are provisions,
 * and they moved to [prov]/, which has no query string and caches. That file carries the measurements.
 *
 * No `export const dynamic` here on purpose. Reading searchParams is what makes this route dynamic and the
 * honest reason it is; a blanket setting would state the same thing less truthfully, and this project has
 * shipped force-dynamic twice as a cache fix that it never was.
 */

type Params = Promise<{ slug: string }>;
type Search = Promise<ReadingParams>;

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const sp = await searchParams;
  return readingMetadata(slug, sp);
}

export default async function InstrumentTextPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const sp = await searchParams;

  /* Old provision links, sent to where provisions live now.
   *
   * `?p=` was the address of every section on this site until this change, so it is the address in readers'
   * bookmarks, in digests already sent, in the Atom feed and in anything anyone has cited. A citation to
   * statutory text that stops resolving is worse than an uncached page, so it redirects rather than 404s.
   *
   * Next's redirect() answers a GET with 307. That is deliberate and not worth fighting: 308 would let a
   * search engine transfer whatever the old URL earned, but these URLs earned nothing -- they have been
   * robots-disallowed and out of the sitemap since October, so there is nothing to carry over, and a 307
   * is the one Next gives without a custom response.
   *
   * ONLY when there is no asOn. The point-in-time view genuinely needs a parameter, and the path route
   * reads none, so redirecting it there would answer a question about 2019 with today's text -- a wrong
   * answer that looks like a right one, which is the failure mode this codebase keeps having to design
   * against. It stays here instead: dynamic, uncached, rare, uncrawled, and correct.
   *
   * Decided before any JSX is returned, so it is a real 307 and not a redirect rendered under a 200. A
   * Suspense boundary commits the status with its first flush; app/definitions/loading.tsx has the full
   * reasoning and is worth reading before changing the order of anything in this function.
   */
  if (sp.p && !sp.asOn) redirect(`/browse/${slug}/text/${slugifyNumber(sp.p)}`);

  return <ReadingView slug={slug} sp={sp} />;
}
