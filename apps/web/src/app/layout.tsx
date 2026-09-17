import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SearchBox } from "@/components/SearchBox";
import { SiteNav } from "@/components/SiteNav";
import { fmtDateTime } from "@/lib/format";
import { lastRevised } from "@/lib/queries";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "As Amended — Indian tax and corporate law",
    template: "%s · As Amended",
  },
  description:
    "Indian tax and corporate law in the regulator's own words, with the amendment trail beside it: which notification changed which provision, and when, linked to the official document.",
};

// Its own export, not a key inside `metadata`. Next 15 ignores it there — silently, apart from a build
// warning — and without the tag a phone renders the page at about 980px and zooms out to fit, so every
// responsive breakpoint below `lg` never engages and the text arrives unreadably small.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
                As Amended
              </span>
              {/* The wordmark already says "as amended"; the strapline should add the subject and the
                  promise rather than repeat it. */}
              <span className="block text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--ink-4)]">
                Indian tax &amp; corporate law, in the regulator&rsquo;s words
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
                <SearchBox id="header-q" placeholder="80C · LODR 17 · section 16 CGST · ECB" />
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

            {/* Under the caveat, a step quieter: a signature, not something competing with the line that
                tells a reader what they may rely on. The mark is an inline SVG rather than an image file --
                it needs no request, survives any zoom, and takes its colour from the link around it. */}
            <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--ink-4)]">
              <span>Built with Claude; Curated by Devansh Parikh</span>
              <a
                href="https://www.linkedin.com/in/devanshparikhh"
                target="_blank"
                rel="noreferrer me"
                aria-label="Devansh Parikh on LinkedIn"
                className="inline-flex items-center text-[#0a66c2] hover:opacity-70"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-[13px] w-[13px]">
                  <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z" />
                </svg>
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
