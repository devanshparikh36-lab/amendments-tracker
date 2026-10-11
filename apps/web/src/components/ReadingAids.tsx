"use client";

import { useEffect, useRef, useState } from "react";

/* The progress bar across the top and the button back to the top, in one component.
 *
 * Together rather than separately because they are the same measurement: both need to know how far down a
 * long document the reader is, and two components would mean two scroll listeners doing identical
 * arithmetic on every frame of every scroll. One listener, one calculation, two things drawn.
 *
 * Both hide themselves on pages that do not need them. The Companies Act lists 544 sections and genuinely
 * wants a way back; the home page does not, and a progress bar that sits at 100% because the page barely
 * scrolls is furniture that means nothing. The test is the page's own height, re-measured on resize, so
 * nothing has to be told which pages are long.
 */

// Below this there is nothing to track: a page less than twice the viewport is one or two flicks of a
// thumb, and both aids are noise on it.
const MIN_SCROLLABLE = 1.75;
// How far down before the button appears. Roughly one screen: far enough that returning is a real journey.
const SHOW_BUTTON_AFTER = 600;

export function ReadingAids() {
  const [progress, setProgress] = useState(0);
  const [longPage, setLongPage] = useState(false);
  const [showButton, setShowButton] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const doc = document.documentElement;

    function measure() {
      const scrollable = doc.scrollHeight - window.innerHeight;
      const long = doc.scrollHeight > window.innerHeight * MIN_SCROLLABLE;
      setLongPage(long);
      if (!long) {
        setProgress(0);
        setShowButton(false);
        return;
      }
      const y = window.scrollY;
      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, y / scrollable)) : 0);
      setShowButton(y > SHOW_BUTTON_AFTER);
    }

    // Scroll fires far faster than the screen refreshes. Without this the arithmetic above runs dozens of
    // times per frame and the work is thrown away; with it, once per frame at most.
    function onScroll() {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        measure();
      });
    }

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  function toTop() {
    // `smooth` on a 544-section page is a long ride, and for anyone who has asked their system to reduce
    // motion it is exactly the kind they asked to be spared. Honour that and jump.
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <>
      {/* Drawn as a scaled element rather than by setting width, so the browser animates it on the
          compositor and never reflows the page sixty times a second while someone is scrolling it. */}
      <div
        aria-hidden="true"
        className="no-print pointer-events-none fixed inset-x-0 top-0 z-40 h-[3px]"
        style={{ opacity: longPage ? 1 : 0 }}
      >
        <div
          className="h-full origin-left bg-[var(--accent)]"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      <button
        type="button"
        onClick={toTop}
        // Hidden from everything, not just from view: a button that scrolls a page the reader has not
        // scrolled is a confusing stop on the way through the tab order.
        aria-hidden={!showButton}
        tabIndex={showButton ? 0 : -1}
        className={`no-print fixed bottom-5 right-5 z-40 inline-flex items-center gap-1.5 rounded-full border border-[var(--rule-strong)] bg-[var(--paper)] px-3 py-2 text-[12px] text-[var(--ink-2)] shadow-sm transition-opacity duration-200 hover:text-[var(--ink)] ${
          showButton ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
        </svg>
        Top
      </button>
    </>
  );
}
