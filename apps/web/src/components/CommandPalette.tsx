"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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

const SHOW = 10;

/** Search from anywhere, without a box taking up room on every screen.
 *
 * The masthead used to carry a search field. It was on every page, including the ones that have their own
 * and better one, and it always searched the whole site even while you were reading a single Act. This
 * replaces it: a quiet button, Ctrl-K (Cmd-K on a Mac) or "/" from anywhere, Escape to leave.
 *
 * "/" is only a shortcut when nothing is being typed into. Intercepting it inside a text field would make
 * every search box on the site impossible to type a date into.
 *
 * Degrades honestly: with JavaScript off there is no palette, and the pages that matter -- Home, every
 * instrument -- still carry a plain form that posts to /find without any of this.
 */
export function CommandPalette({ hideTrigger = false }: { hideTrigger?: boolean } = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, Item[]>());

  const close = useCallback(() => {
    setOpen(false);
    setValue("");
    setItems([]);
    setActive(-1);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Same shape as the search box: debounce, abort the previous request, and cache by query so going back to
  // a shorter prefix is instant.
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) {
      setItems([]);
      return;
    }
    const hit = cache.current.get(q);
    if (hit) {
      setItems(hit);
      setActive(-1);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items?: Item[] }) => {
          const got = d.items ?? [];
          cache.current.set(q, got);
          setItems(got);
          setActive(-1);
        })
        .catch(() => {
          /* aborted or offline: keep what is on screen rather than blanking it */
        });
    }, 180);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [value]);

  function go(href: string) {
    close();
    router.push(href);
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const shown = items.slice(0, SHOW);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (shown.length ? (a + 1) % shown.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (shown.length ? (a <= 0 ? shown.length - 1 : a - 1) : -1));
    } else if (e.key === "Enter") {
      if (active >= 0 && shown[active]) {
        e.preventDefault();
        go(shown[active].href);
      } else if (value.trim()) {
        e.preventDefault();
        go(`/find?q=${encodeURIComponent(value.trim())}`);
      }
    }
  }

  const shown = items.slice(0, SHOW);

  return (
    <>
      {/* The masthead no longer carries a search box -- a box in the header is a box on every screen,
          including the ones that have their own and better-scoped one. The palette itself stays, because
          the keyboard shortcut costs no space and is the fastest route from anywhere; `hideTrigger` is how
          it is mounted without re-introducing the thing that was removed. */}
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="flex items-center gap-2 rounded border border-[var(--rule)] px-2.5 py-1 text-[12.5px] text-[var(--ink-3)] hover:border-[var(--rule-strong)] hover:text-[var(--ink)]"
        >
          <span>Search</span>
          <kbd className="rounded border border-[var(--rule)] px-1 text-[10.5px] text-[var(--ink-4)]">Ctrl K</kbd>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--scrim)] px-4 pt-[12vh]"
          onMouseDown={close}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className="w-full max-w-xl overflow-hidden rounded-lg border border-[var(--rule-strong)] bg-[var(--paper)] shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="80C · LODR 17 · section 16 CGST · ECB"
              aria-label="Search sections, regulations and notifications"
              autoComplete="off"
              className="w-full border-b border-[var(--rule)] bg-transparent px-4 py-3 text-[15px] outline-none"
            />
            {shown.length > 0 && (
              <ul className="max-h-[50vh] overflow-y-auto py-1">
                {shown.map((it, i) => (
                  <li key={`${it.kind}-${it.href}-${i}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(it.href)}
                      className={`flex w-full items-baseline gap-2 px-4 py-2 text-left ${
                        i === active ? "bg-[var(--tint)]" : ""
                      }`}
                    >
                      <span className="font-medium">{it.label}</span>
                      {it.sub && <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink-2)]">{it.sub}</span>}
                      <span className="meta num ml-auto whitespace-nowrap">
                        {it.context ?? KIND_LABEL[it.kind]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center gap-3 border-t border-[var(--rule)] px-4 py-2 text-[11.5px] text-[var(--ink-4)]">
              <span>&uarr;&darr; to move</span>
              <span>&crarr; to open</span>
              <span>Esc to close</span>
              {value.trim() && (
                <button
                  type="button"
                  onClick={() => go(`/find?q=${encodeURIComponent(value.trim())}&all=1`)}
                  className="ml-auto text-[var(--link)] hover:underline"
                >
                  See every match
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
