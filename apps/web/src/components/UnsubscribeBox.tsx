"use client";

import Link from "next/link";
import { useState } from "react";

/* The page a reader reaches by clicking the unsubscribe link in the digest body.
 *
 * Most readers never see this: Gmail and Outlook show their own unsubscribe control from the headers, and
 * pressing that POSTs straight to the API. This is for the link in the footer, and for anyone whose client
 * shows no control of its own.
 *
 * A button rather than acting on load, for the same reason /confirm is: link scanners fetch URLs out of
 * incoming mail, and a page that unsubscribed on load would let a scanner end somebody's subscription.
 */

type State = "ready" | "working" | "done" | "unknown" | "error";

export function UnsubscribeBox({ token }: { token: string }) {
  const [state, setState] = useState<State>("ready");

  async function stop() {
    setState("working");
    try {
      const res = await fetch(`/api/reader/unsubscribe?t=${encodeURIComponent(token)}`, { method: "POST" });
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setState("error");
      else setState(d.result === "stopped" ? "done" : "unknown");
    } catch {
      setState("error");
    }
  }

  if (state === "done" || state === "unknown") {
    return (
      <div className="panel panel-body">
        <p className="eyebrow">Unsubscribed</p>
        <h1 className="serif mt-1 text-[20px] font-semibold text-[var(--ink)]">The digest has stopped</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
          {state === "unknown"
            ? "That link did not match anything, which almost always means it has already been used. Either way no digest is going to that address."
            : "No further digests will be sent to that address."}
        </p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
          Your account is untouched &mdash; follows, bookmarks, notes and saved searches are all still there,
          and the site still works exactly as before. If you would rather it held nothing at all, the account
          panel on any page has a delete button that removes the lot at once.
        </p>
        <p className="mt-3 text-[13px]">
          <Link href="/" className="text-[var(--link)] hover:underline">
            Carry on reading &rarr;
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="panel panel-body">
      <p className="eyebrow">Unsubscribe</p>
      <h1 className="serif mt-1 text-[20px] font-semibold text-[var(--ink)]">Stop the daily digest?</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
        This stops the mail and nothing else. Everything you have saved stays where it is, and you can switch
        the digest back on from the account panel without verifying your address again.
      </p>
      <div className="mt-4">
        <button type="button" onClick={stop} disabled={state === "working"} className="btn btn-primary">
          {state === "working" ? "Stopping…" : "Yes, stop sending it"}
        </button>
      </div>
      {state === "error" && (
        <p className="mt-2 text-[12.5px] text-[var(--bad)]">
          That did not go through, so the digest has not stopped. Try again, or write to the address on the{" "}
          <Link href="/privacy#contact" className="underline">
            privacy page
          </Link>{" "}
          and it will be done by hand.
        </p>
      )}
    </div>
  );
}
