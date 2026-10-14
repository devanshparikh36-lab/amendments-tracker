"use client";

import { useCallback, useEffect, useState } from "react";
import { onReaderChange, readReader } from "@/lib/reader";

/* Keep this search.
 *
 * Saved searches were built with a list, a route and a place on /you, and no way whatsoever to create one
 * -- a feature that could be read and never written. This is that missing half.
 *
 * It only ever writes on a press. Nothing about searching saves a query by itself, which is the line that
 * separates this from `search_log`: that table records what everyone typed and therefore keeps outcomes
 * and drops the words, because a record of what a tax practice searched for is a disclosure nobody
 * consented to. This keeps the words, for one reader, because they asked.
 */

export function SaveSearch({ q }: { q: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const load = () => setEmail(readReader()?.email ?? null);
    load();
    return onReaderChange(load);
  }, []);

  // Whether this exact query is already kept, so the button says "Saved" rather than offering to save it
  // a second time. Compared case-insensitively, as the unique index is.
  useEffect(() => {
    if (!email || !q) {
      setSaved(null);
      return;
    }
    let live = true;
    fetch("/api/reader/searches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "list", email }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        const list: { q: string }[] = Array.isArray(d?.searches) ? d.searches : [];
        setSaved(list.some((s) => s.q.toLowerCase() === q.toLowerCase()));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [email, q]);

  const toggle = useCallback(async () => {
    if (!email) {
      document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click();
      return;
    }
    const next = !saved;
    setSaved(next);
    setBusy(true);
    try {
      const res = await fetch("/api/reader/searches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: next ? "save" : "forget", email, q }),
      });
      if (!res.ok) setSaved(!next);
    } catch {
      setSaved(!next);
    } finally {
      setBusy(false);
    }
  }, [email, saved, q]);

  if (!q) return null;

  const on = saved === true;
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      title={on ? "Remove this from your saved searches" : "Keep this search on your list"}
      className={`btn no-print ${on ? "btn-primary" : ""}`}
    >
      {on ? "Saved" : "Save this search"}
    </button>
  );
}
