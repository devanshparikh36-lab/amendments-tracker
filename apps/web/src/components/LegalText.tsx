import { linkifyLegalHtml, linkifyLegalText, type RefContext } from "@/lib/crossref";
import { hasLegalHtml, prepareLegalHtml } from "@/lib/legal-html";
import type { ProvisionRow } from "@/lib/queries";

// The provision itself. Where the regulator published formatted HTML — the Income Tax department
// publishes every section that way — that markup is what is shown, tables, indented clauses, provisos
// and footnote marks included. Where there is only plain text, the source's own line breaks are kept.
//
// `refs` turns the citations inside the text into links. It is optional: without it the text renders
// exactly as it did before, which is what the history and comparison views want — there the point is the
// wording as it stood, and a link into today's text would quietly contradict that.
export function ProvisionBody({
  p,
  dropHeading = true,
  refs,
}: {
  p: ProvisionRow;
  dropHeading?: boolean;
  refs?: RefContext;
}) {
  if (hasLegalHtml(p.html)) {
    const html = prepareLegalHtml(p.html, { dropHeading });
    return (
      <div className="legal" dangerouslySetInnerHTML={{ __html: refs ? linkifyLegalHtml(html, refs) : html }} />
    );
  }
  if (p.text) {
    // Escaped inside the linker, so the raw text is never injected as markup.
    return refs ? (
      <div className="legal-pre" dangerouslySetInnerHTML={{ __html: linkifyLegalText(p.text, refs) }} />
    ) : (
      <div className="legal-pre">{p.text}</div>
    );
  }
  return <p className="text-[var(--ink-3)]">No text recorded for this date.</p>;
}

// A one-line statement of whose words these are. Shown wherever text is shown, so a reader never has
// to guess whether they are looking at the regulator's rendering or ours.
export function Provenance({ p, regulator }: { p: ProvisionRow; regulator: string }) {
  const machine = p.source_kind === "machine_merged";
  const html = hasLegalHtml(p.html);
  return (
    <p className={`provenance ${machine ? "provenance-machine" : ""}`}>
      {machine ? (
        <>
          <strong>Machine-consolidated.</strong> Our merge engine applied the amending documents below to the last
          official text; no person has checked it. Read the official document before relying on it.
        </>
      ) : html ? (
        <>
          <strong>{regulator}&rsquo;s own text</strong>, shown in {regulator}&rsquo;s own formatting — its tables, its
          clause indentation, its provisos and its footnote marks, as published.
        </>
      ) : (
        <>
          <strong>{regulator}&rsquo;s own text</strong>, reproduced verbatim from the official publication.
        </>
      )}
    </p>
  );
}
