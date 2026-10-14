"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { displayName, onReaderChange, readReader, type Reader } from "@/lib/reader";

/* Everything this reader has kept: what they follow, what they bookmarked, their notes, their searches.
 *
 * A client page, which is unusual here -- almost every other route is prerendered. It has to be: the
 * content is one reader's list and the identity lives in their browser, so there is nothing the server
 * could render ahead of time. It is also the only page where that is true, which is why the rest stay
 * cached and the site stays free.
 */

type Watch = {
  kind: "follow" | "bookmark";
  target: "instrument" | "provision";
  id: number;
  label: string | null;
  title: string;
  slug: string;
  number: string | null;
};
type Note = { provision_id: number; body: string; updated_at: string; number: string; slug: string; short_code: string };
type Search = { q: string; created_at: string };

export default function YouPage() {
  const [reader, setReader] = useState<Reader | null>(null);
  const [ready, setReady] = useState(false);
  const [watches, setWatches] = useState<Watch[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);

  useEffect(() => {
    const load = () => {
      setReader(readReader());
      setReady(true);
    };
    load();
    return onReaderChange(load);
  }, []);

  const post = useCallback(async (path: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!reader) {
      setWatches(null);
      setNotes([]);
      setSearches([]);
      return;
    }
    let live = true;
    const email = reader.email;
    (async () => {
      const [w, n, s] = await Promise.all([
        post("/api/reader/watch", { action: "list", email }),
        post("/api/reader/notes", { action: "list", email }),
        post("/api/reader/searches", { action: "list", email }),
      ]);
      if (!live) return;
      setWatches(Array.isArray(w?.watches) ? w.watches : []);
      setNotes(Array.isArray(n?.notes) ? n.notes : []);
      setSearches(Array.isArray(s?.searches) ? s.searches : []);
    })();
    return () => {
      live = false;
    };
  }, [reader, post]);

  async function remove(w: Watch) {
    if (!reader) return;
    setWatches((list) => (list ?? []).filter((x) => !(x.kind === w.kind && x.target === w.target && x.id === w.id)));
    await post("/api/reader/watch", {
      email: reader.email,
      kind: w.kind,
      on: false,
      instrumentId: w.target === "instrument" ? w.id : undefined,
      provisionId: w.target === "provision" ? w.id : undefined,
    });
  }

  async function forgetSearch(q: string) {
    if (!reader) return;
    setSearches((list) => list.filter((s) => s.q !== q));
    await post("/api/reader/searches", { action: "forget", email: reader.email, q });
  }

  if (!ready) return <div className="py-10" />;

  if (!reader) {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <div className="panel panel-body">
          <p className="eyebrow">Your list</p>
          <h1 className="serif mt-1 text-[22px] font-semibold text-[var(--ink)]">Nobody is signed in</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-2)]">
            Follow a section, bookmark one, or keep a note against it, and it appears here. It takes an
            email address and no password — and typing the same address on another device brings all of it
            with you.
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

  const follows = (watches ?? []).filter((w) => w.kind === "follow");
  const marks = (watches ?? []).filter((w) => w.kind === "bookmark");
  const empty = watches !== null && follows.length + marks.length + notes.length + searches.length === 0;

  const href = (w: Watch) => (w.target === "instrument" ? `/browse/${w.slug}` : `/browse/${w.slug}/text`);
  const title = (w: Watch) =>
    w.target === "instrument" ? (
      w.title
    ) : (
      <>
        <span className="num font-medium">{w.number}</span>
        <span className="text-[var(--ink-3)]"> · {w.label || w.title}</span>
      </>
    );

  const list = (items: Watch[], verb: string) => (
    <ul className="mt-2 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
      {items.map((w) => (
        <li key={`${w.kind}-${w.target}-${w.id}`} className="flex items-center justify-between gap-3 py-2.5">
          <Link href={href(w)} className="min-w-0 text-[14px] text-[var(--link)] hover:underline">
            {title(w)}
          </Link>
          <button type="button" onClick={() => remove(w)} className="btn shrink-0 text-[12.5px]">
            {verb}
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="mx-auto max-w-3xl py-2">
      <p className="eyebrow">Your list</p>
      <h1 className="serif mt-1 text-[25px] font-semibold leading-tight text-[var(--ink)]">
        Hi, {displayName(reader)}
      </h1>
      <p className="mt-1.5 text-[13.5px] text-[var(--ink-3)]">
        {watches === null
          ? "Loading…"
          : `${follows.length} followed · ${marks.length} bookmarked · ${notes.length} note${notes.length === 1 ? "" : "s"} · ${searches.length} saved search${searches.length === 1 ? "" : "es"}`}
      </p>

      {empty && (
        <div className="panel panel-body mt-5">
          <p className="text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            Nothing kept yet. Open any section and you will find <strong>Follow</strong>,{" "}
            <strong>Bookmark</strong> and <strong>Add a note</strong> beside the amendment history.
          </p>
          <Link href="/browse" className="btn mt-3 inline-block">
            Browse Acts &amp; Rules
          </Link>
        </div>
      )}

      {follows.length > 0 && (
        <section id="following" className="mt-6">
          <h2 className="eyebrow">Following</h2>
          <p className="mt-0.5 text-[12px] text-[var(--ink-4)]">Told when something lands against these.</p>
          {list(follows, "Unfollow")}
        </section>
      )}

      {marks.length > 0 && (
        <section id="bookmarks" className="mt-6">
          <h2 className="eyebrow">Bookmarks</h2>
          <p className="mt-0.5 text-[12px] text-[var(--ink-4)]">Kept to come back to.</p>
          {list(marks, "Remove")}
        </section>
      )}

      {notes.length > 0 && (
        <section id="notes" className="mt-6">
          <h2 className="eyebrow">Notes</h2>
          <p className="mt-0.5 text-[12px] text-[var(--ink-4)]">
            Readable by anyone who knows your email address — keep confidential matter out of them.
          </p>
          <ul className="mt-2 space-y-3">
            {notes.map((n) => (
              <li key={n.provision_id} className="panel panel-body">
                <Link href={`/browse/${n.slug}/text`} className="text-[13.5px] text-[var(--link)] hover:underline">
                  <span className="num font-medium">{n.number}</span>
                  <span className="text-[var(--ink-3)]"> · {n.short_code}</span>
                </Link>
                <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--ink-2)]">{n.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {searches.length > 0 && (
        <section id="searches" className="mt-6">
          <h2 className="eyebrow">Saved searches</h2>
          <ul className="mt-2 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
            {searches.map((s) => (
              <li key={s.q} className="flex items-center justify-between gap-3 py-2.5">
                <Link
                  href={`/find?q=${encodeURIComponent(s.q)}`}
                  className="min-w-0 truncate text-[14px] text-[var(--link)] hover:underline"
                >
                  {s.q}
                </Link>
                <button type="button" onClick={() => forgetSearch(s.q)} className="btn shrink-0 text-[12.5px]">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
