"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Exactly what this list renders, and nothing else. It is sent to the browser once per section, so a
// 935-section Act pays for every field here 935 times; parent_id and sort_key were being carried along by a
// spread and read by nobody.
export type SectionItem = {
  id: number;
  number: string;
  heading: string | null;
  level: string;
  machine: boolean;
  differs: number;
};

function norm(s: string): string {
  return s.replace(/[\s.()\-]/g, "").toLowerCase();
}

export function SectionFilter({
  items,
  total,
  slug,
  selected,
  suffix,
  unit,
}: {
  /** A window around what is being read. The rest arrives from /api/sections once the page is up. */
  items: SectionItem[];
  /** How many sections exist, so the count is honest before the full list has arrived. */
  total: number;
  slug: string;
  selected?: string;
  suffix?: string;
  unit: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [all, setAll] = useState<SectionItem[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const asked = useRef(false);

  // Fetch the complete contents once, and never twice. Called both when the browser goes idle and the moment
  // anyone touches the filter box, because whichever happens first is the one that matters: typing must not
  // wait for an idle callback that a busy tab may never deliver.
  const loadAll = useCallback(() => {
    if (asked.current) return;
    asked.current = true;
    fetch(`/api/sections/${encodeURIComponent(slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.items) setAll(d.items as SectionItem[]);
      })
      .catch(() => {
        // Leave the window in place: a partial list still navigates, and the filter still works within it.
        asked.current = false;
      });
  }, [slug]);

  useEffect(() => {
    if (items.length >= total) return; // already complete; nothing to fetch
    // A plain timer, deliberately not requestIdleCallback: idle callbacks do not fire in a background tab, so
    // opening a section in a new tab -- an ordinary thing to do with a list of links -- would leave the
    // contents stuck at the initial window until the tab was looked at. The delay is only to let the page
    // finish painting first; the fetch itself is small and off the critical path.
    const t = setTimeout(loadAll, 300);
    return () => clearTimeout(t);
  }, [loadAll, items.length, total]);

  const list = all ?? items;
  const complete = all !== null || items.length >= total;

  const href = (number: string) => `/browse/${slug}/text?p=${encodeURIComponent(number)}${suffix ?? ""}`;

  const shown = useMemo(() => {
    const needle = norm(q);
    if (!needle) return list;
    const numeric = /^[0-9]/.test(needle);
    const matches = list.filter((i) => {
      const num = norm(i.number);
      if (numeric) return num.startsWith(needle) || num.includes(needle);
      return num.includes(needle) || (i.heading ?? "").toLowerCase().includes(q.trim().toLowerCase());
    });
    // Exact number first, then shortest number (so "17" beats "17A" beats "170").
    return matches.sort((a, b) => {
      const ea = norm(a.number) === needle ? 0 : 1;
      const eb = norm(b.number) === needle ? 0 : 1;
      return ea - eb || a.number.length - b.number.length || 0;
    });
  }, [list, q]);

  const first = shown.find((i) => i.level !== "chapter");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--rule)] p-2">
        <label htmlFor="section-filter" className="sr-only">
          Filter {unit}s
        </label>
        <input
          id="section-filter"
          ref={inputRef}
          value={q}
          onFocus={loadAll}
          onChange={(e) => {
            loadAll();
            setQ(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && first) {
              e.preventDefault();
              router.push(href(first.number));
            }
            if (e.key === "Escape") setQ("");
          }}
          placeholder={`Type a ${unit} number — 80C, 17`}
          className="field w-full"
        />
        <div className="mt-1 flex items-baseline justify-between text-[11px] text-[var(--ink-3)]">
          {/* Counted against the real total, not against the window that happens to have arrived, so the
              figure never quietly understates how much of the Act there is. */}
          <span>
            {shown.filter((i) => i.level !== "chapter").length} of {total} {unit}s
            {!complete && <span className="ml-1 opacity-60">· loading the rest</span>}
          </span>
          {q && (
            <button type="button" onClick={() => setQ("")} className="hover:underline">
              clear
            </button>
          )}
        </div>
      </div>
      <nav aria-label={`${unit} list`} className="min-h-0 flex-1 overflow-y-auto p-1 text-[13px]">
        {shown.map((i) =>
          i.level === "chapter" ? (
            <div key={i.id} className="eyebrow mt-3 px-2 pb-0.5">
              {i.heading || i.number}
            </div>
          ) : (
            <Link
              key={i.id}
              href={href(i.number)}
              className={`block truncate rounded px-2 py-[3px] hover:bg-[var(--ground-sunk)] ${
                selected === i.number
                  ? "bg-[var(--ground-sunk)] font-semibold text-[var(--ink)]"
                  : "text-[var(--ink-2)]"
              }`}
              title={i.heading ? `${i.number} — ${i.heading}` : i.number}
            >
              <span className="num font-medium">{i.number}</span>
              {i.heading ? <span className="text-[var(--ink-3)]"> {i.heading.replace(/[.\-\s]+$/, "")}</span> : null}
              {i.machine && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />}
              {i.differs > 0 && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" />}
            </Link>
          ),
        )}
        {shown.length === 0 && <p className="px-2 py-4 text-[var(--ink-3)]">No {unit} matches &ldquo;{q}&rdquo;.</p>}
      </nav>
    </div>
  );
}
