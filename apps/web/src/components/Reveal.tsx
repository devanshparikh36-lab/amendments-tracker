"use client";

import { useEffect } from "react";

/* Fades sections in as they come into view.
 *
 * Mounted once in the root layout. It finds everything carrying `.reveal` and
 * watches it, rather than each section needing its own component and its own
 * observer -- one observer for a page costs a great deal less than forty.
 *
 * The important part is which way round the states are. An element with
 * `.reveal` is visible; the hidden state lives on `.reveal-armed`, which this
 * file is the only thing that ever adds, and only after confirming the browser
 * has IntersectionObserver. The usual arrangement -- hidden in CSS, revealed by
 * script -- leaves the element invisible for ever if the script does not run.
 * On a site whose whole job is to show people the text of the law, a provision
 * that never appears because an observer failed is unacceptable in a way that a
 * missing animation is not. So: no JavaScript, old browser, reduced motion,
 * crawler and failed chunk all get the page exactly as it is today.
 *
 * It re-runs on navigation because this is a single-page app once hydrated:
 * without that, moving from one section to the next would leave the new page's
 * elements armed and never observed. Hence the MutationObserver rather than a
 * pathname dependency -- the content can also arrive late, streamed in after
 * the route itself has settled.
 */
export function Reveal() {
  useEffect(() => {
    // Both are old enough to assume almost anywhere, and the whole feature is
    // skipped where they are missing rather than degrading to something worse.
    if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return;

    // Someone who has asked for less motion gets the page with no animation at
    // all, which means never arming anything. The CSS says the same thing; this
    // avoids the work entirely.
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (still?.matches) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          // Once shown, stop watching. These are one-way: a section that fades
          // out again as you scroll back up is a page that will not sit still.
          io.unobserve(e.target);
        }
      },
      // A little before the edge, so the fade finishes about when the section
      // reaches comfortable reading height rather than starting there.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );

    function arm() {
      for (const el of document.querySelectorAll<HTMLElement>(".reveal:not(.reveal-armed)")) {
        // Anything already on screen when the page loads is left alone. Arming
        // it would fade in the thing the reader is looking at, which reads as a
        // slow page rather than as polish.
        const top = el.getBoundingClientRect().top;
        if (top < window.innerHeight * 0.92) {
          el.classList.add("reveal-armed", "is-in");
          continue;
        }
        el.classList.add("reveal-armed");
        io.observe(el);
      }
    }

    arm();
    const mo = new MutationObserver(arm);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, []);

  return null;
}
