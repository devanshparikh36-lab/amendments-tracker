import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Regulation Tracker",
  description: "Consolidated Indian regulations with every amendment in one place",
};

const nav = [
  { href: "/", label: "What's new" },
  { href: "/browse", label: "Regulations" },
  { href: "/documents", label: "Documents" },
  { href: "/compare/income-tax", label: "1961 vs 2025" },
  { href: "/search", label: "Search" },
  { href: "/status", label: "Status" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link href="/" className="font-semibold tracking-tight">
              Regulation Tracker
            </Link>
            <nav className="flex gap-4 text-sm text-stone-600">
              {nav.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-stone-900">
                  {n.label}
                </Link>
              ))}
            </nav>
            <form action="/search" className="ml-auto">
              <input
                name="q"
                placeholder="Search text…"
                className="w-64 rounded-md border border-stone-300 px-3 py-1.5 text-sm focus:border-stone-500 focus:outline-none"
              />
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-7xl px-4 py-8 text-xs text-stone-500">
          Text is scraped verbatim from official sources. Provisions marked &ldquo;machine-consolidated&rdquo; were merged
          automatically and have not been reviewed by a person; the official document is always linked alongside.
        </footer>
      </body>
    </html>
  );
}
