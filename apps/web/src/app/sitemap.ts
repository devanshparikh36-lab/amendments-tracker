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

type Row = { loc: string; changed: string | null };

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
  try {
    [instruments, documents] = await Promise.all([
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
