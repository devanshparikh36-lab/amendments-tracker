import Link from "next/link";
import { Prose, Section } from "@/components/Prose";
import { Faq, FaqItem } from "@/components/Faq";
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
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-IN");

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
          <div className="panel panel-body">
            <p className="text-[13.5px]">
              Currently holding <strong className="font-medium text-[var(--ink)]">{n(stats.instruments)}</strong>{" "}
              instruments, <strong className="font-medium text-[var(--ink)]">{n(stats.provisions)}</strong>{" "}
              provisions and <strong className="font-medium text-[var(--ink)]">{n(stats.documents)}</strong>{" "}
              notifications and circulars.{" "}
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
              No. No account, no cookie, no third-party script of any kind, no advertising. Page views are counted
              in aggregate at the moment they are written, so a record of an individual visit never exists &mdash;
              which is also why the site can report views and not visitors.
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
            <span className="num text-[var(--ink-3)]">11 October 2026</span> &mdash; first publication of the
            privacy notice, cookies page and terms. Page-view counting introduced, aggregated and without any
            identifier.
          </li>
        </ul>
      </Section>
    </Prose>
  );
}
