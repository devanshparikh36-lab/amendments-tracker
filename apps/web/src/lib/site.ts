/* Where this site lives, for the handful of places that need an absolute URL.
 *
 * Most of the app never needs one: links are relative, and `feed.xml` and `CiteThis` both take the origin
 * from the request they are answering, which is correct for them and needs no configuration.
 *
 * Three things cannot do that, because nothing is asking them anything: `sitemap.ts` and `robots.ts` are
 * generated, and `metadataBase` is read while rendering `<head>` for a page whose Open Graph tags must carry
 * a full URL (a relative og:image is ignored by every scraper there is).
 *
 * Resolution order, most specific first:
 *   NEXT_PUBLIC_SITE_URL  set it if the site ever moves to a custom domain; nothing else needs changing
 *   URL                   Netlify sets this to the site's primary address during a build, including when
 *                         `netlify build` runs on the GitHub runner, which is how this site is built
 *   the literal below     so a local `next build` produces a correct sitemap rather than one full of
 *                         `undefined`, which is the failure mode that is easy to ship and hard to notice
 */
const FALLBACK = "https://as-amended.netlify.app";

function resolve(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || FALLBACK;
  const withScheme = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, ""); // never a trailing slash: every caller appends one
}

export const SITE_URL = resolve();

/** Absolute URL for a path that starts with "/". */
export function abs(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
