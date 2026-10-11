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
 * `/status` and `/quality` are maintenance screens. They are public on purpose -- anyone may audit how the
 * collection is doing -- but they describe the machinery rather than the law, and a search for an Act should
 * never land on a table of failed jobs. Disallow keeps them out of the index without hiding them from a
 * person who is given the link.
 *
 * `/search` and `/find` are excluded for the ordinary reason: a search results page is a different page for
 * every query, so it is an infinite crawl surface and the results it holds are already indexed as themselves.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/status", "/quality", "/search", "/find"],
      },
    ],
    sitemap: abs("/sitemap.xml"),
  };
}
