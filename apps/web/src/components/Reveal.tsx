"use client";

import { useEffect } from "react";

/* Fades sections in as they come into view.
 *
 * Mounted once in the root layout. It finds everything carrying `.reveal` and
 * watches it, rather than each section needing its own component and its own
 * observer -- one observer for a page costs a great deal less than forty.
 *
 * The important part is which way round the states are. An element with
 * `.reveal` is visible; the hidden state lives on `data-reveal="armed"`, which
 * this file is the only thing that ever sets, and only after confirming the
 * browser has IntersectionObserver. The usual arrangement -- hidden in CSS,
 * revealed by script -- leaves the element invisible for ever if the script does
 * not run. On a site whose whole job is to show people the text of the law, a
 * provision that never appears because an observer failed is unacceptable in a
 * way that a missing animation is not. So: no JavaScript, old browser, reduced
 * motion, crawler and failed chunk all get the page exactly as it is today.
 *
 * This used to break hydration, and the fix has two halves.
 *
 * These elements belong to React, and this runs from the root layout, which
 * commits before the page subtree below it has hydrated -- Next wraps each route
 * segment in its own Suspense boundary, so the page arrives after the shell. So
 * this reaches into server-rendered DOM that React has not yet reconciled, and
 * React finds the DOM disagreeing with its own output.
 *
 * That was not cosmetic. On the live site it surfaced as an uncaught
 * "Minified React error #418" on every page with a revealed element.
 *
 * Half one, and the one that actually silences it: every element carrying
 * `.reveal` also carries `suppressHydrationWarning`. React's documented answer
 * for a node that external code modifies before hydration, which is exactly
 * what this is. It is a real cost -- a genuine attribute mismatch on those same
 * elements is now suppressed too -- and it is accepted because they are layout
 * wrappers whose attributes are static strings.
 *
 * IF YOU ADD `.reveal` TO A NEW ELEMENT, ADD `suppressHydrationWarning` TO IT.
 * Forgetting reintroduces that production error, and nothing in the build or the
 * type checker will tell you.
 *
 * Half two: the state is set as `data-` attributes rather than by adding two
 * classes, so the `className` React rendered is left byte-identical to what was
 * served. That is not what fixes the warning -- React 19 diffs attributes it
 * never rendered as well, which I established by trying exactly that and
 * watching the same error come back naming `data-reveal` instead of `className`.
 * It is kept because leaving React's own rendered props untouched is the right
 * hygiene regardless, and because if the suppression above is ever removed the
 * class churn will not come back with it. Specificity is unchanged:
 * `[data-reveal="armed"]` carries the same weight as the class it replaced.
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

    /* Has the observer proved it is alive?
     *
     * IntersectionObserver calls back once for every target shortly after
     * observe(), with isIntersecting false for anything off screen. So a
     * callback that never runs at all means the observer is not working -- as
     * opposed to working and simply having nothing on screen yet, which looks
     * identical if you only count reveals. Set before the loop for that reason:
     * what matters is that the callback ran, not what it decided. */
    let alive = false;

    const io = new IntersectionObserver(
      (entries) => {
        alive = true;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "";
          // Once shown, stop watching. These are one-way: a section that fades
          // out again as you scroll back up is a page that will not sit still.
          io.unobserve(e.target);
        }
      },
      // A little before the edge, so the fade finishes about when the section
      // reaches comfortable reading height rather than starting there.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
    );

    /* Which elements THIS run has already dealt with.
     *
     * The obvious guard is the armed attribute itself -- skip anything already
     * carrying it -- and that is what this did, and it was wrong in a way that
     * hid content. Effects run twice in development: mount, clean up, mount. The
     * cleanup disconnects the observer, and the second run then found every
     * element already armed, skipped them all, and observed nothing. The result
     * was a page whose lower half was armed to opacity 0 with no live observer
     * left to reveal it -- invisible for good, through any amount of scrolling.
     *
     * Production does not double-invoke, so it did not show there, which is
     * exactly what made it worth fixing properly rather than shrugging at: the
     * one environment where it does bite is the one the site is checked in.
     *
     * A WeakSet created per effect run is the honest guard. It answers "have I
     * handled this element with THIS observer", which is the actual question.
     * A new run starts empty and re-observes anything still waiting, and WeakSet
     * holds no element alive after the DOM drops it. */
    const handled = new WeakSet<Element>();

    function arm() {
      for (const el of document.querySelectorAll<HTMLElement>(".reveal")) {
        // Already shown. Nothing to arm, and nothing to watch for.
        if (el.dataset.in !== undefined) continue;
        if (handled.has(el)) continue;
        handled.add(el);

        // Anything already on screen when the page loads is left alone. Arming
        // it would fade in the thing the reader is looking at, which reads as a
        // slow page rather than as polish.
        const top = el.getBoundingClientRect().top;
        if (top < window.innerHeight * 0.92) {
          el.dataset.reveal = "armed";
          el.dataset.in = "";
          continue;
        }
        el.dataset.reveal = "armed";
        io.observe(el);
      }
    }

    arm();
    const mo = new MutationObserver(arm);
    mo.observe(document.body, { childList: true, subtree: true });

    /* The last line of defence, and the reason this feature cannot hide the law.
     *
     * Everything above protects against the observer never being constructed:
     * no JavaScript, no IntersectionObserver, reduced motion, a chunk that
     * failed to load. None of it protects against an observer that was built
     * successfully and then does not deliver -- and in that case every armed
     * element sits at opacity 0 with nothing left to clear it. Blank sections,
     * no error, no clue.
     *
     * That is not hypothetical hand-wringing. This component had exactly that
     * failure in development, from the effect running twice: the cleanup
     * disconnected the observer and the second pass armed nothing new, so the
     * lower half of a long page stayed invisible through any amount of
     * scrolling. The guard in arm() fixes that particular cause. This catches
     * the class.
     *
     * One second is long after a working observer's first callback and far
     * before a reader finishes the paragraph they are on. If nothing has called
     * back by then, the observer is not going to: unarm everything and leave the
     * page plainly visible, which is the state this whole feature is built to
     * fall back to. The cost of a false positive is a missing fade. The cost of
     * not having this is unreadable law. */
    const failsafe = window.setTimeout(() => {
      if (alive) return;
      io.disconnect();
      for (const el of document.querySelectorAll<HTMLElement>('[data-reveal="armed"]')) {
        delete el.dataset.reveal;
        delete el.dataset.in;
      }
    }, 1000);

    return () => {
      window.clearTimeout(failsafe);
      mo.disconnect();
      io.disconnect();
    };
  }, []);

  return null;
}
