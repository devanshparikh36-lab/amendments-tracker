/* Status labels: whose text this is, whether a change could be applied, what a document does to a
 * provision, how a job ended.
 *
 * The styling used to live here as Tailwind palette classes -- bg-emerald-50, text-red-800,
 * ring-stone-200 and seventeen more. Every one was a fixed light colour, so when the dark theme arrived
 * the badges stayed pale chips with dark text on a dark page. They were also invisible to anyone auditing
 * the stylesheet for exactly that problem, because the colours were spelled in a component rather than in
 * CSS.
 *
 * So this file now maps meaning to a family name and nothing else. The six families are defined once in
 * globals.css, where both themes can see them.
 */

type Family = "ok" | "warn" | "bad" | "neutral" | "info" | "alt";

/* What each family means, which is the only thing worth arguing about here:
 *
 *   ok       this is the regulator's own text, or the step succeeded
 *   warn     a machine was involved, so read it with that in mind
 *   bad      it disagrees with the official text, or it failed
 *   info     something was added or explained
 *   alt      something was replaced or superseded -- a change of substance, not an addition
 *   neutral  states that carry no judgement: unchecked, omitted, renumbered, pending, skipped
 */
const FAMILY: Record<string, Family> = {
  official: "ok",
  matches_official: "ok",
  merged: "ok",

  machine_merged: "warn",

  differs_from_official: "bad",
  cannot_apply: "bad",
  failed: "bad",

  insert: "info",
  clarifies: "info",
  tagged: "info",

  substitute: "alt",
  amends: "alt",
  supersedes: "alt",

  unchecked: "neutral",
  omit: "neutral",
  renumber: "neutral",
  references: "neutral",
  pending: "neutral",
  skipped: "neutral",
};

const labels: Record<string, string> = {
  official: "Official text",
  machine_merged: "Machine-consolidated",
  differs_from_official: "Differs from official",
  matches_official: "Matches official",
  unchecked: "Unverified",
  cannot_apply: "Could not apply",
};

export function Badge({ kind, children }: { kind: string; children?: React.ReactNode }) {
  // An unknown kind reads as neutral rather than as nothing: a badge with no styling looks like a bug,
  // and a new job state should not be able to produce one.
  const family = FAMILY[kind] ?? "neutral";
  return (
    <span className={`badge badge-${family}`}>
      {children ?? labels[kind] ?? kind.replace(/_/g, " ")}
    </span>
  );
}
