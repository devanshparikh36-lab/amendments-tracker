import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { fmtDateTime } from "@/lib/format";
import { lastRevised } from "@/lib/queries";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Regulation Tracker — K C Mehta & Co",
    template: "%s · Regulation Tracker",
  },
  description:
    "Consolidated Indian tax and corporate law with every amendment and the regulator's own text alongside. Internal research aid of K C Mehta & Co.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Shown small, in the header: when the collection last checked the regulators' sites.
  let revised: { checked: string | null; added: string | null } = { checked: null, added: null };
  try {
    revised = await lastRevised();
  } catch {
    // the header must render even if the database is briefly unreachable
  }
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
        >
          Skip to content
        </a>

        <header className="no-print border-b border-[var(--rule)] bg-[var(--paper)]">
          <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-6 gap-y-2 px-5 pt-3">
            <Link href="/" className="group leading-tight">
              <span className="block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-4)]">
                K C Mehta &amp; Co
              </span>
              <span className="serif block text-[19px] font-semibold tracking-tight text-[var(--ink)] group-hover:text-[var(--accent)]">
                Regulation Tracker
              </span>
            </Link>

            {(revised.checked || revised.added) && (
              <Link
                href="/status"
                title="When the collector last checked the regulators' websites"
                className="order-last w-full text-[11px] text-[var(--ink-4)] hover:text-[var(--ink-2)] sm:order-none sm:w-auto"
              >
                Last checked {fmtDateTime(revised.checked ?? revised.added)}
              </Link>
            )}

            <form action="/find" role="search" className="ml-auto flex min-w-[16rem] flex-1 items-center gap-1.5 sm:max-w-md">
              <label htmlFor="header-q" className="sr-only">
                Search sections, regulations and notifications
              </label>
              <input
                id="header-q"
                name="q"
                className="field min-w-0 flex-1"
                placeholder="80C · LODR 17 · section 16 CGST · ECB"
              />
              <button className="btn">Look up</button>
            </form>
          </div>
          <div className="mx-auto max-w-[1360px] px-3.5 pt-1">
            <SiteNav />
          </div>
        </header>

        <main id="main" className="mx-auto max-w-[1360px] px-5 py-6">
          {children}
        </main>

        <footer className="no-print mx-auto max-w-[1360px] px-5 pb-10 pt-6">
          <div className="border-t border-[var(--rule)] pt-3 text-[12px] leading-relaxed text-[var(--ink-3)]">
            <p>
              Statutory text is reproduced as the regulator publishes it, in the regulator&rsquo;s own formatting, with
              a link to the official document on every screen. Provisions marked{" "}
              <span className="font-medium text-[var(--flag-machine)]">machine-consolidated</span> were merged
              automatically and have not been read by a person. Instruments the regulator issues only as a PDF are
              served as that PDF; text read out of those pages is a finding aid, never the official rendering.
            </p>
            <p className="mt-1.5">
              Internal research aid of K C Mehta &amp; Co. Not legal advice.{" "}
              <Link href="/status" className="text-[var(--link)] hover:underline">
                Collection status
              </Link>
              .
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
