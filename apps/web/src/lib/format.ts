export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00Z" : d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

// An instant, shown in IST. The zone has to be named: "en-IN" chooses how the date is written, not
// which clock it is written from, and with no timeZone the runtime's own zone is used -- UTC on
// Netlify. The site read "Last checked 14 Oct 2026, 02:23 am" for a collection that ran at 07:53 IST,
// which is that same instant five and a half hours earlier, and made the collector look like it ran
// in the middle of the night.
//
// fmtDate above pins UTC instead, and that is right rather than inconsistent: those are date-only
// values, and anchoring them anywhere east of UTC would roll a date into the previous day.
export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

// Every subject shares this list, so the labels stay generic: a CBDT notification is not a FEMA one.
export const DOC_TYPE_LABEL: Record<string, string> = {
  notification: "Notification",
  gsr: "Gazette (GSR)",
  apdir_circular: "A.P. (DIR Series) Circular",
  master_direction: "Master Direction",
  act: "Act",
  rules: "Rules",
  press_release: "Press release",
  faq: "FAQ",
  other: "Other",
};

export function slugifyNumber(n: string): string {
  return n.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* Kept here, with slugifyNumber, and deliberately not in lib/lookup.ts.
 *
 * lookup.ts reaches the database. SectionFilter is a client component and builds these links, so
 * importing from there pulled pg into the browser bundle and the build failed on `Can't resolve 'fs'`.
 * This is a pure string function; it belongs with the other pure string functions.
 */
/* The canonical address of one provision, and the reason it is a path rather than a query string.
 *
 * `?p=80C` made the reading view dynamic -- Next marks any route that reads the query string `no-store`,
 * Netlify's CDN obeys that and answers `fwd=bypass`, and every single view of every section therefore ran
 * a function and six queries against Neon. Measured: 3.1s of database work per view, discarded, repeated
 * for the next reader. A crawl of the 4,464 provision URLs was 27,000 queries in a burst, which is what
 * emptied the account in October and took the pages out of the sitemap.
 *
 * A path has no query string, so the route prerenders and the CDN holds it. Proven on this codebase before
 * the change: /browse/ita-1961/80c/history, which was already path-based, answered `Durable: hit` on a
 * second request while /browse/ita-1961/text?p=80C answered `fwd=bypass` every time.
 *
 * `slugifyNumber` rather than encodeURIComponent, because a provision number is not URL-safe -- 'Schedule 1'
 * and '1 (Annex 10)' are real numbers here and a slash or a space in a path segment is a different route.
 * The same slug the history page has always used, so the two agree and a reader can edit one into the other.
 * It is not quite injective: 18 of 5,606 numbers collide within their instrument, nearly all of them case
 * variants of the same schedule ('SCHEDULE 2' and 'Schedule 2'), plus a handful like '3 (2)' against '3.2'.
 * Resolution takes the first match, so those land on a real provision rather than a 404, and the pair was
 * already ambiguous on the history route.
 *
 * `extra` starts with `?` now, not `&`. It used to be appended to a query string and is now appended to a
 * path, and the old `&asOn=` form would have produced `/text/80c&asOn=…` -- one path segment, no parameter,
 * silently serving today's text under a date the reader chose.
 */
export function provisionHref(slug: string, number: string, extra?: string): string {
  return `/browse/${slug}/text/${slugifyNumber(number)}${extra ?? ""}`;
}
