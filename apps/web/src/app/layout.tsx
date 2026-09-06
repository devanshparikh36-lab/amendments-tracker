import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Regulation Tracker",
  description: "Consolidated Indian tax and corporate law with every amendment and the official source alongside",
};

const nav = [
  { href: "/", label: "Home" },
  { href: "/browse", label: "Acts & Rules" },
  { href: "/documents", label: "Notifications" },
  { href: "/compare/income-tax", label: "1961 ↔ 2025" },
  { href: "/status", label: "Status" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
          Skip to content
        </a>
        <header className="no-print border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5">
            <Link href="/" className="text-[15px] font-semibold tracking-tight text-stone-900">
              Regulation Tracker
            </Link>
            <nav aria-label="Sections" className="flex flex-wrap gap-4 text-[13.5px] text-stone-600">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-stone-900 hover:underline">
                  {n.label}
                </Link>
              ))}
            </nav>
            <form action="/find" role="search" className="ml-auto flex items-center gap-1.5">
              <label htmlFor="header-q" className="sr-only">
                Search sections, regulations and notifications
              </label>
              <input
                id="header-q"
                name="q"
                placeholder="80C · regulation 17 LODR · ECB"
                className="w-72 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm placeholder:text-stone-400 focus:border-stone-500 focus:outline-none"
              />
              <button className="rounded-md border border-stone-300 px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-100">
                Go
              </button>
            </form>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1400px] px-5 py-6">
          {children}
        </main>
        <footer className="no-print mx-auto max-w-[1400px] px-5 pb-10 pt-4 text-xs leading-relaxed text-stone-500">
          Text is reproduced verbatim from the regulator&rsquo;s own publication. Provisions marked
          &ldquo;machine-consolidated&rdquo; were merged automatically and have not been reviewed by a person; the
          official document is always linked alongside. Internal research aid — not legal advice.
        </footer>
      </body>
    </html>
  );
}
