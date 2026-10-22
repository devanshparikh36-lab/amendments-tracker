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
          /* Every /browse/ URL carrying a query string. Back, and this time for the right reason.
           *
           * It was removed on 21 Oct on the reasoning that the only query-string addresses left were the
           * point-in-time view and the PDF search, "reachable only from a form, not linked, not in the
           * sitemap". That was wrong, and expensively so. `?view=full` -- the whole-Act view -- is linked
           * from a "Read full text" button on all 196 instrument pages, and it is the single most
           * expensive render on the site: 22 seconds, dynamic, uncached by design because it reads the
           * query string. Removing this line invited Google to crawl 196 of those, and to walk the 4,464
           * old ?p= addresses still in its index, each of which burns a function just to answer a 307.
           *
           * Compute went from 27 credits to 105.6 in a day, out of a 300-credit cycle. The same shape as
           * October, from the same cause: uncached dynamic pages, crawled.
           *
           * It does NOT block provisions. Those are /browse/ita-1961/text/80c -- no query string -- so
           * they stay crawlable and stay in the sitemap, which is the whole point of having moved them.
           * This line only closes the query-string doors that were never cheap to open.
           *
           * Before removing it again: every query-string route under /browse must be cacheable, and that
           * has to be proved on the live site rather than reasoned about. `?view=full` would need a path
           * of its own, the way provisions got one.
           */
          /* And, for this billing cycle only, all of /browse.
           *
           * Blocking the query string alone stops the expensive renders but not the bandwidth. Google
           * already holds the 4,464 provision URLs and will keep recrawling them, and bandwidth is
           * charged per byte whether the CDN served it or a function did -- 15.2 credits of it in a
           * single day. With 13 credits to cover 27 days, that is the line that decides whether the site
           * stays up.
           *
           * This is a budget measure, not a correction. The provision pages are cached and correct and a
           * crawl of them is genuinely cheap in compute; what cannot be afforded right now is the traffic
           * itself. Human readers are unaffected -- robots.txt binds crawlers, not browsers, and nothing
           * here changes what a person can open.
           *
           * REMOVE THIS ON 18 NOVEMBER, when the cycle resets to 300 credits, together with putting the
           * provisions back in sitemap.ts. Keep the /browse/*?* line below it: that one is permanent, and
           * the reason it exists is written there.
           */
          "/browse/",
          "/browse/*?*",
        ],
      },
    ],
    sitemap: abs("/sitemap.xml"),
  };
}
