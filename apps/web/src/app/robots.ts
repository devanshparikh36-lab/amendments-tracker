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
        disallow: ["/api/", "/status", "/quality", "/search", "/find", "/you", "/admin"],
      },
    ],
    sitemap: abs("/sitemap.xml"),
  };
}
