"use client";

import { useEffect, useLayoutEffect } from "react";

/* Keeps `data-theme` on <html> equal to the stored preference, for the whole life of the page.
 *
 * This exists because of a bug that was reported as "clicking search turns light mode dark for a while",
 * and which turned out to be worse than a flash: on the deployed site the dark theme did not survive a page
 * load at all.
 *
 * What was happening. The inline script in the document head reads localStorage and sets `data-theme`
 * before the first paint, which is right and is still there. The server cannot know a reader's theme, so
 * its HTML carries no such attribute. React then hydrates <html>, finds an attribute its own output does
 * not account for, and removes it. The page therefore painted dark, hydrated, and snapped back to light a
 * second later -- the "for a while" in the report. Meanwhile the toggle itself read the same localStorage
 * and showed "Dark" with aria-pressed="true", so the control and the page disagreed, permanently.
 *
 * `suppressHydrationWarning` on <html> does not prevent this. It suppresses the console warning; it does
 * not stop the DOM being reconciled.
 *
 * The fix is to re-assert the attribute from a layout effect. Layout effects run after React has committed
 * -- including any attribute it just removed -- and *before* the browser paints, so the removal never
 * reaches the screen. The observer below then covers anything later: a re-render, a route change, a future
 * React version that reconciles at a different moment. It only ever writes when the attribute disagrees
 * with what is stored, so it cannot loop with itself.
 */

const KEY = "as-amended-theme";

// useLayoutEffect warns when React renders this on the server. The component returns null and the effect is
// the entire point, so prefer the layout timing in the browser and fall back to useEffect during SSR.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function stored(): "dark" | "light" {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    // Storage throws outright in some privacy modes. No preference means the light theme, which is the
    // default this site ships with.
    return "light";
  }
}

/** Put the theme on <html>, and tell the browser so its own surfaces match. */
export function applyTheme(theme: "dark" | "light") {
  const root = document.documentElement;
  if (root.getAttribute("data-theme") !== theme) root.setAttribute("data-theme", theme);
  // Scrollbars, form controls and the canvas painted before the stylesheet arrives all follow
  // `color-scheme`. The stylesheet sets it too, but that is too late for the first frame of a cold load --
  // which on a dark-configured device is a flash of dark behind a light page.
  if (root.style.colorScheme !== theme) root.style.colorScheme = theme;
}

export function ThemeSync() {
  useIsomorphicLayoutEffect(() => {
    applyTheme(stored());

    const root = document.documentElement;
    // Both attributes, because React strips both and it was caught stripping only one of them: after the
    // first version of this guard, `data-theme` came back and `style="color-scheme:..."` stayed gone,
    // because the filter named only the first. Harmless in itself -- the stylesheet sets color-scheme too,
    // and by then it has already done its one job of colouring the first frame -- but a guard that half
    // works is worse than one that obviously does not.
    const observer = new MutationObserver(() => {
      const want = stored();
      if (root.getAttribute("data-theme") !== want || root.style.colorScheme !== want) applyTheme(want);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme", "style"] });
    return () => observer.disconnect();
  }, []);

  return null;
}
