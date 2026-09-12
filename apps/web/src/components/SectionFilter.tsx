"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

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
  slug,
  selected,
  suffix,
  unit,
}: {
  items: SectionItem[];
  slug: string;
  selected?: string;
  suffix?: string;
  unit: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const href = (number: string) => `/browse/${slug}/text?p=${encodeURIComponent(number)}${suffix ?? ""}`;

  const shown = useMemo(() => {
    const needle = norm(q);
    if (!needle) return items;
    const numeric = /^[0-9]/.test(needle);
    const matches = items.filter((i) => {
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
  }, [items, q]);

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
          onChange={(e) => setQ(e.target.value)}
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
          <span>
            {shown.filter((i) => i.level !== "chapter").length} of {items.filter((i) => i.level !== "chapter").length}{" "}
            {unit}s
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
