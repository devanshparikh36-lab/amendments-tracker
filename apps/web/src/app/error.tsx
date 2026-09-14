"use client";

import Link from "next/link";

// Shown when a page fails to render — almost always the database being unreachable or too slow.
//
// Without this, the failure reaches the host and the visitor gets "This function has crashed", which tells
// them nothing and looks like the site is broken rather than briefly unwell. It cannot catch a function
// timeout (nothing in the app can — the process is killed), but it does catch a failed query, which is the
// commoner case and the one worth explaining.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="panel mx-auto max-w-2xl p-8 text-center">
      <h1 className="serif text-[20px] font-semibold">That page would not load</h1>
      <p className="mt-2 text-[14px] text-[var(--ink-2)]">
        Usually this is the database waking up rather than anything being wrong with the document you wanted.
        Trying again often works.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <Link href="/" className="btn">
          Home
        </Link>
        <Link href="/status" className="btn">
          Collection status
        </Link>
      </div>
      {error.digest && (
        // The digest is the only handle on the server-side log for this failure; without it a report of
        // "a page broke" cannot be traced to anything.
        <p className="mt-5 text-[11px] text-[var(--ink-4)]">
          Reference <span className="num">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
