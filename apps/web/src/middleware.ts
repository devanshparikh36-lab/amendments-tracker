import { NextResponse, type NextRequest } from "next/server";

/* Let the CDN answer for the reading view, instead of a function answering every time.
 *
 * The second attempt at this. The first put the headers in netlify.toml and did nothing: the response
 * still came back "Netlify Durable: fwd=bypass, Netlify Edge: fwd=miss" on repeat requests, and the
 * Netlify-Vary in the response was still the Next runtime's own value rather than the one that file set.
 * That is the tell -- netlify.toml adds headers to a response, it does not override headers the function
 * already emits, and the Next function emits both Cache-Control and Netlify-Vary itself. The security
 * headers in that file work precisely because Next sets nothing of that name.
 *
 * Middleware runs as part of the response rather than as a rule applied beside it, so what it sets is in
 * the response the CDN evaluates. That is the difference, and it is the reason to accept middleware's cost
 * -- it runs on every matched request -- rather than keep trying variations of a mechanism that cannot win.
 *
 *
 * Why the reading view needs this at all.
 *
 * Those pages are `force-dynamic`, because they read their query string, and Next marks a dynamic route
 * `no-store`. Measured on production, two consecutive requests for the same provision both missed, so
 * every hit ran a function and queried Postgres. Tolerable when the only visitors were people. Not
 * tolerable once 4,464 provision URLs went into the sitemap and Google was invited to crawl them, each
 * crawl and every recrawl paying full price.
 *
 * Netlify-CDN-Cache-Control rather than Cache-Control: it instructs Netlify's CDN and leaves the no-store
 * Next sends to the browser alone, so there is no contest over which header wins. Readers still get a
 * fresh page; the CDN stops asking a function for one it already holds.
 *
 * An hour, with a day of stale-while-revalidate. Collection runs once each morning, so statutory text
 * cannot change more often, and the staleness window means a crawl spike is served from cache while a
 * single request refreshes it.
 *
 * Safe to cache for everyone because nothing in the server render is reader-specific: follows, bookmarks,
 * notes and the greeting are client components that fetch their own state after load. Checked rather than
 * assumed -- the page component reads no reader identity and no cookies.
 *
 *
 * EVERY PARAMETER THAT CHANGES THE PAGE MUST BE IN Netlify-Vary.
 *
 * Netlify keys its cache on the parameters this names and no others. Omitting one does not mean "ignore
 * it", it means "treat two different pages as one" -- which on the definitions suggester served a single
 * prefix's answers to everybody for an hour, and here would serve one section's text under another
 * section's URL. The five below are the complete set the reading view reads:
 *
 *   p      which provision        asOn   the point-in-time view
 *   view   full text vs single    page   which page of a PDF-only instrument
 *   pq     the in-PDF search term
 *
 * Add a parameter to that page and add it here in the same change.
 */

const CDN_CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";
const VARY = "query=p|asOn|view|page|pq";

export function middleware(_request: NextRequest) {
  const res = NextResponse.next();
  res.headers.set("Netlify-CDN-Cache-Control", CDN_CACHE);
  res.headers.set("Netlify-Vary", VARY);
  return res;
}

/* Only the reading view and the instrument pages.
 *
 * Deliberately not a catch-all with exclusions. Middleware that runs everywhere is middleware that has to
 * be reasoned about on every route -- including /admin, /status, /you and the account API, where a cached
 * response would be a disclosure rather than a saving. A narrow matcher cannot make that mistake.
 *
 * /browse itself is excluded as well: it carries the filter form, whose parameters are a different set,
 * and it is one page rather than four thousand.
 */
export const config = {
  matcher: ["/browse/:slug/text", "/browse/:slug"],
};
