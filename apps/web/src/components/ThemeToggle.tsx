"use client";

import { useEffect, useState } from "react";

/* Light / dark, in the top corner of the masthead.
 *
 * Three states and not two, which is the part worth getting right. "System" is the default and has to stay
 * reachable: a laptop set to switch at dusk should switch this site with it, and a toggle that only knows
 * light and dark silently takes that away the first time it is pressed. So the cycle is
 * system -> light -> dark -> system, and the label says which one is in force.
 *
 * The choice is written to localStorage and read back by an inline script in the document head (see
 * layout.tsx), before the first paint. Without that the server sends the light theme, the browser paints
 * it, and the stored dark theme arrives a frame later -- a white flash on every navigation, which is worse
 * than having no dark theme at all.
 *
 * Every storage access is wrapped: localStorage throws outright in some privacy modes rather than returning
 * null, and a theme toggle must not be able to break the page it sits on. A failed write costs the
 * preference, not the session.
 */

type Choice = "system" | "light" | "dark";
const KEY = "as-amended-theme";
const NEXT: Record<Choice, Choice> = { system: "light", light: "dark", dark: "system" };

function apply(choice: Choice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* the preference will not survive the tab; the page still works */
  }
}

export function ThemeToggle() {
  // Starts as "system" on the server and on first client render, which matches what the inline script has
  // already put on <html>; reading localStorage during render would make the two disagree and hydrate wrong.
  const [choice, setChoice] = useState<Choice>("system");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let stored: Choice = "system";
    try {
      const v = localStorage.getItem(KEY);
      if (v === "light" || v === "dark") stored = v;
    } catch {
      /* unreadable storage is the same as no preference */
    }
    setChoice(stored);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const resolve = () => setDark(stored === "dark" || (stored === "system" && mq.matches));
    resolve();
    // Only while following the system: once a choice is stored, the OS changing is not our business.
    if (stored === "system") {
      mq.addEventListener("change", resolve);
      return () => mq.removeEventListener("change", resolve);
    }
  }, []);

  function cycle() {
    const next = NEXT[choice];
    apply(next);
    setChoice(next);
    setDark(next === "dark" || (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches));
  }

  const label = choice === "system" ? "Following your system" : choice === "dark" ? "Dark" : "Light";
  return (
    <button
      type="button"
      onClick={cycle}
      // The full state in the accessible name, because the icon alone cannot say "following your system".
      aria-label={`Theme: ${label}. Change it.`}
      title={`Theme: ${label} — click to change`}
      className="no-print inline-flex items-center gap-1.5 rounded border border-[var(--rule-strong)] bg-[var(--paper)] px-2 py-1 text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)]"
    >
      <Glyph dark={dark} />
      <span className="hidden sm:inline">{choice === "system" ? "Auto" : dark ? "Dark" : "Light"}</span>
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
      <path d="M8 .9v2.0M8 13.1v2.0M.9 8h2.0M13.1 8h2.0M2.9 2.9l1.4 1.4M11.7 11.7l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
