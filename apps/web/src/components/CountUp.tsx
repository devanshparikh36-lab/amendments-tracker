"use client";

import { useEffect, useRef, useState } from "react";

/* Counts a number up when it first comes into view.
 *
 * Used for the three figures on /about -- instruments, provisions, documents.
 *
 * The server renders the final number, not a zero. That is the whole design:
 * the markup is correct before any script runs, so no-JS, reduced motion and a
 * crawler all read "8,033 notifications" rather than "0", and the animation is
 * something that happens to a correct page rather than something the page
 * depends on. It is also why this takes the formatted string as a child and
 * only replaces it once it is sure it can.
 *
 * Counting is done on a clock rather than per frame, eased out, and it stops
 * exactly on the target -- a counter that lands on 8,032 is worse than no
 * counter, on a site where the numbers are the point.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    // Nothing to watch run up.
    if (value <= 0) return;

    let raf = 0;
    let started = false;

    const io = new IntersectionObserver(
      (entries) => {
        if (started || !entries.some((e) => e.isIntersecting)) return;
        started = true;
        io.disconnect();

        const DURATION = 900;
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / DURATION);
          // easeOutCubic: quick off the mark, settles rather than stops.
          const eased = 1 - Math.pow(1 - p, 3);
          // Math.round, and the final frame is pinned to `value` rather than
          // computed, so it cannot land a digit short.
          setShown(p === 1 ? value : Math.round(value * eased));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.2 },
    );

    io.observe(el);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {(shown ?? value).toLocaleString("en-IN")}
    </span>
  );
}
