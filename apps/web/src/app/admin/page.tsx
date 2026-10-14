import { timingSafeEqual } from "node:crypto";
import { getPool } from "@/db";
import { fmtDateTime } from "@/lib/format";

/* Who has signed up, and what they follow.
 *
 * Guarded by one secret in an environment variable, compared in constant time. That is the whole of the
 * access control and it is proportionate to what is behind it: a list of email addresses and the sections
 * they follow. It is not proportionate to anything more, so nothing more should be put on this page.
 *
 * The repository is public, so the secret cannot live in it. ADMIN_KEY is set in Netlify's environment
 * (Project configuration > Environment variables). With it unset the page refuses everyone, including the
 * owner -- which is the right way round for a page that is otherwise world-readable.
 *
 * Deliberately not here: what each reader read. That would mean a row per page view per person, and it is
 * the one thing that would turn this site's record from "who signed up" into a reading history. It is also
 * the thing the privacy notice would have to be rewritten hardest to permit. If it is ever wanted it
 * should be a separate decision with its own retention rule, not an extra column added quietly.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false, follow: false } };

function authorised(given: string | undefined): boolean {
  const want = process.env.ADMIN_KEY;
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  // Length is compared first and separately: timingSafeEqual throws on a mismatch rather than returning
  // false, and the length of a secret is not the part worth hiding.
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;

  if (!authorised(key)) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <div className="panel panel-body">
          <p className="eyebrow">Admin</p>
          <h1 className="serif mt-1 text-[20px] font-semibold text-[var(--ink)]">Not available</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--ink-2)]">
            This page needs a key. If you are the owner, append <code className="num">?key=</code> and the
            value of <code className="num">ADMIN_KEY</code>.
          </p>
        </div>
      </div>
    );
  }

  const pool = getPool();
  const [readers, totals] = await Promise.all([
    pool.query(
      `SELECT r.id, r.email, r.name, r.created_at, r.last_seen_at, r.alerts_on,
              (r.alerts_ok_at IS NOT NULL) AS confirmed,
              count(w.*) FILTER (WHERE w.provision_id IS NOT NULL)  AS sections,
              count(w.*) FILTER (WHERE w.instrument_id IS NOT NULL) AS acts
         FROM reader r
         LEFT JOIN reader_watch w ON w.reader_id = r.id
        GROUP BY r.id
        ORDER BY r.last_seen_at DESC
        LIMIT 500`,
    ),
    pool.query(
      `SELECT count(*) AS readers,
              count(*) FILTER (WHERE alerts_on) AS alerts,
              count(*) FILTER (WHERE last_seen_at > now() - interval '7 days') AS active
         FROM reader`,
    ),
  ]);

  const t = totals.rows[0] ?? {};

  return (
    <div className="mx-auto max-w-5xl py-2">
      <p className="eyebrow">Admin</p>
      <h1 className="serif mt-1 text-[25px] font-semibold text-[var(--ink)]">Readers</h1>

      <div className="mt-4 flex flex-wrap gap-6 border-y border-[var(--rule)] py-3 text-[13px]">
        <span>
          <span className="num text-[18px] font-semibold text-[var(--ink)]">{String(t.readers ?? 0)}</span>{" "}
          <span className="text-[var(--ink-3)]">signed up</span>
        </span>
        <span>
          <span className="num text-[18px] font-semibold text-[var(--ink)]">{String(t.active ?? 0)}</span>{" "}
          <span className="text-[var(--ink-3)]">seen in 7 days</span>
        </span>
        <span>
          <span className="num text-[18px] font-semibold text-[var(--ink)]">{String(t.alerts ?? 0)}</span>{" "}
          <span className="text-[var(--ink-3)]">want alerts</span>
        </span>
      </div>

      {readers.rows.length === 0 ? (
        <p className="mt-6 text-[13.5px] text-[var(--ink-3)]">Nobody has signed in yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--rule-strong)] text-left">
                <th className="py-2 pr-3 font-semibold">Email</th>
                <th className="py-2 pr-3 font-semibold">Name</th>
                <th className="py-2 pr-3 text-right font-semibold">Sections</th>
                <th className="py-2 pr-3 text-right font-semibold">Acts</th>
                <th className="py-2 pr-3 font-semibold">Alerts</th>
                <th className="py-2 pr-3 font-semibold">Joined</th>
                <th className="py-2 font-semibold">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {readers.rows.map((r: Record<string, unknown>) => (
                <tr key={String(r.id)} className="border-b border-[var(--rule)]">
                  <td className="py-1.5 pr-3 break-all">{String(r.email)}</td>
                  <td className="py-1.5 pr-3">{(r.name as string) || <span className="text-[var(--ink-4)]">—</span>}</td>
                  <td className="num py-1.5 pr-3 text-right">{String(r.sections)}</td>
                  <td className="num py-1.5 pr-3 text-right">{String(r.acts)}</td>
                  <td className="py-1.5 pr-3 text-[12px]">
                    {r.alerts_on ? (r.confirmed ? "on" : "unconfirmed") : <span className="text-[var(--ink-4)]">off</span>}
                  </td>
                  <td className="num py-1.5 pr-3 text-[12px] text-[var(--ink-3)]">{fmtDateTime(r.created_at as string)}</td>
                  <td className="num py-1.5 text-[12px] text-[var(--ink-3)]">{fmtDateTime(r.last_seen_at as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
