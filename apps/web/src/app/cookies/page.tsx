import Link from "next/link";
import { Prose, Section } from "@/components/Prose";

export const metadata = {
  title: "Cookies",
  description:
    "This site sets no cookies — not even for the account, which is kept in your browser's own local storage and never attached to a request. Three values are stored on your device and this page lists all of them.",
};

/* A cookie policy for a site with no cookies.
 *
 * Kept as its own page rather than folded into the privacy notice because people look for it by name, and
 * because the answer is worth being able to link to on its own. It is short because the truth is short,
 * and padding it out with the usual taxonomy of strictly-necessary, functional, analytical and marketing
 * cookies would imply this site has some.
 *
 * Checked against production, not against intent: no response from any route carries a Set-Cookie header,
 * the account routes included, and `document.cookie` appears nowhere in the source but in this comment and
 * the matching one on /privacy.
 *
 * Rewritten on 14 October 2026, when accounts shipped. The headline claim survived intact and that is not
 * luck -- identity is held in localStorage precisely so that it is never attached to a request, which keeps
 * every page cacheable at the edge and keeps this page true. What did not survive was "there is no account
 * to stay signed in to", which is exactly the kind of supporting sentence that quietly turns a correct
 * policy into a false one.
 */
export default function CookiesPage() {
  return (
    <Prose
      title="Cookies"
      lede="This site sets no cookies. There is no consent banner because there is nothing to consent to. A few things are stored on your own device instead, and they are all listed below."
    >
      <Section id="none" heading="No cookies are set">
        <p>
          Not for analytics, not for advertising, not for sessions, not for preferences, and not for the account.
          No response from this site carries a <code className="num">Set-Cookie</code> header, and nothing in its
          code writes one. No third-party script runs here that might set one on the way past, because no
          third-party script runs here at all.
        </p>
        <p>
          This is why you have not been asked to accept anything. A consent banner exists to obtain permission for
          cookies that are not strictly necessary; with none of any kind, a banner would be a click demanded for no
          reason, standing between a reader and an Act.
        </p>
      </Section>

      <Section id="local" heading="What is stored in your browser instead">
        <p>
          Three values, at most, and only once you have done the thing that creates each one. They live in your
          browser&rsquo;s local storage:
        </p>
        <div className="panel panel-body space-y-2">
          <p className="num text-[13px] text-[var(--ink)]">as-amended-theme = &ldquo;dark&rdquo; | &ldquo;light&rdquo;</p>
          <p className="num text-[13px] text-[var(--ink)]">as-amended-reader = &#123; email, name &#125;</p>
          <p className="num text-[13px] text-[var(--ink)]">as-amended-seen = [ what has landed since your last visit ]</p>
        </div>
        <p>
          The first is written when you press the theme button. The second is written when you enter an email
          address to keep follows, bookmarks and notes, and it is what lets the site greet you and show you your
          own lists on the next visit without asking again. The third is a short list the site keeps so it can
          mark what the collection has picked up since you were last here.
        </p>
        <p>
          Local storage is not a cookie, and the difference is the part that matters rather than a technicality: a
          cookie is attached to every single request your browser makes to this site, so the server sees it
          whether or not it needs it. None of these is ever attached to anything. They are read by the page itself,
          on your device. The theme and the seen-list are never transmitted at all. Your address is sent only when
          a request genuinely needs to know whose list to touch &mdash; opening the account panel, following a
          section, saving a note &mdash; and never on an ordinary page view.
        </p>
        <p>
          This is also why the site is fast. Because nothing identifying rides along with a page request, every
          page can be cached and served from the edge, which a cookie would have made impossible.
        </p>
        <p>
          Clearing your browser&rsquo;s site data removes all three. That signs the account out on this device and
          returns the site to the light theme, as it opens for anyone who has never pressed the button. It does
          not delete the account itself &mdash; entering the same address again brings the lists back. To delete
          the account and everything in it, use the delete button in the account panel, which is described in the{" "}
          <Link href="/privacy#rights" className="text-[var(--link)] hover:underline">
            privacy notice
          </Link>
          .
        </p>
      </Section>

      <Section id="counting" heading="How pages are counted without cookies">
        <p>
          Page views are counted, and the counting is deliberately built so that no cookie or identifier is needed:
          a counter for that kind of page is incremented, and nothing is written about who opened it. This holds
          whether or not you have an account &mdash; the counting has no idea either way, and the two are never
          joined. The cost of that choice is that this site can report views and cannot report visitors. That is
          the right trade for a site people read while drafting.
        </p>
        <p>
          The full description is in the{" "}
          <Link href="/privacy#collected" className="text-[var(--link)] hover:underline">
            privacy notice
          </Link>
          .
        </p>
      </Section>

      <Section id="elsewhere" heading="Following a link to a regulator">
        <p>
          Every provision here links to the regulator&rsquo;s own page or file &mdash; the income-tax department,
          the Reserve Bank, SEBI, the Ministry of Corporate Affairs and so on. Those are other people&rsquo;s
          websites, they set their own cookies, and this notice does not reach them. Opening an official document
          puts you on that regulator&rsquo;s site under its terms, not these.
        </p>
      </Section>
    </Prose>
  );
}
