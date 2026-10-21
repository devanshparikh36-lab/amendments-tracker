import type { MetadataRoute } from "next";
import { abs } from "@/lib/site";

/* What a crawler may read, and where the map is.
 *
 * Everything that is a page for a reader is open: the whole point of publishing statutory text is that
 * someone searching for "section 80C" finds it. What is closed divides into two kinds.
 *
 * `/api/` is machine plumbing -- suggest and sections are called per keystroke, the exports are rate-limited
 * CSV. A crawler walking them would burn the free-tier allowances on responses that are useless in a result
 * page, and `/api/suggest?q=` in particular is an unbounded space of URLs.
 *
 * `/status` and `/quality` are operational screens rather than public reports. /status moved behind
 * ADMIN_KEY on 15 October 2026; /quality is still reachable but is listed here so neither is indexed.
 * Disallowing them is about keeping crawlers off pages that are expensive and uninteresting, not about
 * secrecy -- robots.txt protects nothing, which is why /status has a key and not just a disallow.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/status",
          "/quality",
          "/search",
          "/find",
          "/you",
          "/admin",
          /* The blanket block on /browse/*?* is gone, and provisions are crawlable again.
           *
           * It went in on 18 Oct to stop Google recrawling 4,464 uncached provision pages, which is what
           * paused the site. Provisions are no longer at a query-string address: they are
           * /browse/ita-1961/text/80c, which prerenders and is served from the CDN, confirmed on the live
           * site at `Durable: hit`. A crawl of them is now cheap, so blocking them only hides the
           * statutory text this site exists to publish.
           *
           * Nothing replaces it, deliberately. The query-string addresses that remain -- the point-in-time
           * view and the PDF reader's search -- are reachable only from a form, are not linked, and are
           * not in the sitemap, so there is nothing for a crawler to walk into. Adding a rule for them
           * would be guarding a door nobody can find.
           */
        ],
      },
    ],
    sitemap: abs("/sitemap.xml"),
  };
}
