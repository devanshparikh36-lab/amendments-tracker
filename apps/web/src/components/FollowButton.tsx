"use client";

import { useCallback, useEffect, useState } from "react";
import { onReaderChange, readReader } from "@/lib/reader";
import { BellIcon, BookmarkIcon } from "@/components/icons";

/* Follow and Bookmark: the same control twice, with different intent.
 *
 * Follow  tell me when something lands against this
 * Bookmark keep this where I can find it again
 *
 * They are independent on purpose. Unfollowing a section must not silently throw away a bookmark on it,
 * and a reader who wants both gets both.
 *
 * Rendered on a page that is prerendered and shared by everyone, so neither button can know its own state
 * in the HTML -- "Following" is a fact about one reader and the page is a fact about the law. Both start
 * neutral and correct themselves once the reader's list has loaded. That is the same bargain the greeting
 * makes, for the same reason: no cookie, no per-reader render, no cost per view.
 *
 * Someone who has not signed in still sees both. Hiding them would be the obvious choice and the wrong
 * one -- they are the only things on the page that explain why an address is worth typing. Pressing one
 * opens the account panel.
 *
 * Both are icons. Spelled out, "Follow this section" and "Bookmark" pushed an already crowded action row
 * onto a second line and put a block of chrome above the provision. A bell and a bookmark are conventions
 * a reader already holds -- but an icon alone is a button that says nothing to a screen reader, so both
 * carry an aria-label and a title, and state is shown by filling the glyph as well as by colour.
 */

type Target = { instrumentId?: number; provisionId?: number };
type Kind = "follow" | "bookmark";
type Watch = { kind: Kind; target: "instrument" | "provision"; id: number };

/* One request per page, not one per button.
 *
 * A contents page can carry fifty of these, and every one of them asks the same question about the same
 * reader. The promise is cached so that simultaneous mounts share a single response, and cleared whenever
 * anything is toggled or the reader changes -- a stale list here shows the wrong state on a button the
 * reader just pressed, which is the one thing that would make the feature feel broken.
 */
let listCache: { email: string; p: Promise<Watch[]> } | null = null;

function fetchWatches(email: string): Promise<Watch[]> {
  if (listCache && listCache.email === email) return listCache.p;
  const p = fetch("/api/reader/watch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "list", email }),
  })
    .then((r) => (r.ok ? r.json() : { watches: [] }))
    .then((d) => (Array.isArray(d.watches) ? (d.watches as Watch[]) : []))
    .catch(() => [] as Watch[]);
  listCache = { email, p };
  return p;
}

function invalidate() {
  listCache = null;
}

function useWatchState(kind: Kind, target: Target) {
  const [email, setEmail] = useState<string | null>(null);
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    const load = () => {
      invalidate();
      setEmail(readReader()?.email ?? null);
    };
    load();
    return onReaderChange(load);
  }, []);

  const want = target.instrumentId ?? target.provisionId;
  const kindOfTarget = target.instrumentId ? "instrument" : "provision";

  useEffect(() => {
    if (!email) {
      setOn(null);
      return;
    }
    let live = true;
    fetchWatches(email).then((list) => {
      if (live) setOn(list.some((w) => w.kind === kind && w.target === kindOfTarget && w.id === want));
    });
    return () => {
      live = false;
    };
  }, [email, kind, kindOfTarget, want]);

  const toggle = useCallback(async () => {
    if (!email) {
      document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
      return;
    }
    const next = !on;
    setOn(next); // optimistic: a button must answer the press immediately
    invalidate();
    try {
      const res = await fetch("/api/reader/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, kind, on: next, ...target }),
      });
      if (!res.ok) setOn(!next);
    } catch {
      setOn(!next);
    }
  }, [email, on, kind, target]);

  return { on: on === true, toggle };
}

export function FollowButton(props: Target) {
  const { on, toggle } = useWatchState("follow", props);
  const label = on ? "Stop following this section" : "Follow this section — tell me when something lands against it";
  return (
    <button type="button" onClick={toggle} aria-pressed={on} aria-label={label} title={label} className="icon-btn no-print">
      <BellIcon filled={on} />
    </button>
  );
}

export function BookmarkButton(props: Target) {
  const { on, toggle } = useWatchState("bookmark", props);
  const label = on ? "Remove from your bookmarks" : "Bookmark — keep this where you can find it again";
  return (
    <button type="button" onClick={toggle} aria-pressed={on} aria-label={label} title={label} className="icon-btn no-print">
      <BookmarkIcon filled={on} />
    </button>
  );
}
