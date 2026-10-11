"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/* Tells the counter which page is being read. Sends a path and nothing else.
 *
 * What it deliberately does not do, because each one would change what the privacy page is able to say:
 * no cookie, no localStorage, no identifier of any kind, no referrer, no screen size, no timing, no
 * query string. There is nothing here to tie two views together, which is also why the site can report
 * views and cannot report visitors -- an honest limitation rather than a gap to close later.
 *
 * It runs on navigation as well as first load. This is a single-page app once hydrated, so moving from one
 * section to the next never reloads the document; without watching the pathname, a reader working through
 * forty provisions would count as one view of the first.
 */
export function PageViews() {
  const path = usePathname();
  // Strict Mode runs effects twice in development, and Next re-runs this one whenever the pathname object
  // identity changes. Both would double-count. The last path actually sent is the guard.
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!path || sent.current === path) return;
    sent.current = path;

    const body = JSON.stringify({ path });
    try {
      // sendBeacon is the right tool: the browser takes the request and sends it on its own schedule, so it
      // survives the reader clicking away immediately -- which is the view most worth counting -- and it
      // never competes with the page's own fetches.
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/beacon", new Blob([body], { type: "application/json" }));
        return;
      }
      // Safari below 15.4 has no sendBeacon for a Blob body. keepalive does the same job.
      void fetch("/api/beacon", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* a counter must never break a page */
    }
  }, [path]);

  return null;
}
