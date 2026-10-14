"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { displayName, onReaderChange, readReader, type Reader } from "@/lib/reader";

/* Everything this reader follows.
 *
 * A client page, which is unusual here -- almost every other route is prerendered. It has to be: the
 * content is one reader's list and the identity lives in their browser, so there is nothing the server
 * could render ahead of time. It is also the only page on the site where that is true, which is why the
 * rest stay cached.
 *
 * No metadata export and no indexing worth having: there is nothing here for a crawler, and the route is
 * excluded in robots.ts for the same reason.
 */

type Watch = {
  kind: "instrument" | "provision";
  id: number;
  label: string | null;
  title: string;
  slug: string;
  number: string | null;
  created_at: string;
};

export default function YouPage() {
  const [reader, setReader] = useState<Reader | null>(null);
  const [ready, setReady] = useState(false);
  const [watches, setWatches] = useState<Watch[] | null>(null);

  useEffect(() => {
    const load = () => {
      setReader(readReader());
      setReady(true);
    };
    load();
    return onReaderChange(load);
  }, []);

  useEffect(() => {
    if (!reader) {
      setWatches(null);
      return;
    }
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/reader/watch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "list", email: reader.email }),
        });
        if (!res.ok || !live) return;
        const d = await res.json();
        if (live) setWatches(Array.isArray(d.watches) ? d.watches : []);
      } catch {
        if (live) setWatches([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [reader]);

  async function unfollow(w: Watch) {
    if (!reader) return;
    setWatches((list) => (list ?? []).filter((x) => !(x.kind === w.kind && x.id === w.id)));
    try {
      await fetch("/api/reader/watch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: reader.email,
          on: false,
          instrumentId: w.kind === "instrument" ? w.id : undefined,
          provisionId: w.kind === "provision" ? w.id : undefined,
        }),
      });
    } catch {
      /* the row stays; a reload will show the truth */
    }
  }

  if (!ready) return <div className="py-10" />;

  if (!reader) {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <div className="panel panel-body">
          <p className="eyebrow">Your list</p>
          <h1 className="serif mt-1 text-[22px] font-semibold text-[var(--ink)]">Nobody is signed in</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-2)]">
            Follow a section or an Act and it appears here. It takes an email address and no password — and
            typing the same address on another device brings the list with you.
          </p>
          <button
            type="button"
            onClick={() => document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click()}
            className="btn btn-primary mt-4"
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  const acts = (watches ?? []).filter((w) => w.kind === "instrument");
  const sections = (watches ?? []).filter((w) => w.kind === "provision");

  return (
    <div className="mx-auto max-w-3xl py-2">
      <p className="eyebrow">Your list</p>
      <h1 className="serif mt-1 text-[25px] font-semibold leading-tight text-[var(--ink)]">
        Hi, {displayName(reader)}
      </h1>
      <p className="mt-1.5 text-[13.5px] text-[var(--ink-3)]">
        {watches === null
          ? "Loading…"
          : watches.length === 0
            ? "You are not following anything yet."
            : `Following ${sections.length} section${sections.length === 1 ? "" : "s"} and ${acts.length} Act${acts.length === 1 ? "" : "s"}.`}
      </p>

      {watches !== null && watches.length === 0 && (
        <div className="panel panel-body mt-5">
          <p className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            Open any section or Act and press <strong>Follow</strong>. When a notification or circular lands
            against it, it shows up here — and in your morning email if you switch that on.
          </p>
          <Link href="/browse" className="btn mt-3 inline-block">
            Browse Acts &amp; Rules
          </Link>
        </div>
      )}

      {sections.length > 0 && (
        <section className="mt-6">
          <h2 className="eyebrow">Sections</h2>
          <ul className="mt-2 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {sections.map((w) => (
              <li key={`p${w.id}`} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link href={`/browse/${w.slug}/text`} className="text-[14px] text-[var(--link)] hover:underline">
                    <span className="num font-medium">{w.number}</span>
                    <span className="text-[var(--ink-3)]"> · {w.label || w.title}</span>
                  </Link>
                </div>
                <button type="button" onClick={() => unfollow(w)} className="btn shrink-0 text-[12.5px]">
                  Unfollow
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {acts.length > 0 && (
        <section className="mt-6">
          <h2 className="eyebrow">Acts, Rules and Regulations</h2>
          <ul className="mt-2 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {acts.map((w) => (
              <li key={`i${w.id}`} className="flex items-center justify-between gap-3 py-2.5">
                <Link href={`/browse/${w.slug}`} className="min-w-0 text-[14px] text-[var(--link)] hover:underline">
                  {w.title}
                </Link>
                <button type="button" onClick={() => unfollow(w)} className="btn shrink-0 text-[12.5px]">
                  Unfollow
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
