"use client";

import { useEffect, useState } from "react";
import { applyTheme } from "@/components/ThemeSync";

/* Light or dark, in the top corner of the masthead.
 *
 * The control is the sliding pill supplied for it (Uiverse.io, by cuzpq): a bare `<input type="checkbox">`
 * styled into a track and a knob, with no inner elements at all. Its CSS lives in globals.css.
 *
 * A checkbox is the right element here and not merely the one the design came with. It is a two-state
 * control that is either on or off, it is focusable and operable from the keyboard with no help at all, and
 * assistive software announces it as a switch that is on or off. The version this replaces was a button
 * carrying aria-pressed, which says the same thing more indirectly.
 *
 * Two states and no "Auto". The first version followed the operating system until told otherwise, which is
 * the conventional answer and not the one wanted here: a theme that changes by itself is a page that looks
 * different from the one you left, and this is a site people keep open beside a return they are drafting.
 * So the only input is this control, the choice is remembered, and light is what a reader gets until they
 * say otherwise -- which also happens to match what comes out of the printer.
 *
 * The choice is written to localStorage and read back by an inline script in the document head (see
 * layout.tsx) before the first paint. Without that the server sends the light theme, the browser paints it,
 * and a stored dark theme arrives a frame later -- a white flash on every navigation, which is worse than
 * having no dark theme at all.
 *
 * That script is necessary and was not sufficient: React removes `data-theme` from <html> when it hydrates,
 * because the server never rendered it. ThemeSync puts it back before the browser paints and keeps it there.
 * This control only writes the preference and applies it; ThemeSync owns keeping it applied.
 *
 * Every storage access is wrapped: localStorage throws outright in some privacy modes rather than returning
 * null, and a theme control must not be able to break the page it sits on. A failed write costs the
 * preference, not the session.
 */

const KEY = "as-amended-theme";

export function ThemeToggle() {
  // Unchecked on the server and on the first client render, which is the markup the server sent. Reading
  // localStorage during render would make the two disagree.
  const [dark, setDark] = useState(false);

  useEffect(() => {
    try {
      setDark(localStorage.getItem(KEY) === "dark");
    } catch {
      /* unreadable storage is the same as no preference */
    }
  }, []);

  function toggle(next: boolean) {
    // Storage first, then the DOM. ThemeSync watches `data-theme` and restores it from storage whenever the
    // two disagree, so writing the attribute before the value it is meant to reflect would have the guard
    // immediately undo the press.
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      /* the preference will not survive the tab; the page still works */
    }
    applyTheme(next ? "dark" : "light");
    setDark(next);
  }

  // Says what operating it does, not what is currently on: with two states those read the same to a sighted
  // reader and opposite to a screen reader, and the action is the useful half.
  const label = dark ? "Switch to the light theme" : "Switch to the dark theme";

  return (
    <input
      type="checkbox"
      // A checkbox announced as a switch: same element, same keyboard behaviour, described as the on/off
      // control it actually is rather than as something you tick.
      role="switch"
      className="theme-checkbox no-print"
      checked={dark}
      onChange={(e) => toggle(e.currentTarget.checked)}
      aria-label={label}
      title={label}
    />
  );
}
