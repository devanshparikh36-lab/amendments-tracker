import Link from "next/link";
import { fmtDate } from "@/lib/format";

/* The dated texts held for one provision, as something you can click.
 *
 * The date picker beside this has always worked. What it could not do is tell you which dates mean
 * anything: type 2019 and the answer was "No text recorded for this date", which is true and reads exactly
 * like a fault. The missing piece was never the lookup, it was saying what the archive contains.
 *
 * And what it contains has to be stated plainly, because it is not what a reader will assume. These texts
 * begin when the tracker first read the instrument, not when the provision was enacted: 4,049 of the 6,014
 * versions held are dated 2026 for that reason. So this cannot answer "what did section 80C say in
 * 2019-20", and saying so here is better than letting someone discover it mid-assessment. It deepens
 * forward from now and cannot be backfilled -- in three years it answers the question it cannot answer
 * today.
 *
 * Rendered only when there is something to choose or something to warn about. One version with no date
 * asked for is the ordinary case and needs no furniture.
 */

export type HeldVersion = { effective_from: string | null; effective_to: string | null; chars: number };

export function VersionsHeld({
  versions,
  asOn,
  href,
  unit,
  foundText,
}: {
  versions: HeldVersion[];
  /** The date asked for, if any. */
  asOn?: string;
  /** Builds the link for one date; null clears the date. */
  href: (asOn: string | null) => string;
  unit: string;
  /** Whether a text was actually found for `asOn` -- decides between a chooser and an explanation. */
  foundText: boolean;
}) {
  const dated = versions.filter((v) => v.effective_from);
  const earliest = dated[0]?.effective_from ?? null;

  // Asked for a date and got nothing. The useful reply names the boundary rather than the absence.
  if (asOn && !foundText) {
    return (
      <div className="panel-body border-b border-[var(--rule)] bg-[var(--amend-bg)] text-[13px]">
        <p>
          No text is held for this {unit} as at <span className="num">{fmtDate(asOn)}</span>.
          {earliest ? (
            <>
              {" "}
              The earliest held is <span className="num">{fmtDate(earliest)}</span>
              {dated.length > 1 ? `, and ${dated.length} dated texts are held in all.` : "."}
            </>
          ) : (
            " No dated text is held for it at all."
          )}
        </p>
        <p className="mt-1 text-[12px] text-[var(--ink-3)]">
          These texts begin when this instrument was first read, not when it was enacted, so dates before
          that cannot be answered. <Link href={href(null)} className="text-[var(--link)] hover:underline">Read the current text</Link>.
        </p>
      </div>
    );
  }

  // Nothing to choose between, and nothing to correct: stay out of the way.
  if (dated.length < 2 && !asOn) return null;

  return (
    <div className="no-print border-b border-[var(--rule)] px-5 py-2 text-[12.5px]">
      <span className="eyebrow mr-2">Text held as on</span>
      <span className="inline-flex flex-wrap items-center gap-1">
        {dated.map((v) => {
          const on = asOn ? v.effective_from === asOn : v.effective_to === null;
          return (
            <Link
              key={v.effective_from}
              href={href(v.effective_from)}
              aria-current={on ? "true" : undefined}
              className={`chip num ${on ? "chip-on" : ""}`}
              title={v.effective_to ? `In force until ${fmtDate(v.effective_to)}` : "Current text"}
            >
              {fmtDate(v.effective_from)}
              {v.effective_to === null ? " · current" : ""}
            </Link>
          );
        })}
        {asOn && (
          <Link href={href(null)} className="ml-1 text-[var(--ink-3)] hover:text-[var(--link)] hover:underline">
            today
          </Link>
        )}
      </span>
      {dated.length === 1 && (
        <span className="ml-2 text-[var(--ink-4)]">
          one text held &mdash; this {unit} has not changed since it was first read
        </span>
      )}
    </div>
  );
}
