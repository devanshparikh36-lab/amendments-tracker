import { timingSafeEqual } from "node:crypto";

/* The admin gate, in one place because there are now two doors.
 *
 * It was a function inside the admin page, which was right while the page was the only thing behind it.
 * Adding a route that can write -- create a reader, delete one and everything they have saved -- means a
 * second check, and two copies of an access check drift. The one that drifts is never the one being read.
 *
 * ADMIN_KEY is set in Netlify (Project configuration > Environment variables) and cannot live in the
 * repository, which is public. With it unset this refuses everyone including the owner, which is the right
 * way round for a page that is otherwise world-readable.
 */

export function authorised(given: string | undefined | null): boolean {
  const want = process.env.ADMIN_KEY;
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  // Length first and separately: timingSafeEqual throws on a length mismatch rather than returning false,
  // and the length of a secret is not the part worth hiding.
  return a.length === b.length && timingSafeEqual(a, b);
}

export const MAX_EMAIL = 254;

/** The same shape the reader routes accept, so an address cannot be valid in one place and not the other. */
export function validEmail(v: string): boolean {
  return v.length >= 5 && v.length <= MAX_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}
