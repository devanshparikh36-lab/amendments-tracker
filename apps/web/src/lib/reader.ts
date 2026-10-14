/* Who the reader says they are, kept in the browser.
 *
 * The whole identity mechanism is this file plus one column. A reader types an email, it goes in
 * localStorage, and it is sent with the handful of requests that need to know whose watchlist to touch.
 * There is no password, no magic link, no session and no cookie.
 *
 * localStorage rather than a cookie, and that is a deliberate architectural choice rather than a detail.
 * A cookie would travel with every request, which would let pages be personalised on the server -- and
 * would stop every one of them being cacheable, because a cached page cannot contain one reader's name.
 * The site is fast and free precisely because its pages are prerendered and shared. Keeping identity out
 * of the request means the HTML stays identical for everyone and the personal parts arrive afterwards,
 * client-side. The cost is a beat before "Hi, Devansh" appears. The alternative was paying for compute on
 * every page view for ever.
 *
 * It also means the "no cookie" line in the privacy notice survives intact, which is worth something on a
 * site that has made a point of it.
 *
 * Every access is wrapped: localStorage throws outright in some privacy modes rather than returning null,
 * and an identity helper must not be able to break the page it sits on.
 */

const KEY = "as-amended-reader";

export type Reader = { email: string; name?: string };

/** Lowercased and trimmed, so that the same person typing differently finds the same row. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/* Deliberately permissive. This is not a verification step -- nothing is proven by an address matching a
 * pattern, and the site does not care whether it can receive mail until the reader asks it to send some.
 * It exists to catch a mistyped address before it becomes a second, orphaned watchlist. */
export function looksLikeEmail(raw: string): boolean {
  const v = normaliseEmail(raw);
  return v.length >= 5 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export function readReader(): Reader | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Reader;
    return v && typeof v.email === "string" && v.email ? v : null;
  } catch {
    return null;
  }
}

export function writeReader(r: Reader): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ email: normaliseEmail(r.email), name: r.name || undefined }));
  } catch {
    /* the identity will not survive the tab; the page still works */
  }
  announce();
}

export function clearReader(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
  announce();
}

/* One event, so that everything showing the reader's name updates together.
 *
 * The masthead greeting, the drawer and any follow button on the page all read the same value, and they
 * are siblings rather than parent and child -- so a React state update in one cannot reach the others.
 * A window event is the simplest thing that does, and it costs nothing when nobody is listening.
 *
 * `storage` fires only in *other* tabs, never the one that wrote, so it cannot be used for this on its
 * own -- though listening to both is what keeps two open tabs agreeing. */
const EVENT = "as-amended-reader-change";

function announce() {
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* not a browser */
  }
}

export function onReaderChange(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/* What to call someone before they have told us.
 *
 * The part of an address before the @, tidied and capitalised: "devansh.parikh36" becomes "Devansh".
 * A greeting is warmer than an address and an address is better than nothing, but neither is as good as
 * the name they choose -- which is why the drawer asks for one. */
export function displayName(r: Reader | null): string {
  if (!r) return "";
  if (r.name && r.name.trim()) return r.name.trim();
  const local = r.email.split("@")[0] || "";
  const first = local.split(/[._\-+0-9]+/).filter(Boolean)[0] || local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : r.email;
}

/* Recently viewed, which needs no account at all.
 *
 * Kept here beside the identity because it is the same storage and the same caveats, but note that it
 * works for a reader who has never typed anything -- it is per-device by nature, and sending it to the
 * server would turn a convenience into a record of what someone read. */
const SEEN_KEY = "as-amended-seen";
export type Seen = { href: string; label: string; at: number };

export function pushSeen(entry: Omit<Seen, "at">): void {
  try {
    const now = Date.now();
    const list: Seen[] = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]");
    const next = [{ ...entry, at: now }, ...list.filter((s) => s.href !== entry.href)].slice(0, 12);
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    /* nothing to do */
  }
}

export function readSeen(): Seen[] {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]") as Seen[];
    return Array.isArray(list) ? list.filter((s) => s && typeof s.href === "string") : [];
  } catch {
    return [];
  }
}

export function clearSeen(): void {
  try {
    localStorage.removeItem(SEEN_KEY);
  } catch {
    /* nothing to do */
  }
}
