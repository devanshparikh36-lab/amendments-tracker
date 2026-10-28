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
        /* Everything. Until 6 November at the earliest, and this is a budget measure rather than a view
         * about search.
         *
         * The site is not trying to be found at the moment -- provisions came out of the sitemap on 22
         * October and the owner has since decided against search for now -- so every crawl is spending a
         * budget to deliver something nobody asked for. Four rounds of narrowing the rules each removed
         * the surface that had just been noticed and left the next one: ?view=full, then the filtered
         * document list, then the bare /browse the trailing slash never covered, then 8,044 cached
         * /documents/<id> pages whose background revalidations cost a full render each while answering
         * fast enough to look free.
         *
         * At 38 credits a day against 40 remaining, the next miss is not survivable, so the rule is no
         * longer "block what we found" but "allow nothing". A list of exceptions is what produced four
         * misses; an empty allowance cannot be incomplete.
         *
         * READERS ARE UNAFFECTED. robots.txt binds crawlers, not browsers. Every page still serves to
         * anyone with a link, the digest still sends, collection still runs.
         *
         * TO REVERSE, once the credits allow and ?view=full has a cacheable path of its own: restore the
         * per-path rules below rather than simply deleting this. They are kept, commented, because each
         * one is a thing that cost money to learn:
         *
         *     "/api/", "/status", "/quality", "/search", "/find", "/you", "/admin",
         *     "/browse", "/browse/*?*", "/documents?", "/definitions?",
         *     "/compare/income-tax?", "/feed.xml?", "/?*", "/confirm", "/unsubscribe",
         *
         * and /documents/ needs one too, or its revalidations return with the crawl.
         */
        disallow: [
          "/",
        ],
      },
    ],
    /* No sitemap line. A sitemap exists to invite crawling, and there is nothing here to invite it to --
     * sitemap.ts still serves at /sitemap.xml for anyone who asks, it is simply no longer advertised. */
  };
}
