import Link from "next/link";
import { Prose, Section } from "@/components/Prose";
import { Faq, FaqItem } from "@/components/Faq";
import { CountUp } from "@/components/CountUp";
import { PUBLISHER } from "@/lib/legal";
import { homeStats } from "@/lib/queries";

export const metadata = {
  title: "About",
  description:
    "What this site is, where its text comes from, why amendments are shown as references and never applied, and how current any of it is.",
};

export const revalidate = 3600;

export default async function AboutPage() {
  // Live, because the alternative is writing "195 instruments" into prose and having it quietly rot. If the
  // database is briefly unreachable the page still renders; the counts are the only part that needs it.
  let stats: Awaited<ReturnType<typeof homeStats>> | null = null;
  try {
    stats = await homeStats();
  } catch {
    /* the page is worth serving without its numbers */
  }

  return (
    <Prose
      title="About this site"
      dated={false}
      lede="As Amended holds Indian tax and corporate law in the regulator's own words, and records which notification changed which provision, and when."
    >
      <Section id="what" heading="What it does">
        <p>
          It collects Acts, Rules, Regulations and Master Directions from the authorities that issue them, keeps
          the text as published, and files every notification and circular against the provisions it affects. Then
          it links back: every screen carries the regulator&rsquo;s own document, so nothing here has to be taken
          on trust.
        </p>
        {stats && (
          <div className="panel panel-body reveal lift" suppressHydrationWarning>
            {/* The server renders the finished figures; CountUp only animates them once they scroll into
                view, and only where it can. Without script, with reduced motion, or to a crawler these read
                as the plain correct numbers -- which on a page whose point is the size of the library is the
                only acceptable default. */}
            <p className="text-[13.5px]">
              Currently holding{" "}
              <CountUp value={stats.instruments} className="num font-medium text-[var(--ink)]" /> instruments,{" "}
              <CountUp value={stats.provisions} className="num font-medium text-[var(--ink)]" /> provisions and{" "}
              <CountUp value={stats.documents} className="num font-medium text-[var(--ink)]" /> notifications and
              circulars.{" "}
              <Link href="/status" className="text-[var(--link)] hover:underline">
                Collection status
              </Link>
            </p>
          </div>
        )}
        <p>
          It runs by itself. Collection happens once a day without anyone reviewing what it brought back, which is
          a deliberate choice and the reason the next section exists.
        </p>
      </Section>

      <Section id="questions" heading="Questions">
        <Faq>
          <FaqItem q="Why are amendments not applied to the text?">
            <p>
              Because applying them would mean a machine rewriting statutory wording, and then you would be
              reading the machine rather than the regulator. An amendment here is a <em>reference</em>: it tells
              you which notification changed this provision and when, and links you to it. The provision itself
              stays exactly as the regulator published it.
            </p>
            <p>
              This is why the count of applied amendments is zero and will stay zero. It is the design, not a
              feature that has not been built yet. Follow the amendment link to read the change in the issuing
              authority&rsquo;s own words.
            </p>
          </FaqItem>

          <FaqItem q="How current is the text?">
            <p>
              Collection runs daily at 07:00 IST. But the more useful answer is that the text is as current as the
              regulator&rsquo;s own consolidation &mdash; if the income-tax department states a section as on a
              particular date, that date is shown on the provision, and that is what you are reading.
            </p>
            <p>
              The &ldquo;Last checked&rdquo; stamp in the corner of every page says when the collector last looked
              at the regulators&rsquo; sites. Those are different questions and both are shown, because
              &ldquo;as amended&rdquo; means nothing without a date attached.
            </p>
          </FaqItem>

          <FaqItem q="Can I rely on this for a filing or an opinion?">
            <p>
              No &mdash; rely on the official document, which is linked from every screen. This site is built to
              get you to that document quickly and to tell you what has been issued against it. Treat it the way
              you would treat a good index: trustworthy enough to work from, never the thing you cite.
            </p>
            <p>
              The <Link href="/terms" className="text-[var(--link)] hover:underline">terms</Link> say this more
              formally, and mean it.
            </p>
          </FaqItem>

          <FaqItem q="Where does the text actually come from?">
            <p>
              From the issuing authority, directly: the income-tax department, the Reserve Bank, SEBI, the Ministry
              of Corporate Affairs, the CBIC and India Code. Nothing is copied from a commercial publisher or from
              another website.
            </p>
            <p>
              Each provision states whose rendering it is. Where the regulator publishes formatted text, that
              formatting is what you see &mdash; tables, provisos, indented clauses and footnote marks included.
              Where an instrument exists only as a PDF, the PDF is served and any text read out of it is marked as
              a finding aid rather than as the official rendering.
            </p>
          </FaqItem>

          <FaqItem q="Something looks wrong — a section is empty, or holds the wrong text.">
            <p>
              That happens, and the site keeps a public list of it rather than pretending otherwise. Provisions
              whose stored text does not look like a provision &mdash; a heading captured without its body, a row
              of a table, an amendment footnote &mdash; are flagged and listed on{" "}
              <Link href="/quality" className="text-[var(--link)] hover:underline">
                Text that needs a look
              </Link>
              .
            </p>
            <p>
              The official document link on the provision is unaffected by any of this, and is the way through
              when the parsed text has let you down.
            </p>
          </FaqItem>

          <FaqItem q="Is there a feed, or a way to get the data in bulk?">
            <p>
              Yes to both, and both are preferable to crawling.{" "}
              <Link href="/feed.xml" className="text-[var(--link)] hover:underline">
                An Atom feed
              </Link>{" "}
              carries every notification and circular as it arrives, and it can be narrowed to one regulator or
              one instrument with <code className="num">?regulator=</code> or{" "}
              <code className="num">?instrument=</code>. Outlook and Teams both read Atom, so it needs nothing
              installed.
            </p>
            <p>There are also CSV exports of the documents and of the section map. Both are rate-limited.</p>
          </FaqItem>

          <FaqItem q="Does it track me?">
            <p>
              No. Reading this site needs no account, sets no cookie, loads no third-party script of any kind and
              shows no advertising. Page views are counted in aggregate at the moment they are written, so a record
              of an individual visit never exists &mdash; which is also why the site can report views and not
              visitors.
            </p>
            <p>
              There is one deliberate exception, and it only happens if you ask for it. You can enter an email
              address to have the site remember the sections you follow, the ones you bookmark, the notes you write
              and the searches you keep. That holds personal data about you, which is why it is optional, never
              required to read anything, and deletable in one click &mdash; the delete button erases the account
              and everything in it at once, and the export button hands you the whole lot as a spreadsheet first.
            </p>
            <p>
              Even then there is still no cookie: the account is kept in your browser&rsquo;s own local storage and
              is never attached to an ordinary page request. And nothing is sent to an address until somebody
              opens a link sent to that address &mdash; ticking the box is not enough, deliberately, because a
              tick is made by whoever is holding the browser.
            </p>
            <p>
              The full account is in the{" "}
              <Link href="/privacy" className="text-[var(--link)] hover:underline">
                privacy notice
              </Link>
              , and the short answer on cookies is on the{" "}
              <Link href="/cookies" className="text-[var(--link)] hover:underline">
                cookies page
              </Link>
              .
            </p>
          </FaqItem>

          <FaqItem q="Who publishes it, and what does it cost?">
            <p>
              {PUBLISHER}, as an individual &mdash; not a firm, and not in any professional capacity. It is free,
              there is nothing to buy, and there is no intention to charge for it.
            </p>
            <p>
              It runs entirely on free infrastructure, which is a design constraint rather than an accident: it is
              what keeps the site able to exist without needing to make money from the people reading it.
            </p>
          </FaqItem>
        </Faq>
      </Section>

      <Section id="changes" heading="Recent changes">
        <p>
          Material changes to the{" "}
          <Link href="/privacy" className="text-[var(--link)] hover:underline">
            privacy notice
          </Link>{" "}
          or the{" "}
          <Link href="/terms" className="text-[var(--link)] hover:underline">
            terms
          </Link>{" "}
          are noted here.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <span className="num text-[var(--ink-3)]">15 October 2026</span> &mdash; the daily digest can now be
            emailed to readers who ask for it. Nothing is sent to an address until somebody opens a link sent to
            that address, and every message carries a one-click unsubscribe. Google is now listed as a processor
            on the{" "}
            <Link href="/privacy" className="text-[var(--link)] hover:underline">
              privacy notice
            </Link>
            , because the service carrying a message necessarily handles the address it is going to. The weekly
            option was removed before it had ever sent anything; the digest is daily or nothing.
          </li>
          <li>
            <span className="num text-[var(--ink-3)]">14 October 2026</span> &mdash; optional accounts added. Enter
            an email address and the site remembers your follows, bookmarks, notes and saved searches; it is never
            required to read anything. The{" "}
            <Link href="/privacy" className="text-[var(--link)] hover:underline">
              privacy notice
            </Link>{" "}
            was rewritten to say exactly what is held, where it is held, and how to export or erase it, and the{" "}
            <Link href="/terms" className="text-[var(--link)] hover:underline">
              terms
            </Link>{" "}
            gained an Accounts section. The earlier wording &mdash; &ldquo;no account, no cookie, no third-party
            script of any kind&rdquo; &mdash; was true of the site that published it and became false on the first
            of those three the day accounts shipped; it has been corrected rather than quietly dropped. Still no
            cookies: the account lives in your browser&rsquo;s local storage. A contact address for privacy
            questions and grievances is now published, which the previous wording admitted it lacked.
          </li>
          <li>
            <span className="num text-[var(--ink-3)]">11 October 2026</span> &mdash; first publication of the
            privacy notice, cookies page and terms. Page-view counting introduced, aggregated and without any
            identifier.
          </li>
        </ul>
      </Section>
    </Prose>
  );
}
