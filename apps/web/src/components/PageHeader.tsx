import Link from "next/link";

/* One header for every page, because seven pages had seven of them.
 *
 * The breadcrumb trails had drifted apart in every way a trail can: the history view began at "Acts & Rules"
 * with no Home at all, definitions read "Home / definitions" in lower case, the reading view ended in
 * "/ text" and "/ the official PDF", and an instrument was named by its short code in one trail and by its
 * full title in another. Some trails were hidden when printing and some were not. Three pages had no trail
 * at all, so there was no way back except the browser's own button.
 *
 * Titles had drifted too -- one page set its own font size and weight inline rather than using the shared
 * page-title, so it sat a size away from every other heading on the site.
 *
 * None of that is visible as a bug on any single page. It is only visible when you move between them, which
 * is exactly what a reader does.
 */

export type Crumb = { label: string; href?: string };

/** The trail. Home is prepended here so no page can forget it, and so it reads the same everywhere. */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  const all: Crumb[] = [{ label: "Home", href: "/" }, ...trail];
  return (
    <nav aria-label="Breadcrumb" className="crumbs no-print">
      {all.map((c, i) => (
        <span key={`${c.label}-${i}`}>
          {i > 0 && <span aria-hidden="true"> / </span>}
          {c.href && i < all.length - 1 ? (
            <Link href={c.href}>{c.label}</Link>
          ) : (
            <span aria-current={i === all.length - 1 ? "page" : undefined}>{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Title, optional one-line explanation, and an optional figure on the right. */
export function PageHeader({
  trail,
  title,
  lede,
  aside,
  children,
}: {
  trail?: Crumb[];
  title: React.ReactNode;
  lede?: React.ReactNode;
  /** Counts and the like, set right on wide screens and below the lede on a phone. */
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="border-b border-[var(--rule)] pb-3">
      {trail && <Breadcrumbs trail={trail} />}
      <div className="mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {lede && <p className="meta mt-1 max-w-3xl">{lede}</p>}
        </div>
        {aside && <div className="meta num">{aside}</div>}
      </div>
      {children}
    </header>
  );
}
