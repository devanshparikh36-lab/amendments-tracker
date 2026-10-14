"use client";

import { useEffect, useRef, useState } from "react";

/* The search box on /definitions, with the terms that are actually defined.
 *
 * Deliberately not the masthead's SearchBox. That one offers sections, instruments and notifications,
 * which are the right answers to "find me this" and the wrong ones to "what does this word mean" -- a
 * section number is not a candidate for a word to be defined. This offers defined terms and nothing else.
 *
 * It degrades to a plain input. Without JavaScript, or while the suggestion request is in flight or has
 * failed, this is a text box inside a form that submits to /definitions -- which is the entire feature.
 * The list is a convenience laid on top of something that already works.
 */

export function DefinitionBox({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  // What the input held when the request was sent, so a slow answer cannot overwrite a newer one.
  const latest = useRef("");

  useEffect(() => {
    const v = value.trim();
    latest.current = v;
    if (v.length < 2) {
      setItems([]);
      return;
    }
    /* 160ms. Short enough that the list feels attached to the typing, long enough that a word typed at
     * speed costs one request rather than one per letter -- and every one of those is a regex scan. */
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/definitions/suggest?q=${encodeURIComponent(v)}`);
        if (!res.ok) return;
        const d = await res.json();
        // Ignore an answer to a question that is no longer being asked.
        if (latest.current !== v) return;
        setItems(Array.isArray(d.items) ? d.items : []);
        setCursor(-1);
      } catch {
        /* the box still works */
      }
    }, 160);
    return () => clearTimeout(t);
  }, [value]);

  // A click anywhere else closes the list. Without this it stays open over the results underneath.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const shown = open && items.length > 0;

  function choose(term: string) {
    setValue(term);
    setOpen(false);
    // Submitting here rather than waiting for the reader to press Find: picking a term from a list of
    // definitions is the whole request, and asking them to confirm it is asking twice.
    setTimeout(() => box.current?.closest("form")?.requestSubmit(), 0);
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!shown) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c <= 0 ? items.length - 1 : c - 1));
    } else if (e.key === "Enter" && cursor >= 0) {
      e.preventDefault();
      choose(items[cursor]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <input
        id="q"
        name="q"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        className="field w-full"
        placeholder="capital asset"
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-controls="definition-suggestions"
        aria-autocomplete="list"
      />
      {shown && (
        <ul
          id="definition-suggestions"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded border border-[var(--rule-strong)] bg-[var(--paper)] shadow-lg"
        >
          {items.map((term, i) => (
            <li key={term} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(term)}
                className={`block w-full px-3 py-1.5 text-left text-[13.5px] ${
                  i === cursor ? "bg-[var(--tint)] text-[var(--ink)]" : "text-[var(--ink-2)]"
                }`}
              >
                {term}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
