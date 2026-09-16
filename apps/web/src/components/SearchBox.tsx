"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

type Item = {
  kind: "section" | "instrument" | "notification";
  label: string;
  sub: string | null;
  context: string | null;
  href: string;
};

const KIND_LABEL: Record<Item["kind"], string> = {
  section: "section",
  instrument: "act / rules",
  notification: "notification",
};

/** A search input that suggests from what the site actually holds.
 *
 * autoComplete="off" is the point of half of this. Without it the browser offers its own history of
 * everything previously typed into any field called "q" -- on a shared machine that is somebody else's
 * search history, and it covers the real suggestions with a list of stale strings that lead nowhere.
 *
 * The form still works exactly as before with JavaScript off or before this hydrates: Enter with nothing
 * highlighted submits to /find as it always did. The suggestions are a shortcut past that page, never a
 * replacement for it.
 */
export function SearchBox({
  name = "q",
  id,
  placeholder,
  defaultValue = "",
  autoFocus,
  className = "field min-w-0 flex-1",
  wrapperClassName = "relative min-w-0 flex-1",
}: {
  name?: string;
  id?: string;
  placeholder?: string;
  defaultValue?: string;
  autoFocus?: boolean;
  className?: string;
  wrapperClassName?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced, and every in-flight request is abandoned when the next keystroke arrives. Without the abort a
  // slow response for "80" can land after the one for "80C" and repopulate the list with the wrong answers.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setItems([]);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items: Item[] }) => {
          setItems(d.items ?? []);
          setActive(-1);
        })
        .catch(() => {
          /* aborted, or offline: leave whatever is on screen rather than blanking it */
        });
    }, 140);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [value]);

  // Clicking anywhere else closes the list. Pointerdown rather than click, so it closes before the click
  // lands on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const go = (item: Item) => {
    setOpen(false);
    setValue(item.label);
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === "Enter" && open && active >= 0) {
      // Only swallow Enter when something is actually highlighted. Otherwise the form submits to /find,
      // which is what someone pressing Enter on their own words expects.
      e.preventDefault();
      go(items[active]);
    }
  };

  const showList = open && items.length > 0;

  return (
    <div ref={boxRef} className={wrapperClassName}>
      <input
        id={id}
        name={name}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
      />

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-[min(70vh,26rem)] overflow-y-auto rounded border border-[var(--rule)] bg-white py-1 shadow-lg"
        >
          {items.map((it, i) => (
            <li
              key={`${it.kind}-${it.href}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Mousedown, not click: the input blurs on mousedown and the list would be gone by the time a
              // click arrived.
              onMouseDown={(e) => {
                e.preventDefault();
                go(it);
              }}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-[var(--paper)]" : ""}`}
            >
              <div className="flex items-baseline gap-2">
                <span className="num truncate text-[13px] font-medium text-[var(--ink-2)]">{it.label}</span>
                {it.context && (
                  <span className="shrink-0 rounded-sm bg-stone-100 px-1 text-[10px] font-semibold uppercase tracking-wide text-stone-600">
                    {it.context}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-wide text-[var(--ink-4)]">
                  {KIND_LABEL[it.kind]}
                </span>
              </div>
              {it.sub && <div className="truncate text-[12px] text-[var(--ink-3)]">{it.sub}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
