import { provisionHref } from "@/lib/format";
import type { MetadataRoute } from "next";
import { query } from "@/db";
import { abs } from "@/lib/site";

/* Every page worth indexing, with the date it last changed.
 *
 * Regenerated at most once a day, which is also how often collection runs: nothing here can change more
 * often than the thing it describes. Without this the route is dynamic and every crawler visit is a function
 * invocation and two queries -- and crawlers visit a sitemap far more eagerly than a person visits a page.
 */
export const revalidate = 86400;

/* Provision URLs are back in the sitemap, and the condition that kept them out has been met.
 *
 * They went in on 16 Oct -- 4,464 of them -- and they are the pages a practitioner actually searches for:
 * "section 80C income tax act" is a query, "Income-tax Act, 1961" is not. They were also uncached, so
 * every crawl of one ran a function and queried Postgres. Google found them, crawled hard, and in three
 * days put 49,000 extra requests and 72 extra compute credits through a free tier with 300 in it. The
 * site was paused mid-month with everything down, and they came out on 18 Oct.
 *
 * The rule written here then was: turn them back on only once two consecutive requests to the same
 * provision show "Netlify Durable: hit" rather than "fwd=bypass" on the live site. That is now true, and
 * it is true because the address changed rather than because a header did. A provision is
 * /browse/ita-1961/text/80c, which reads no query string, so Next prerenders it and the CDN holds it.
 * Measured on production after deploying it: `Durable: hit; ttl=587` on a repeat request, and an edge hit
 * at 0.29s. The query form that replaced it redirects.
 *
 * The same rule still applies to anything added here later. A page that is cheap to crawl belongs in a
 * sitemap and a page that is not does not, and the only way to know which it is is to ask the live site.
 */
const INCLUDE_PROVISIONS = true;

type Row = { loc: string; changed: string | null };
type ProvisionRow = { slug: string; number: string; changed: string | null };

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // The fixed pages. `/status` and `/quality` are absent deliberately -- robots.ts disallows them, and a
  // sitemap entry for a disallowed path is a contradiction a crawler reports as an error.
  const fixed: MetadataRoute.Sitemap = [
    { url: abs("/"), changeFrequency: "daily", priority: 1 },
    { url: abs("/browse"), changeFrequency: "daily", priority: 0.9 },
    { url: abs("/documents"), changeFrequency: "daily", priority: 0.9 },
    { url: abs("/definitions"), changeFrequency: "weekly", priority: 0.7 },
    { url: abs("/compare/income-tax"), changeFrequency: "monthly", priority: 0.6 },
    { url: abs("/about"), changeFrequency: "monthly", priority: 0.4 },
    { url: abs("/privacy"), changeFrequency: "yearly", priority: 0.2 },
    { url: abs("/cookies"), changeFrequency: "yearly", priority: 0.2 },
    { url: abs("/terms"), changeFrequency: "yearly", priority: 0.2 },
  ];

  // Two queries rather than the page helpers: this needs a slug and a date and nothing else, and
  // `instrumentIndex` carries counts and joins that would be computed and thrown away.
  let instruments: Row[] = [];
  let documents: Row[] = [];
  let provisions: ProvisionRow[] = [];
  try {
    [instruments, documents, provisions] = await Promise.all([
      query<Row>(
        `SELECT i.slug AS loc,
                to_char(GREATEST(
                  COALESCE(i.official_updated_as_on, DATE '1970-01-01'),
                  COALESCE(MAX(pv.created_at)::date, DATE '1970-01-01')
                ), 'YYYY-MM-DD') AS changed
           FROM instrument i
           LEFT JOIN provision p ON p.instrument_id = i.id
           LEFT JOIN provision_version pv ON pv.provision_id = p.id AND pv.effective_to IS NULL
          GROUP BY i.slug, i.official_updated_as_on
          ORDER BY i.slug`,
        [],
        86400,
      ),
      query<Row>(
        `SELECT d.id::text AS loc, to_char(d.date_issued, 'YYYY-MM-DD') AS changed
           FROM document d
          WHERE d.date_issued IS NOT NULL
          ORDER BY d.date_issued DESC
          LIMIT 20000`,
        [],
        86400,
      ),
      /* Every provision that holds real text.
       *
       * These are the pages people actually search for -- "section 80C income tax act" is a query, and
       * "Income-tax Act, 1961" is not. Until this was added the Act had exactly one URL in the sitemap and
       * its five hundred sections had none, so the most valuable thing the site holds was the one thing a
       * search engine could not reach.
       *
       * The length filter is deliberate rather than tidy. A provision carrying a heading and two lines --
       * an omitted section, a definition stub, a bare cross-reference -- is a page with nothing on it, and
       * submitting thousands of those is how a site teaches Google that its sitemap is not worth reading.
       * 200 characters is roughly a paragraph.
       *
       * PDF-only instruments are excluded: their provision rows are deleted at seed time, so there is no
       * text to land on.
       */
      !INCLUDE_PROVISIONS ? Promise.resolve([] as ProvisionRow[]) : query<ProvisionRow>(
        `SELECT i.slug, p.number,
                to_char(MAX(v.created_at)::date, 'YYYY-MM-DD') AS changed
           FROM provision p
           JOIN instrument i ON i.id = p.instrument_id AND NOT i.pdf_only
           JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
          WHERE v.text IS NOT NULL AND length(v.text) > 200
          GROUP BY i.slug, p.number, p.sort_key
          ORDER BY i.slug, p.sort_key
          LIMIT 30000`,
        [],
        86400,
      ),
    ]);
  } catch {
    // A sitemap listing the fixed pages is worth serving; a 500 teaches the crawler to stop asking.
    return fixed;
  }

  const lm = (s: string | null) => (s && s > "1970-01-01" ? new Date(s) : undefined);

  return [
    ...fixed,
    // Both views of an instrument: the overview is the landing page, the text is the one people cite.
    ...instruments.flatMap((i) => [
      { url: abs(`/browse/${i.loc}`), lastModified: lm(i.changed), changeFrequency: "weekly" as const, priority: 0.8 },
      { url: abs(`/browse/${i.loc}/text`), lastModified: lm(i.changed), changeFrequency: "weekly" as const, priority: 0.8 },
    ]),
    /* The provision pages, as the query-string URL the site actually serves.
     *
     * A crawler is perfectly happy with a query string; what it cannot do is guess one. Each of these
     * declares itself canonical in generateMetadata, so the ?asOn= and ?view=full variants of the same
     * provision fold into this entry rather than competing with it.
     */
    ...(INCLUDE_PROVISIONS ? provisions : []).map((v) => ({
      url: abs(provisionHref(v.slug, v.number)),
      lastModified: lm(v.changed),
      changeFrequency: "monthly" as const,
      // Above a notification and below an instrument's landing page: a section is what somebody came for,
      // but the Act it belongs to is the better entry point when they have not named one.
      priority: 0.7,
    })),
    ...documents.map((d) => ({
      url: abs(`/documents/${d.loc}`),
      lastModified: lm(d.changed),
      // A notification is issued once and never revised. Saying "monthly" invites a crawler to keep checking
      // thousands of pages that will never differ.
      changeFrequency: "yearly" as const,
      priority: 0.5,
    })),
  ];
}
