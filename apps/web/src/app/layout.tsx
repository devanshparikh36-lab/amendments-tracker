import type { Metadata, Viewport } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import { CommandPalette } from "@/components/CommandPalette";
import { ReadingAids } from "@/components/ReadingAids";
import { PageViews } from "@/components/PageViews";
import { Reveal } from "@/components/Reveal";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeSync } from "@/components/ThemeSync";
import { SiteNav } from "@/components/SiteNav";
import { fmtDateTime } from "@/lib/format";
import { lastRevised } from "@/lib/queries";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

/* Self-hosted at build time, not fetched from Google at run time: the files are served from this origin, so
 * there is no third-party request, nothing for a blocker or a strict CSP to catch, and no visitor handed to
 * Google merely for reading an Act.
 *
 * Both are variable fonts, so every weight the site uses arrives in one file each.
 *
 * Neither loads an italic. Source Serif never needs one -- the statutory text is set in it and statutes do
 * not italicise. Inter needs one in four places of interface prose, which is not worth another 45 KB on every
 * visit; the browser slants it instead, and at that size and frequency the difference is not worth paying
 * for. Add `style: ["normal", "italic"]` here if that ever stops being true.
 */
const serif = Source_Serif_4({ subsets: ["latin"], display: "swap", variable: "--font-serif" });
const sans = Inter({ subsets: ["latin"], display: "swap", variable: "--font-ui" });

const DESCRIPTION =
  "Indian tax and corporate law in the regulator's own words, with the amendment trail beside it: which notification changed which provision, and when, linked to the official document.";

export const metadata: Metadata = {
  // Everything below that carries a URL is written relative; this is what makes those absolute. Without it
  // Next emits a relative og:image, and every scraper there is ignores one — which is indistinguishable
  // from having no card at all, and only visible once a link is already pasted somewhere public.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "As Amended — Indian tax and corporate law",
    template: "%s · As Amended",
  },
  description: DESCRIPTION,

  /* The card shown when a link is pasted into Teams, WhatsApp, Slack or an email.
   *
   * The image itself is not named here: `opengraph-image.png` sits beside this file and Next finds it by
   * convention, emitting the tags with the right absolute URL and dimensions. Naming it as well would
   * produce two og:image tags, and scrapers disagree about which wins.
   *
   * en_IN rather than en_GB or en_US. It is the correct locale for the material, and it is the one signal
   * in here that tells a scraper which English this is.
   */
  openGraph: {
    type: "website",
    siteName: "As Amended",
    title: "As Amended — Indian tax and corporate law",
    description: DESCRIPTION,
    locale: "en_IN",
    url: "/",
  },
  // summary_large_image, not summary: the card is 1200x630 and the small variant crops it to a square,
  // which cuts the sentence in half. No `site` or `creator` handle, because there is no account to name.
  twitter: {
    card: "summary_large_image",
    title: "As Amended — Indian tax and corporate law",
    description: DESCRIPTION,
  },
  // So a feed reader, Outlook or Teams finds the feed from any page without being told its address. The
  // route also accepts ?regulator= and ?instrument= for a narrower subscription; this advertises the whole
  // thing, which is the right default for discovery.
  alternates: {
    types: {
      "application/atom+xml": [{ url: "/feed.xml", title: "As Amended — every notification and circular" }],
    },
  },
};

// Its own export, not a key inside `metadata`. Next 15 ignores it there — silently, apart from a build
// warning — and without the tag a phone renders the page at about 980px and zooms out to fit, so every
// responsive breakpoint below `lg` never engages and the text arrives unreadably small.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/* Ten minutes, and not force-dynamic.
 *
 * This is the root layout, so whatever it declares applies to every route beneath it. `force-dynamic` here
 * meant all twenty routes were server-rendered on demand, and Next sent `Cache-Control: private, no-cache,
 * no-store` with every one of them -- so no page was ever cached by anyone, and reloading the same section
 * twice invoked a function twice. That is what ran an account out of credits.
 *
 * The only reason it was dynamic is the "Last checked" stamp below, which reads the database on every
 * request to show a value that changes once a day, when collection runs at 07:00. Ten minutes of staleness
 * on that is invisible; a database round trip per page view is not.
 *
 * Pages that genuinely need per-request rendering still get it: reading searchParams makes a route dynamic
 * on its own, which is most of them here, and that is the right reason rather than a blanket setting.
 */
export const revalidate = 600;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Shown small, in the header: when the collection last checked the regulators' sites.
  let revised: { checked: string | null; added: string | null } = { checked: null, added: null };
  try {
    revised = await lastRevised();
  } catch {
    // the header must render even if the database is briefly unreachable
  }
  return (
    // `suppressHydrationWarning` only because of the theme script below, and only on this element: it
    // sets data-theme on <html> before React hydrates, so the server's markup and the live DOM differ by
    // that one attribute *by design*. Without this React logs a hydration mismatch on every page load --
    // noise that would eventually hide a real one. It does not suppress anything inside the tree.
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${serif.variable}`}>
      <head>
        {/* Runs before the first paint, which is the only moment it is any use.
            
            The server has no way to know a reader's theme -- it is in their browser, not in the request --
            so it always renders the light one. Without this the browser paints that, then the stored dark
            theme arrives a frame later: a white flash on every single navigation, which is more annoying
            than having no dark theme at all.
            
            Deliberately not a module: a script that has to run before paint cannot be one that is fetched.
            It is four lines, it touches only `data-theme`, and it swallows its own errors because
            localStorage throws outright in some privacy modes. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('as-amended-theme')==='dark'?'dark':'light';" +
              "var r=document.documentElement;r.setAttribute('data-theme',t);r.style.colorScheme=t;}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        {/* Re-asserts the theme after hydration. React removes `data-theme` from <html> because the
            server never rendered it, which made the dark theme fail to survive a page load at all.
            See ThemeSync for the whole account. */}
        <ThemeSync />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:border focus:border-[var(--rule-strong)] focus:bg-[var(--paper)] focus:px-3 focus:py-2 focus:text-[var(--ink)]"
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

            {/* The stamp qualifies everything on the page ("as of when?"), so it belongs where the eye lands
                last on the header rather than inline beside the masthead, where it read as part of the
                title.

                A row, not a column. Stacked, the toggle was pinned to the top edge of the header with the
                stamp above it; side by side with items-center, both sit on the masthead's own centre line.
                It still wraps to its own full-width row on a narrow screen, where there is no room beside
                the wordmark for either of them. */}
            <div className="ml-auto flex w-full items-center justify-end gap-x-4 gap-y-1 sm:w-auto">
              {(revised.checked || revised.added) && (
                <Link
                  href="/status"
                  title="When the collector last checked the regulators' websites"
                  className="text-[11px] leading-none text-[var(--ink-4)] hover:text-[var(--ink-2)]"
                >
                  Last checked {fmtDateTime(revised.checked ?? revised.added)}
                </Link>
              )}

              {/* The search box that used to sit here is gone, and with it the "Look up" button.
                  A box in the masthead is a box on every screen, including the ones that have their own and
                  better-scoped one, and it answered about the whole site even while you were reading a
                  single Act. Search is now the palette below -- one keystroke from anywhere -- plus a real
                  box on the pages where searching is the point. */}
              {/* The corner the "Look up" button used to occupy, and now only the theme. A search box in
                  the masthead is a search box on every screen, including the ones that have their own and
                  better-scoped one; the page you are on asks a better question than the header can. The
                  palette is still mounted -- Ctrl-K and "/" open it from anywhere -- but it no longer
                  advertises itself with a box of its own up here. */}
              <ThemeToggle />
            </div>
          </div>
          <div className="mx-auto max-w-[1360px] px-3.5 pt-1">
            <SiteNav />
          </div>
        </header>

        {/* Mounted for its keyboard shortcut alone. It renders its own overlay when opened and nothing at
            all until then, so it costs no space in the masthead it used to sit in. */}
        <CommandPalette hideTrigger />

        {/* The progress bar and the button back to the top. Both measure the page and hide themselves on
            anything short enough not to need them, so this costs nothing on the home page and earns its
            place on the Companies Act, which lists 544 sections on one screen. */}
        <ReadingAids />

        {/* Counts the page, and nothing about whoever is reading it. First-party, no cookie, no identifier
            -- see /api/beacon for what is stored and the privacy page for the promise it keeps. */}
        <PageViews />

        {/* Watches for anything carrying .reveal and fades it in as it arrives. One observer for the
            whole page rather than one per section. It arms the hidden state itself, so nothing is
            invisible unless this has run -- see Reveal for why that ordering matters here. */}
        <Reveal />

        <main id="main" className="mx-auto max-w-[1360px] px-5 py-6">
          {children}
        </main>

        <footer className="no-print mx-auto max-w-[1360px] px-5 pb-10 pt-6">
          {/* Two paragraphs used to sit here, on every screen: how the statutory text is reproduced, and
              that this is a research aid rather than advice. Both now live where someone would go to read
              them -- the first is section "The regulator's document is the authority" in the terms, and the
              FAQ on /about answers it again in plainer words -- and neither is lost by going.
              
              One sentence stays. It is the only part a reader needs in front of them rather than one click
              away, it is eight words, and the link beside it reaches the full statement. */}
          <div className="border-t border-[var(--rule)] pt-3 text-[12px] leading-relaxed text-[var(--ink-3)]">
            <p>
              A research aid, not legal advice.{" "}
              <Link href="/terms" className="hover:text-[var(--ink-2)] hover:underline">
                Read the terms
              </Link>
              .
            </p>
            {/* The written pages. Kept out of the main navigation on purpose -- someone looking up a section
                is not looking for the terms -- but a site that publishes a privacy notice and then hides it
                has not really published one. */}
            <nav aria-label="Site information" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
              <Link href="/about" className="hover:text-[var(--ink-2)] hover:underline">
                About
              </Link>
              <Link href="/privacy" className="hover:text-[var(--ink-2)] hover:underline">
                Privacy
              </Link>
              <Link href="/cookies" className="hover:text-[var(--ink-2)] hover:underline">
                Cookies
              </Link>
              <Link href="/terms" className="hover:text-[var(--ink-2)] hover:underline">
                Terms
              </Link>
              <Link href="/feed.xml" className="hover:text-[var(--ink-2)] hover:underline">
                Feed
              </Link>
              <Link href="/status" className="hover:text-[var(--ink-2)] hover:underline">
                Collection status
              </Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
