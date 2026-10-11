import Link from "next/link";
import { Prose, Section } from "@/components/Prose";

export const metadata = {
  title: "Cookies",
  description:
    "This site sets no cookies. One preference — light or dark — is stored in your own browser and never sent anywhere.",
};

/* A cookie policy for a site with no cookies.
 *
 * Kept as its own page rather than folded into the privacy notice because people look for it by name, and
 * because the answer is worth being able to link to on its own. It is short because the truth is short,
 * and padding it out with the usual taxonomy of strictly-necessary, functional, analytical and marketing
 * cookies would imply this site has some.
 *
 * Checked against production, not against intent: no response from any route carries a Set-Cookie header,
 * and `document.cookie` appears nowhere in the source.
 */
export default function CookiesPage() {
  return (
    <Prose
      title="Cookies"
      lede="This site sets no cookies. There is no consent banner because there is nothing to consent to."
    >
      <Section id="none" heading="No cookies are set">
        <p>
          Not for analytics, not for advertising, not for sessions, not for preferences. There is no account to
          stay signed in to and no third-party script that might set one on the way past. No response from this
          site carries a <code className="num">Set-Cookie</code> header, and nothing in its code writes one.
        </p>
        <p>
          This is why you have not been asked to accept anything. A consent banner exists to obtain permission for
          cookies that are not strictly necessary; with none of any kind, a banner would be a click demanded for no
          reason, standing between a reader and an Act.
        </p>
      </Section>

      <Section id="local" heading="One thing is stored in your browser">
        <p>
          Choosing the dark theme writes a single value to your browser&rsquo;s local storage:
        </p>
        <div className="panel panel-body">
          <p className="num text-[13px] text-[var(--ink)]">as-amended-theme = &ldquo;dark&rdquo; | &ldquo;light&rdquo;</p>
        </div>
        <p>
          Local storage is not a cookie, and the difference is the part that matters rather than a technicality: a
          cookie is attached to every request your browser makes to this site, so the server sees it. This value is
          never attached to anything. It is read by the page itself, on your device, to decide which theme to paint
          before the first frame. It is never transmitted, it reaches no server, and it tells nobody anything about
          you &mdash; it could not identify you even if it were sent, because it is one of two words.
        </p>
        <p>
          It is set only when you press the theme button. Clearing your browser&rsquo;s site data removes it, and
          the site then opens in the light theme as it does for anyone who has never pressed the button.
        </p>
      </Section>

      <Section id="counting" heading="How pages are counted without cookies">
        <p>
          Page views are counted, and the counting is deliberately built so that no cookie or identifier is needed:
          a counter for that kind of page is incremented, and nothing is written about who opened it. The cost of
          that choice is that this site can report views and cannot report visitors. That is the right trade for a
          site people read while drafting, and it is the reason this page can be this short.
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
