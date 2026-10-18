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
          /* Every /browse/ URL carrying a query string, which is every provision.
           *
           * Taking them out of the sitemap stops Google finding more; it does not stop it recrawling the
           * 4,464 it already has, and this does. Blunt on purpose -- those pages are uncached and a crawl
           * of them is what paused the site -- and narrow enough to leave the pages that are cheap:
           * /browse, /browse/:slug and /browse/:slug/text all have no query string and stay crawlable.
           *
           * Remove this line at the same time as flipping INCLUDE_PROVISIONS in sitemap.ts, and only once
           * the caching in middleware.ts is confirmed working on the live site. One without the other is
           * either a sitemap advertising pages Google may not fetch, or an invitation to repeat October.
           */
          "/browse/*?*",
        ],
      },
    ],
    sitemap: abs("/sitemap.xml"),
  };
}
