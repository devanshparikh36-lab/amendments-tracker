"use client";

import { useEffect, useState } from "react";
import { onReaderChange, readReader } from "@/lib/reader";

/* Follow a section, or a whole Act.
 *
 * Rendered on a page that is prerendered and shared by everyone, so the button cannot know its own state
 * in the HTML -- "Following" is a fact about one reader and the page is a fact about the law. It therefore
 * starts in a neutral state and corrects itself once the reader's list has loaded. That is the same
 * bargain the greeting makes, for the same reason: no cookie, no per-reader render, no cost per view.
 *
 * Someone who has not signed in still sees the button. Hiding it would be the obvious choice and the wrong
 * one -- it is the only thing on the page that explains why an address is worth typing, and a reader who
 * never sees it never finds the feature. Pressing it asks for the address.
 */

type Props =
  | { instrumentId: number; provisionId?: never; label?: string }
  | { provisionId: number; instrumentId?: never; label?: string };

export function FollowButton(props: Props) {
  const { label } = props;
  const [email, setEmail] = useState<string | null>(null);
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => setEmail(readReader()?.email ?? null);
    load();
    return onReaderChange(load);
  }, []);

  // Which of the reader's watches matches this page. One request for the whole list rather than one per
  // button: a contents page can carry fifty of these.
  useEffect(() => {
    if (!email) {
      setFollowing(null);
      return;
    }
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/reader/watch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "list", email }),
        });
        if (!res.ok || !live) return;
        const d = await res.json();
        const want = props.instrumentId ?? props.provisionId;
        const kind = props.instrumentId ? "instrument" : "provision";
        setFollowing(
          Array.isArray(d.watches) && d.watches.some((w: { kind: string; id: number }) => w.kind === kind && w.id === want),
        );
      } catch {
        /* leave it neutral */
      }
    })();
    return () => {
      live = false;
    };
  }, [email, props.instrumentId, props.provisionId]);

  async function toggle() {
    if (!email) {
      /* No address yet. Open the account panel rather than growing a second sign-in form here -- there
         should be exactly one place the site asks for this. */
      document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
      return;
    }
    const next = !following;
    setFollowing(next); // optimistic: the button must answer the press immediately
    setBusy(true);
    try {
      const res = await fetch("/api/reader/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          on: next,
          instrumentId: props.instrumentId,
          provisionId: props.provisionId,
        }),
      });
      if (!res.ok) setFollowing(!next); // put it back if the server disagreed
    } catch {
      setFollowing(!next);
    } finally {
      setBusy(false);
    }
  }

  const on = following === true;
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      title={on ? "Stop following this" : "Tell me when something lands against this"}
      className={`btn no-print ${on ? "btn-primary" : ""}`}
    >
      {on ? "Following" : label || "Follow"}
    </button>
  );
}
