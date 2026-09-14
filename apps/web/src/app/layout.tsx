import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { fmtDateTime } from "@/lib/format";
import { lastRevised } from "@/lib/queries";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Paper Trail — Indian tax and corporate law, as amended",
    template: "%s · Paper Trail",
  },
  description:
    "Indian tax and corporate law in the regulator's own words, with the amendment trail beside it: which notification changed which provision, and when, linked to the official document.",
  // The site is read on phones as often as desks, and the reading view is a two-column layout that has to
  // collapse cleanly. Without this, mobile browsers assume a desktop-width page and zoom out to fit.
  viewport: "width=device-width, initial-scale=1",
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
              <span className="serif block text-[19px] font-semibold tracking-tight text-[var(--ink)] group-hover:text-[var(--accent)]">
                Paper Trail
              </span>
              <span className="block text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">
                Indian tax &amp; corporate law, as amended
              </span>
            </Link>

            {/* The stamp sits in the top corner, above the search box: it qualifies everything on the page
                ("as of when?"), so it belongs where the eye lands last on the header rather than inline
                beside the masthead, where it read as part of the title. */}
            <div className="ml-auto flex w-full flex-col gap-1 sm:w-auto sm:items-end">
              {(revised.checked || revised.added) && (
                <Link
                  href="/status"
                  title="When the collector last checked the regulators' websites"
                  className="text-[11px] leading-none text-[var(--ink-4)] hover:text-[var(--ink-2)]"
                >
                  Last checked {fmtDateTime(revised.checked ?? revised.added)}
                </Link>
              )}

              <form action="/find" role="search" className="flex min-w-[16rem] items-center gap-1.5 sm:w-[26rem]">
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
              a link to the official document on every screen. Amendments are shown as references &mdash; which
              notification changed which provision, and when &mdash; and are never applied to the text: no wording here
              has been rewritten by a machine, so what you read is the regulator&rsquo;s own. Follow the amendment link
              to read the change in the regulator&rsquo;s words. Instruments issued only as a PDF are served as that
              PDF; text read out of those pages, including by OCR, is a finding aid, never the official rendering.
            </p>
            <p className="mt-1.5">
              A research aid, not legal advice. Always read the official document before relying on anything here.{" "}
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
