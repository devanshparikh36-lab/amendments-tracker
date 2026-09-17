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

/** How many suggestions to put on screen. The route fetches more than this on purpose: the extra rows are
 * never rendered, they exist so that more answers come back complete rather than truncated, and a complete
 * answer is one this box can narrow by itself on the next keystroke instead of waiting on the network. */
const SHOW = 12;

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

  // Answers already received, by query, each with the server's word on whether it was the whole answer.
  // Survives for the life of the box, which is the life of the page.
  const cache = useRef(new Map<string, { items: Item[]; complete: boolean }>());

  // Debounced, and every in-flight request is abandoned when the next keystroke arrives. Without the abort a
  // slow response for "80" can land after the one for "80C" and repopulate the list with the wrong answers.
  //
  // The local narrowing above the fetch is what makes typing feel immediate. A round trip costs about 700ms
  // for a prefix nobody has asked for yet -- and only ~200ms of that is the database, the rest being the
  // function invocation and the hop to it -- so waiting for the network on every keystroke means the list is
  // always a word behind the typing.
  //
  // Narrowing works because the server matches substrings: anything containing "deprec" also contains
  // "depre", so the answers to a longer query are a subset of the answers to a shorter one.
  //
  // It is applied whether or not that shorter answer was the complete one, which took some thinking about.
  // Filtering a truncated list can leave out a row the server would have sent -- but it cannot conjure one
  // that does not match, so everything on screen is genuine, and the response replaces it a moment later
  // anyway. Against that, refusing to narrow means every keystroke on a broad word waits on the network,
  // which is the complaint this whole mechanism exists to answer. An incomplete list for 700ms beats the
  // previous query's list for 700ms, and both beat an empty box.
  //
  // `complete` is still reported by the route and kept here, because the distinction is real and the next
  // person to touch this should be able to see it rather than rediscover it.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setItems([]);
      return;
    }

    const hit = cache.current.get(q);
    if (hit) {
      setItems(hit.items);
      setActive(-1);
      return;
    }

    for (let i = q.length - 1; i >= 2; i--) {
      const shorter = cache.current.get(q.slice(0, i));
      if (shorter) {
        const needle = q.toLowerCase();
        setItems(
          shorter.items.filter(
            (it) => it.label.toLowerCase().includes(needle) || (it.sub ?? "").toLowerCase().includes(needle),
          ),
        );
        setActive(-1);
        break;
      }
    }

    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : { items: [], complete: false }))
        .then((d: { items: Item[]; complete?: boolean }) => {
          const got = d.items ?? [];
          cache.current.set(q, { items: got, complete: d.complete === true });
          setItems(got);
          setActive(-1);
        })
        .catch(() => {
          /* aborted, or offline: leave whatever is on screen rather than blanking it */
        });
    }, 180);
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

  // `items` holds everything fetched, because narrowing needs the whole answer to filter from; only this
  // many are ever shown or reachable by the arrow keys.
  const visible = items.slice(0, SHOW);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!visible.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % visible.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a <= 0 ? visible.length - 1 : a - 1));
    } else if (e.key === "Enter" && open && active >= 0) {
      // Only swallow Enter when something is actually highlighted. Otherwise the form submits to /find,
      // which is what someone pressing Enter on their own words expects.
      e.preventDefault();
      go(visible[active]);
    }
  };

  const showList = open && visible.length > 0;

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
          {visible.map((it, i) => (
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
