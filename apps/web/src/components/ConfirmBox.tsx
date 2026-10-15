"use client";

import Link from "next/link";
import { useState } from "react";
import { readReader, writeReader } from "@/lib/reader";

/* The one press that confirms an address.
 *
 * A button rather than something that fires on load, for the reason set out in the confirm route: mail
 * gateways and link previewers fetch URLs out of incoming mail, so a confirmation that happened on page
 * load would often be a scanner's doing rather than the reader's.
 */

type State = "ready" | "sending" | "done" | "invalid" | "error";

export function ConfirmBox({ token }: { token: string }) {
  const [state, setState] = useState<State>("ready");
  const [email, setEmail] = useState<string | null>(null);

  async function confirm() {
    setState("sending");
    try {
      const res = await fetch("/api/reader/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.ok && d.ok) {
        const confirmed = typeof d.email === "string" ? d.email : null;
        setEmail(confirmed);
        setState("done");
        /* Sign this device in as the confirmed reader, when it is not already signed in as somebody else.
         *
         * A reader who confirms on their phone, having ticked the box on a laptop, would otherwise land on
         * a site that does not know them -- having just proved they own the address. Overwriting an
         * existing, different identity would be worse than not helping, so that case is left alone. */
        if (confirmed) {
          const current = readReader();
          if (!current) writeReader({ email: confirmed });
        }
      } else if (res.status === 404) {
        setState("invalid");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="panel panel-body">
        <p className="eyebrow">Confirmed</p>
        <h1 className="serif mt-1 text-[20px] font-semibold text-[var(--ink)]">That address is verified</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
          {email ? <strong className="font-medium text-[var(--ink)]">{email}</strong> : "Your address"} will
          get the digest on days the regulators publish something. At most one message a day, and nothing at
          all on a quiet day.
        </p>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
          You can stop it, export everything held about you, or delete the account outright from the account
          panel on any page. No reply to this needed and no account to manage.
        </p>
        <p className="mt-3 text-[13px]">
          <Link href="/" className="text-[var(--link)] hover:underline">
            Start reading &rarr;
          </Link>
        </p>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="panel panel-body">
        <p className="eyebrow">Confirm</p>
        <h1 className="serif mt-1 text-[20px] font-semibold text-[var(--ink)]">This link has expired</h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
          It may already have been used, or it may be more than 48 hours old. Either way the fix is the same:
          open the account panel on any page, enter your address, and press{" "}
          <em>Send the confirmation again</em>.
        </p>
        <p className="mt-3 text-[13px]">
          <Link href="/" className="text-[var(--link)] hover:underline">
            Go to the site &rarr;
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="panel panel-body">
      <p className="eyebrow">Confirm</p>
      <h1 className="serif mt-1 text-[20px] font-semibold text-[var(--ink)]">
        One press and the digest starts
      </h1>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
        This confirms that the address the mail arrived at is yours. At most one message a day, only when a
        regulator has published something, and it can be stopped from any page.
      </p>
      <div className="mt-4">
        <button type="button" onClick={confirm} disabled={state === "sending"} className="btn btn-primary">
          {state === "sending" ? "Confirming…" : "Yes, confirm this address"}
        </button>
      </div>
      {state === "error" && (
        <p className="mt-2 text-[12.5px] text-[var(--bad)]">
          That did not go through. Try once more, and if it still fails the address has not been confirmed
          and nothing will be sent to it.
        </p>
      )}
      <p className="mt-3 text-[12px] leading-snug text-[var(--ink-3)]">
        Did not ask for this? Close the page. Nothing is sent to an address that has not been confirmed, so
        doing nothing is a complete answer.
      </p>
    </div>
  );
}
