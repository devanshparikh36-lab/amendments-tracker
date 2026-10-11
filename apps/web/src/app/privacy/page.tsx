import Link from "next/link";
import { Prose, Section } from "@/components/Prose";
import { CONTACT_EMAIL, JURISDICTION, PROCESSORS, PUBLISHER } from "@/lib/legal";

export const metadata = {
  title: "Privacy",
  description:
    "What this site records, which is almost nothing: no account, no cookie, no advertising, no third-party script. Page counts are aggregated at the moment they are written.",
};

/* Written against what the code actually does, and checked against the running site rather than against an
 * intention. Every claim below was verified before it was published:
 *
 *   "no cookies"            -- no Set-Cookie on any route in production, no document.cookie in the source
 *   "no third-party script" -- nothing external is loaded; the fonts are self-hosted at build time
 *   "90 days"               -- `cli.py forget` runs nightly from the worker and nulls the text
 *
 * A privacy policy that describes a nicer site than the one deployed is the commonest kind there is, and it
 * is a false statement about personal data rather than a marketing flourish.
 */
export default function PrivacyPage() {
  return (
    <Prose
      title="Privacy"
      lede="This site has no accounts, sets no cookies, loads nothing from anyone else, and shows no advertising. What little it records is listed here in full."
    >
      <Section id="who" heading="Who publishes this">
        <p>
          As Amended is published by <strong className="font-medium text-[var(--ink)]">{PUBLISHER}</strong> as an
          individual. It is not published by, on behalf of, or in the name of any firm or employer, and nothing on
          it is issued in any professional capacity.
        </p>
        <p>
          For the purposes of the Digital Personal Data Protection Act, 2023, that individual is the data fiduciary
          for whatever is described below.
        </p>
      </Section>

      <Section id="collected" heading="What is recorded">
        <p>There are three things, and this is all of them.</p>
        <p>
          <strong className="font-medium text-[var(--ink)]">Page counts.</strong> When a page is opened, a counter
          is incremented. What is stored is the date, which kind of page it was, and &mdash; where the page is an
          Act or a set of Rules &mdash; which one. Nothing else: no address, no device, no browser, no referring
          site, no identifier of any kind, and never the query string. The counting is aggregated at the moment it
          is written, so a record of an individual visit never exists in the first place. That is also why these
          are views and never visitors: telling people apart needs something that distinguishes them, and there is
          nothing here that could.
        </p>
        <p>
          <strong className="font-medium text-[var(--ink)]">Search outcomes.</strong> Every search records how many
          results of each kind it returned, and when. The <em>wording</em> of a search is kept only when the search
          found nothing, because a list of what this library failed to answer is the only honest measure of what it
          is missing. A search that succeeded has already said what was needed, and its wording is discarded
          immediately. Wording that is kept is erased after 90 days by a job that runs nightly; the outcome and the
          counts remain, and they identify nobody.
        </p>
        <p>
          <strong className="font-medium text-[var(--ink)]">Your theme choice.</strong> Light or dark is stored in
          your own browser under the name <code className="num">as-amended-theme</code>. It never leaves your device
          and is never sent here. See{" "}
          <Link href="/cookies" className="text-[var(--link)] hover:underline">
            Cookies
          </Link>
          .
        </p>
      </Section>

      <Section id="not-collected" heading="What is not recorded">
        <p>
          No account, because there is nothing to sign in to. No cookie of any kind. No advertising, no advertising
          identifier, and no analytics belonging to anyone else &mdash; the counting described above is this
          site&rsquo;s own and the numbers stay here. No profiling, no automated decision-making, and no attempt to
          recognise a returning reader. Nothing is sold, rented or shared for anyone else&rsquo;s purposes, and
          there is no arrangement under which it could be.
        </p>
        <p>
          No part of this site loads a script, a stylesheet, a font or an image from a third party. The typefaces
          are served from this domain, compiled in when the site is built, specifically so that reading an Act here
          does not hand a record of it to anyone.
        </p>
      </Section>

      <Section id="logs" heading="Server logs">
        <p>
          Serving a page requires receiving a request, and a request carries the address it came from. The host
          processes that in order to deliver the page and to defend against abuse, and may hold it briefly in
          operational logs. This is ordinary and unavoidable for any website. What is avoidable is keeping it
          afterwards, joining it to anything, or using it to build a picture of a reader &mdash; none of which is
          done here. No such log is read, exported or retained by the publisher.
        </p>
      </Section>

      <Section id="processors" heading="Whose machines are involved">
        <p>Running a site means using someone&rsquo;s infrastructure. Three services are involved and no others.</p>
        <ul className="space-y-3">
          {PROCESSORS.map((p) => (
            <li key={p.name} className="panel panel-body">
              <p className="text-[var(--ink)]">
                <strong className="font-medium">{p.name}</strong>{" "}
                <span className="text-[var(--ink-3)]">&middot; {p.role}</span>
              </p>
              <p className="mt-1 text-[13.5px]">{p.what}</p>
              <p className="mt-1 text-[12.5px] text-[var(--ink-3)]">Located: {p.where}</p>
            </li>
          ))}
        </ul>
        <p>
          Two of those are outside India, so serving this site involves transferring request data abroad. Since
          none of what is stored identifies anyone, what crosses a border is statutory text and counts.
        </p>
      </Section>

      <Section id="retention" heading="How long things are kept">
        <p>
          Page counts are kept indefinitely. They are daily totals per kind of page and contain nothing about
          anyone, so there is no privacy reason to delete them and a real research reason to keep them &mdash;
          knowing which Acts get read is what decides what gets collected next.
        </p>
        <p>
          The wording of a search that found nothing is kept for 90 days and then erased automatically. The outcome
          of every search &mdash; the counts and the timestamp &mdash; is kept indefinitely, for the same reason.
        </p>
      </Section>

      <Section id="rights" heading="Your rights">
        <p>
          The Digital Personal Data Protection Act, 2023 gives you the right to ask what personal data about you is
          held, to have it corrected or erased, to nominate someone to act for you, and to complain.
        </p>
        <p>
          In practice the honest answer to the first of those is almost certainly &ldquo;none&rdquo;, and not as a
          matter of policy: there is no field anywhere in this site&rsquo;s database that holds a name, an address,
          an identifier or anything else that could be matched to you. A request to erase your data cannot be
          meaningfully answered, because nothing can be located as yours. The single exception is the text of a
          search that found nothing, if you typed something identifying into it within the last 90 days &mdash;
          say roughly what and when, and it will be erased.
        </p>
      </Section>

      <Section id="children" heading="Children">
        <p>
          This site is a research aid for tax and corporate law and is not directed at children. Nothing on it
          requires an age, and because no personal data is collected from anyone, none is collected from a child
          either.
        </p>
      </Section>

      <Section id="changes" heading="Changes">
        <p>
          If this changes, the date at the top changes with it and the previous wording is replaced. There is no
          mailing list to notify, because there is no list. Material changes will be noted on{" "}
          <Link href="/about" className="text-[var(--link)] hover:underline">
            the About page
          </Link>
          .
        </p>
      </Section>

      <Section id="contact" heading="Contact and grievances">
        <p>
          Questions about this notice, or a grievance about how data is handled, go to {PUBLISHER}
          {CONTACT_EMAIL ? (
            <>
              {" "}
              at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--link)] hover:underline">
                {CONTACT_EMAIL}
              </a>
              .
            </>
          ) : (
            /* Honest while the dedicated address is being set up. A placeholder address would look real and
               silently discard whatever was sent to it, which is worse than saying so plainly. */
            <>
              . A dedicated contact address for this site is being set up and will be published here. Until it is,
              there is no email address on this page to write to.
            </>
          )}
        </p>
        <p>
          If a grievance is not resolved, the Data Protection Board of India may be approached. These matters are
          governed by the laws of India, with jurisdiction in {JURISDICTION} &mdash; see{" "}
          <Link href="/terms" className="text-[var(--link)] hover:underline">
            Terms
          </Link>
          .
        </p>
      </Section>
    </Prose>
  );
}
