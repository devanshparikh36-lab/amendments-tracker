import Link from "next/link";
import { Prose, Section } from "@/components/Prose";
import { CONTACT_EMAIL, JURISDICTION, PROCESSORS, PUBLISHER } from "@/lib/legal";

export const metadata = {
  title: "Privacy",
  description:
    "What this site records. Reading it needs no account and sets no cookie. If you enter an email address to keep follows, bookmarks and notes, this is exactly what is held, where, and how to get a copy or delete it.",
};

/* Written against what the code actually does, and checked against the running site rather than against an
 * intention. Every claim below was verified before it was published:
 *
 *   "no cookies"             -- no Set-Cookie on any route in production, including the account routes, and
 *                               document.cookie appears nowhere but in the comments of this page and /cookies
 *   "no third-party script"  -- nothing external is loaded; the fonts are self-hosted at build time
 *   "90 days"                -- `cli.py forget` runs nightly from the worker and nulls the text
 *   "nothing unverified"     -- the digest selects on alerts_ok_at IS NOT NULL. Tested by sending to a
 *                               recorder and reading the captured messages, not by reading the query
 *   "every copy can be stopped" -- a reader copy carries List-Unsubscribe built from that reader's own
 *                               token; the owner copy carries none. Same test
 *   "deleting is immediate"  -- the forget action is DELETE FROM reader, and every child table cascades
 *
 * Revised again on 15 October 2026, when the site began actually sending mail to readers. The version
 * before it said plainly that nothing was ever sent to a reader -- true when written, and false from the
 * day the digest learned to read the confirmed list. Google joined the processor list in the same change,
 * because a service that carries a message handles the address it is going to.
 *
 * This page was rewritten on 14 October 2026 because accounts shipped and the previous wording -- "no
 * account, no cookie, no third-party script of any kind" -- became false on the first of those three while
 * remaining true on the other two. A privacy policy that describes a nicer site than the one deployed is the
 * commonest kind there is, and it is a false statement about personal data rather than a marketing
 * flourish. The honest version is longer. That is the cost of having built something that holds data.
 *
 * The rule the account feature was designed to: nothing may be stored against a reader that they would mind
 * a stranger reading, because an unverified email address is not a password. That is a real limit on what
 * the feature may ever hold, and it belongs on the page rather than in a table comment where it started.
 */
export default function PrivacyPage() {
  return (
    <Prose
      title="Privacy"
      lede="Reading this site needs no account, sets no cookie, loads nothing from anyone else and shows no advertising. You can also enter an email address to keep follows, bookmarks and notes — and if you do, this page says exactly what is then held and how to delete it."
    >
      <Section id="who" heading="Who publishes this">
        <p>
          As Amended is published by <strong className="font-medium text-[var(--ink)]">{PUBLISHER}</strong> as an
          individual. It is not published by, on behalf of, or in the name of any firm or employer, and nothing on
          it is issued in any professional capacity.
        </p>
        <p>
          For the purposes of the Digital Personal Data Protection Act, 2023, that individual is the data fiduciary
          for everything described below.
        </p>
      </Section>

      <Section id="two-ways" heading="Two ways to use this site">
        <p>The distinction runs through the whole of this page, so it comes first.</p>
        <p>
          <strong className="font-medium text-[var(--ink)]">Reading it.</strong> Open any Act, search, follow a
          citation, download a PDF, take the CSV exports or the feed. This needs no account and involves no
          personal data about you at all. Nothing identifies you, nothing is stored against you, and there is
          nothing to delete afterwards because nothing was created.
        </p>
        <p>
          <strong className="font-medium text-[var(--ink)]">Keeping things.</strong> If you want the site to
          remember which sections you follow, which you have bookmarked, the notes you write against them and the
          searches you keep, you can enter an email address. That creates an account, and from that point the site
          holds personal data about you. It is entirely optional, it is never required to read anything, and it can
          be undone completely in one click.
        </p>
      </Section>

      <Section id="collected" heading="What is recorded when you only read">
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
          counts remain, and they identify nobody. None of this is linked to an account, even if you have one.
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

      <Section id="account" heading="What is held if you enter an email address">
        <p>
          This is the complete list. There is a button in the account panel that hands you all of it as a
          spreadsheet, so you never have to take this paragraph on trust.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="font-medium text-[var(--ink)]">The address itself</strong>, stored as you typed it,
            and a display name if you give one. The name is optional and can be anything; nothing checks it.
          </li>
          <li>
            <strong className="font-medium text-[var(--ink)]">
              When the account was created, and roughly when you were last here.
            </strong>{" "}
            The second is used for one purpose only &mdash; to show you what the collection picked up since your
            previous visit &mdash; and it moves at most once every thirty minutes, so it is a coarse marker and not
            a log of your reading.
          </li>
          <li>
            <strong className="font-medium text-[var(--ink)]">What you follow and what you bookmark</strong>, each
            as a pointer at a provision or an instrument, with the date you saved it.
          </li>
          <li>
            <strong className="font-medium text-[var(--ink)]">Notes you write against a provision</strong>, in your
            own words, up to 2,000 characters each. These are the one thing here that is genuinely yours rather
            than a pointer at public law. Please read the next section before you write anything in one.
          </li>
          <li>
            <strong className="font-medium text-[var(--ink)]">Searches you deliberately keep</strong>, up to fifty;
            saving the fifty-first drops the oldest. Only searches you press the button on. Searching normally
            still records nothing about you, exactly as described above.
          </li>
          <li>
            <strong className="font-medium text-[var(--ink)]">
              Whether you have asked for the digest, and whether the address has been verified.
            </strong>{" "}
            At most one message a day; there is no other cadence to choose. Two tokens sit alongside: the
            single-use one from the verification link, which expires in 48 hours and is erased the moment it is
            used, and one that identifies your unsubscribe link for as long as you keep receiving mail.
          </li>
        </ul>
        <p>
          <strong className="font-medium text-[var(--ink)]">Two messages are sent, and only if you ask.</strong>{" "}
          Ticking the alerts box sends nothing at all. A <em>Verify this email</em> button then appears, and
          pressing it sends one note with a link in it. Opening that link is what starts the daily digest. Until
          then the address is unverified and nothing is sent to it &mdash; which is the entire reason that step
          exists, since a tick is made by whoever is holding the browser and is not evidence the address is theirs.
        </p>
        <p>
          The digest is one message on days a regulator published something, and nothing at all on quiet days.
          Every copy carries a one-click unsubscribe, both as a link you can see and as the header that makes your
          mail client offer a button of its own. Unsubscribing stops the mail and touches nothing else: your
          follows, bookmarks and notes stay exactly as they are, and switching it back on later needs no second
          verification, because the address was already proved once.
        </p>
      </Section>

      <Section id="not-a-password" heading="An email address is not a password">
        <p>
          The account has no password, no sign-in link and no verification step. Entering an address is how you
          tell the site which lists are yours; it is not a claim that the address belongs to you, and nothing
          checks that it does.
        </p>
        <p>
          The consequence is worth stating plainly rather than burying:{" "}
          <strong className="font-medium text-[var(--ink)]">
            anyone who knows or guesses your address can see and change those lists, including reading your notes.
          </strong>{" "}
          This was a deliberate trade. It buys an account with nothing to forget, no password to leak and no
          session to hijack, and it is an acceptable trade only for as long as what sits behind it is a set of
          pointers at public law.
        </p>
        <p>
          So here is the rule the feature is built to, and the limit on what it may ever hold: do not put anything
          in a note that you would mind a stranger reading. Not a client&rsquo;s name, not a figure from a live
          matter, nothing privileged or confidential. Use it for what it is for &mdash; a reminder to yourself
          about a provision. If this site ever needs to hold more than that it will need real sign-in first, and
          that would be announced here before it happened rather than after.
        </p>
      </Section>

      <Section id="legal-basis" heading="Why this is held">
        <p>
          Under the Digital Personal Data Protection Act, 2023 the basis is your consent, given by typing an
          address into a form whose only purpose is this, and the purpose is limited to what that form offers: to
          show you your own follows, bookmarks, notes and saved searches when you come back, and to send the alerts
          if you ever switch them on.
        </p>
        <p>
          It is not used for anything else. It is not profiled, not scored, not used to decide anything about you,
          not combined with the page counts or the search outcomes &mdash; which could not be linked to it anyway,
          since they hold nothing that identifies anyone &mdash; and not disclosed to anybody. Withdrawing consent
          is the delete button described below, and it takes effect at once.
        </p>
      </Section>

      <Section id="not-collected" heading="What is not recorded, with or without an account">
        <p>
          No cookie of any kind, which is still true and is not a technicality: the account is remembered in your
          browser&rsquo;s own local storage rather than in a cookie, specifically so that nothing about you is
          attached to every request you make. No response from this site carries a{" "}
          <code className="num">Set-Cookie</code> header, the account routes included. See{" "}
          <Link href="/cookies" className="text-[var(--link)] hover:underline">
            Cookies
          </Link>{" "}
          for what is stored on your device instead.
        </p>
        <p>
          No advertising, no advertising identifier, and no analytics belonging to anyone else &mdash; the counting
          described above is this site&rsquo;s own and the numbers stay here. No profiling and no automated
          decision-making. No password, so none to lose. Nothing is sold, rented or shared for anyone else&rsquo;s
          purposes, and there is no arrangement under which it could be.
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
        <p>
          One deliberate detail: the request that hands you your own data carries your address in the body rather
          than in the address bar, so that it never appears in a server log, in a{" "}
          <code className="num">Referer</code> header or in your browser history.
        </p>
      </Section>

      <Section id="processors" heading="Whose machines are involved">
        <p>Running a site means using someone&rsquo;s infrastructure. Four services are involved and no others.</p>
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
          Every one of those is outside India, so using this site involves transferring data abroad. If you only
          read, what crosses a border is statutory text and counts that identify nobody. If you have an account,
          it is held in Singapore &mdash; so your address, your notes and your saved searches are stored outside
          India &mdash; and if you have asked for the digest, your address also passes through Google in order to
          be mailed. That follows from running on free infrastructure, and it is a real consequence, so it is said
          here rather than left to be inferred from a list of service names.
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
        <p>
          An account is kept until you delete it. There is no automatic expiry, which is worth being honest about
          in both directions: it means a list of followed sections is still there when you come back after a year,
          and it means an account you have forgotten about does not quietly clean itself up. The delete button is
          always one click away in the account panel.
        </p>
      </Section>

      <Section id="rights" heading="Your rights">
        <p>
          The Digital Personal Data Protection Act, 2023 gives you the right to ask what personal data about you is
          held, to have it corrected or erased, to nominate someone to act for you, and to complain. Two of those
          are built into the site and need no request and no reply from anyone.
        </p>
        <p>
          <strong className="font-medium text-[var(--ink)]">A copy of everything.</strong> The account panel has an
          export button. It hands you a spreadsheet containing the whole account row, every follow, every bookmark,
          the full text of every note and every saved search &mdash; not a summary. It is deliberately everything,
          because a partial export would satisfy the feature and not the right.
        </p>
        <p>
          <strong className="font-medium text-[var(--ink)]">Erasure.</strong> The same panel has a delete button. It
          removes the account row, and every follow, bookmark, note and saved search goes with it in the same
          operation, immediately and permanently. Nothing is archived, nothing is kept in a copy of its own, and
          nothing is retained for a notice period. Afterwards the site knows nothing about you and you are back to
          being a reader.
        </p>
        <p>
          <strong className="font-medium text-[var(--ink)]">Correction.</strong> The display name can be changed in
          the same panel. To change the address itself, delete the account and enter the new one.
        </p>
        <p>
          If you have never entered an email address, the honest answer to the first right is &ldquo;none&rdquo;,
          and not as a matter of policy: there is no field anywhere in this site&rsquo;s database that would hold
          anything about you. The one exception is the text of a search that found nothing, if you typed something
          identifying into it within the last 90 days &mdash; say roughly what and when, and it will be erased.
        </p>
        <p>
          For anything the buttons do not cover, including nominating someone to act on your behalf, write to the
          address below.
        </p>
      </Section>

      <Section id="children" heading="Children">
        <p>
          This site is a research aid for tax and corporate law and is not directed at children. Nothing on it
          requires an age, and reading it collects no personal data from anyone, so none is collected from a child
          either. The Act requires verifiable parental consent before a child&rsquo;s personal data is processed,
          and this site has no way to establish an age: accounts are therefore not offered to anyone under
          eighteen. Please do not enter an email address if you are under eighteen, and if an account turns out to
          belong to a child it will be deleted on being told.
        </p>
      </Section>

      <Section id="breach" heading="If something goes wrong">
        <p>
          If personal data held here is exposed, the Act requires the Data Protection Board and the affected people
          to be told. The second half of that is worth a sentence, because this site has no mailing list and would
          have to use the only addresses it holds &mdash; the accounts themselves. They would be used for that, and
          a notice would also go on{" "}
          <Link href="/about" className="text-[var(--link)] hover:underline">
            the About page
          </Link>
          , which needs no address to read.
        </p>
      </Section>

      <Section id="changes" heading="Changes">
        <p>
          If this changes, the date at the top changes with it and the previous wording is replaced. Material
          changes are listed on{" "}
          <Link href="/about" className="text-[var(--link)] hover:underline">
            the About page
          </Link>
          , which is where to look to see what changed and when.
        </p>
      </Section>

      <Section id="contact" heading="Contact and grievances">
        <p>
          Questions about this notice, a request the buttons do not cover, or a grievance about how data is
          handled, go to {PUBLISHER}
          {CONTACT_EMAIL ? (
            <>
              {" "}
              at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--link)] hover:underline">
                {CONTACT_EMAIL}
              </a>
              . A reply should be expected within thirty days.
            </>
          ) : (
            /* Only reachable if the address is taken back out. The page must not invent one: a placeholder
               reads as real and silently discards whatever is sent to it. */
            <>. A contact address for this site is being set up and will be published here.</>
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
