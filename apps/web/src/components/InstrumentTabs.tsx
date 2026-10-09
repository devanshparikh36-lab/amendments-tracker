import Link from "next/link";

/* The four places you can be inside one instrument, in the same order and the same position on each.
 *
 * These destinations already existed and disagreed about where they lived. The instrument's own page put
 * Contents / Full text / Documents as three buttons at the foot of a panel most of the way down, after the
 * details table. The reading view put Contents / Read full text at the top, styled the same as the "open the
 * official PDF" action beside it, so a navigation choice and a download looked identical. Neither offered a
 * way back to the instrument's own page except the breadcrumb, and neither showed which of them you were
 * currently looking at.
 *
 * One row, directly under the heading on every screen, with the current tab marked.
 */

export type InstrumentTab = "about" | "text" | "full" | "documents";

export function InstrumentTabs({
  slug,
  current,
  pdfOnly = false,
  documentCount = 0,
}: {
  slug: string;
  current: InstrumentTab;
  pdfOnly?: boolean;
  documentCount?: number;
}) {
  const tabs: { key: InstrumentTab; label: string; href: string; hide?: boolean }[] = [
    { key: "about", label: "About", href: `/browse/${slug}` },
    // A PDF-served instrument has no contents to list, so the same tab says what it actually opens.
    { key: "text", label: pdfOnly ? "Official PDF" : "Contents", href: `/browse/${slug}/text` },
    { key: "full", label: "Full text", href: `/browse/${slug}/text?view=full`, hide: pdfOnly },
    {
      key: "documents",
      label: documentCount ? `Documents (${documentCount.toLocaleString("en-IN")})` : "Documents",
      href: `/documents?instrument=${slug}`,
    },
  ];

  return (
    <nav aria-label="Within this instrument" className="no-print mt-3 flex flex-wrap items-center gap-x-1 gap-y-1">
      {tabs
        .filter((t) => !t.hide)
        .map((t) => {
          const on = t.key === current;
          return (
            <Link
              key={t.key}
              href={t.href}
              aria-current={on ? "page" : undefined}
              className={`rounded-t border-b-2 px-2.5 py-1.5 text-[13.5px] ${
                on
                  ? "border-[var(--accent)] font-semibold text-[var(--ink)]"
                  : "border-transparent text-[var(--ink-3)] hover:border-[var(--rule-strong)] hover:text-[var(--ink)]"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
    </nav>
  );
}
