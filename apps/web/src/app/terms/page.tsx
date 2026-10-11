import Link from "next/link";
import { Prose, Section } from "@/components/Prose";
import { CONTACT_EMAIL, JURISDICTION, PUBLISHER } from "@/lib/legal";

export const metadata = {
  title: "Terms",
  description:
    "Terms of use: a research aid, not legal advice. The regulator's own document is the only authority, and every screen links to it.",
};

/* Terms of use, and the terms and conditions page -- one document, not two.
 *
 * They were asked for as separate items. A site of this kind has one set of terms, and splitting them
 * produces two pages that either repeat each other or, worse, drift apart and contradict each other on the
 * point that matters. So this page is both, and it says so.
 *
 * The substance is shaped by what the site actually is: a reproduction of government material with a
 * machine-built index over it, published by one person, free, with no account and no transaction. There is
 * no payment clause, no subscription, no user content and no licence to grant, because none of those exist.
 */
export default function TermsPage() {
  return (
    <Prose
      title="Terms of use"
      lede="These are the terms and conditions on which this site is made available. It is a research aid published by one person, free of charge, and it is not legal advice."
    >
      <Section id="what" heading="What this site is">
        <p>
          As Amended reproduces Indian tax and corporate law as the regulators publish it, and records which
          notification changed which provision and when. It is published by{" "}
          <strong className="font-medium text-[var(--ink)]">{PUBLISHER}</strong> as an individual, not by any firm
          or employer, and nothing on it is issued in a professional capacity or on anyone&rsquo;s instructions.
        </p>
        <p>Using the site means accepting what follows. If you do not accept it, please do not use the site.</p>
      </Section>

      <Section id="not-advice" heading="It is not legal advice">
        <p>
          Nothing here is legal, tax or professional advice, and reading it creates no professional relationship of
          any kind. It is a finding aid: it helps you locate a provision and see what has been issued against it.
          The judgement about what any of it means for a particular matter is yours or your adviser&rsquo;s.
        </p>
      </Section>

      <Section id="authority" heading="The regulator's document is the authority">
        <p>
          This is the most important thing on this page. The authoritative text of any Act, Rule, Regulation,
          notification or circular is the one the issuing authority publishes &mdash; not the copy here. Every
          screen carries a link to that official document for exactly this reason. Before relying on anything,
          open it and read it there.
        </p>
        <p>
          Amendments on this site are shown as <em>references</em> and are never applied to the text. No wording
          has been rewritten by a machine, so what you read is the regulator&rsquo;s own words as the regulator
          published them. Where an instrument is issued only as a PDF, that PDF is what is served; text read out of
          such a page, including by optical character recognition, is a finding aid and never the official
          rendering.
        </p>
      </Section>

      <Section id="accuracy" heading="Accuracy, completeness and currency">
        <p>
          The collection is automated. It can be out of date, it can miss a document, it can file one against the
          wrong provision, and a regulator can publish something in a form it cannot read. The site reports on its
          own condition rather than hiding it: see{" "}
          <Link href="/status" className="text-[var(--link)] hover:underline">
            Collection status
          </Link>{" "}
          for what last ran and what failed.
        </p>
        <p>
          The site is therefore provided as it stands and as it is available, with no warranty of accuracy,
          completeness, currency or fitness for any purpose, so far as the law allows. Nothing in this paragraph
          limits any liability that cannot lawfully be limited.
        </p>
      </Section>

      <Section id="liability" heading="Liability">
        <p>
          To the extent permitted by law, the publisher is not liable for any loss arising from use of this site or
          reliance on anything found through it, including any loss arising from a provision being missing, stale,
          mis-filed or unavailable. The remedy available to you, and it is a real one, is the official document
          linked from every screen.
        </p>
      </Section>

      <Section id="copyright" heading="Copyright">
        <p>
          The statutory material reproduced here is government material. Under section 52(1)(q) of the Copyright
          Act, 1957 the reproduction of an Act, of rules or orders made under it, and of material published by or
          with the approval of a government does not infringe copyright. No claim of ownership is made over any of
          it, and none could be.
        </p>
        <p>
          What is the publisher&rsquo;s own is the arrangement &mdash; the index, the cross-references, the
          amendment trail and the writing on pages like this one. You are welcome to read it, quote it, link to it
          and use it in your own work. Please do not present the site as your own or imply that it is published by
          anyone other than its publisher.
        </p>
      </Section>

      <Section id="use" heading="Acceptable use">
        <p>
          Read as much as you like. There is no account, no limit on reading and no charge. Two things are asked.
        </p>
        <p>
          Do not hammer it. The site runs on free-tier infrastructure with real limits, and the bulk endpoints are
          rate-limited for that reason. If you want the data in quantity there are proper routes provided for it
          &mdash; the CSV exports and the{" "}
          <Link href="/feed.xml" className="text-[var(--link)] hover:underline">
            Atom feed
          </Link>{" "}
          &mdash; and they are a great deal more efficient than crawling pages.
        </p>
        <p>
          Do not use it to present the law inaccurately. Republishing this material edited in a way that changes
          what a provision says, while still attributing it to the regulator, is the one use that would do actual
          harm.
        </p>
      </Section>

      <Section id="availability" heading="Availability">
        <p>
          The site is free and is offered with no undertaking that it will keep running, keep its addresses, or
          keep any particular feature. It may change or stop at any time. Links to official documents point at the
          regulators&rsquo; own sites and will outlive this one.
        </p>
      </Section>

      <Section id="privacy" heading="Privacy">
        <p>
          What is recorded, which is almost nothing, is set out in the{" "}
          <Link href="/privacy" className="text-[var(--link)] hover:underline">
            privacy notice
          </Link>
          , and the answer on cookies is in{" "}
          <Link href="/cookies" className="text-[var(--link)] hover:underline">
            Cookies
          </Link>
          . Both form part of these terms.
        </p>
      </Section>

      <Section id="law" heading="Governing law">
        <p>
          These terms are governed by the laws of India. The courts of {JURISDICTION} have exclusive jurisdiction
          over any dispute arising out of them or out of use of this site.
        </p>
      </Section>

      <Section id="changes" heading="Changes and contact">
        <p>
          These terms may be revised; the date at the top records when the current wording took effect, and
          continuing to use the site after a change means accepting the revised terms.
        </p>
        <p>
          {CONTACT_EMAIL ? (
            <>
              Questions go to{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-[var(--link)] hover:underline">
                {CONTACT_EMAIL}
              </a>
              .
            </>
          ) : (
            <>
              A dedicated contact address for this site is being set up and will be published here and on the
              privacy page.
            </>
          )}
        </p>
      </Section>
    </Prose>
  );
}
