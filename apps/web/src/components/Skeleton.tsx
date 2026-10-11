/* The pieces a loading screen is built from.
 *
 * Server components, not client ones: a skeleton is static markup shown while something else is being
 * fetched, so shipping JavaScript to draw it would mean the wait itself had a download in front of it.
 *
 * Everything here is aria-hidden and the container carries the live region, so a screen reader hears
 * "Loading" once rather than a reading of forty grey rectangles.
 */

/** One line of text. `w` is a Tailwind width class, so a skeleton paragraph can have ragged line ends
 *  rather than a suspiciously rectangular block. */
export function SkeletonLine({ w = "w-full", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`skeleton ${h} ${w}`} aria-hidden="true" />;
}

/** A run of lines with varied widths, the way a paragraph actually ends. */
export function SkeletonParagraph({ lines = 4 }: { lines?: number }) {
  const widths = ["w-full", "w-11/12", "w-full", "w-10/12", "w-9/12", "w-full"];
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} w={widths[i % widths.length]} />
      ))}
    </div>
  );
}

/** Wraps a loading screen. The live region goes here, once. */
export function SkeletonScreen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
