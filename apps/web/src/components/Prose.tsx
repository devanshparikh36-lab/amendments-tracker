import Link from "next/link";
import { LEGAL_UPDATED } from "@/lib/legal";

/* The shell the written pages share -- privacy, cookies, terms, about.
 *
 * A narrower measure than the rest of the site on purpose. Everything else here is a table, an index or a
 * provision, and those want the full width; these are prose, and prose set across 1,360px is unreadable.
 * ~68 characters is the line length these settle at.
 */
export function Prose({
  title,
  lede,
  dated = true,
  children,
}: {
  title: string;
  lede?: string;
  dated?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className="mx-auto max-w-[68ch] py-2">
      {/* Front-door pages, so the title gets the display treatment and the same textured ground as the
          home page. The measure stays at 68ch; nothing about the prose changes. */}
      <header className="paper-texture -mx-5 rounded-lg border-b border-[var(--rule)] px-5 pb-4 pt-4">
        <h1 className="display">{title}</h1>
        {lede && <p className="mt-2 text-[15px] leading-relaxed text-[var(--ink-2)]">{lede}</p>}
        {dated && <p className="mt-2 text-[12px] text-[var(--ink-4)]">In force from {LEGAL_UPDATED}.</p>}
      </header>
      <div className="mt-6 space-y-6 text-[14.5px] leading-[1.7] text-[var(--ink-2)]">{children}</div>
      <footer className="mt-10 border-t border-[var(--rule)] pt-3 text-[12.5px] text-[var(--ink-3)]">
        <nav className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/about" className="hover:underline">About</Link>
          <Link href="/privacy" className="hover:underline">Privacy</Link>
          <Link href="/cookies" className="hover:underline">Cookies</Link>
          <Link href="/terms" className="hover:underline">Terms</Link>
        </nav>
      </footer>
    </article>
  );
}

/** A numbered section. The heading is the thing people link to, so it gets an id. */
export function Section({ id, heading, children }: { id: string; heading: string; children: React.ReactNode }) {
  return (
    <section id={id} className="reveal scroll-mt-20">
      <h2 className="serif text-[18px] font-semibold text-[var(--ink)]">{heading}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
