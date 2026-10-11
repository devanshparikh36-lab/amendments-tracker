"use client";

import { useEffect, useState } from "react";

/* Light or dark, in the top corner of the masthead.
 *
 * Two states and no "Auto". The first version followed the operating system until told otherwise, which is
 * the conventional answer and not the one wanted here: a theme that changes by itself is a page that looks
 * different from the one you left, and this is a site people keep open beside a return they are drafting.
 * So the only input is the button, the choice is remembered, and light is what a reader gets until they
 * say otherwise -- which also happens to match what comes out of the printer.
 *
 * The choice is written to localStorage and read back by an inline script in the document head (see
 * layout.tsx) before the first paint. Without that the server sends the light theme, the browser paints it,
 * and a stored dark theme arrives a frame later -- a white flash on every navigation, which is worse than
 * having no dark theme at all.
 *
 * Every storage access is wrapped: localStorage throws outright in some privacy modes rather than returning
 * null, and a theme toggle must not be able to break the page it sits on. A failed write costs the
 * preference, not the session.
 */

const KEY = "as-amended-theme";

export function ThemeToggle() {
  // Light on the server and on first client render, which is what the inline script has already put on
  // <html> unless a dark choice was stored. Reading localStorage during render would make the two disagree.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    try {
      setDark(localStorage.getItem(KEY) === "dark");
    } catch {
      /* unreadable storage is the same as no preference */
    }
  }, []);

  function toggle() {
    const next = !dark;
    const root = document.documentElement;
    if (next) root.setAttribute("data-theme", "dark");
    else root.setAttribute("data-theme", "light");
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      /* the preference will not survive the tab; the page still works */
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      // Says what pressing it does, not what is currently on: with two states those read the same to a
      // sighted user and opposite to a screen reader, and the action is the useful half.
      aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      title={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      className="no-print inline-flex items-center gap-1.5 rounded border border-[var(--rule-strong)] bg-[var(--paper)] px-2 py-1 text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)]"
    >
      <Glyph dark={dark} />
      <span className="hidden sm:inline">{dark ? "Dark" : "Light"}</span>
    </button>
  );
}

/* Sun or moon, drawn rather than fetched: one icon font or SVG sprite for two shapes is a request on every
 * page for something that is sixteen lines of path data. */
function Glyph({ dark }: { dark: boolean }) {
  return dark ? (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">
      <path d="M6.2 1.4A6.6 6.6 0 0 0 8 14.6a6.6 6.6 0 0 0 6.3-4.6 5.4 5.4 0 0 1-8.1-8.6Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor">
      <circle cx="8" cy="8" r="3.1" />
      <path
        d="M8 .9v2.0M8 13.1v2.0M.9 8h2.0M13.1 8h2.0M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
