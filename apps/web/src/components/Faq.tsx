/* An expandable FAQ, built on <details> and <summary>.
 *
 * Server components with no JavaScript at all. The browser already implements this control: it opens and
 * closes, it is in the tab order, it announces its state to a screen reader, it is found by the browser's
 * own find-in-page even while collapsed, and it works before hydration and with scripting off. A React
 * version of the same thing would be about sixty lines, ship to every reader, and do all of that slightly
 * worse.
 *
 * `name` makes the group an accordion in browsers that support it -- opening one closes the rest -- and is
 * ignored by those that do not, where every item simply opens independently. That is a clean degradation,
 * so it costs nothing to use.
 */

export function Faq({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-[var(--rule)] border-y border-[var(--rule)]">{children}</div>;
}

export function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details name="faq" className="group py-1">
      <summary className="flex cursor-pointer list-none items-start gap-2.5 py-2.5 text-[15px] font-medium text-[var(--ink)] [&::-webkit-details-marker]:hidden">
        {/* Drawn rather than relying on the default triangle, which differs between browsers and cannot be
            positioned. Rotates on open; the transition is the only motion on the page. */}
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          aria-hidden="true"
          className="mt-[5px] shrink-0 text-[var(--ink-4)] transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m5.5 3 5 5-5 5" />
        </svg>
        <span>{q}</span>
      </summary>
      <div className="space-y-3 pb-3.5 pl-[23px] text-[14px] leading-[1.7] text-[var(--ink-2)]">{children}</div>
    </details>
  );
}
