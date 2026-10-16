import Link from "next/link";
import { AdminReaders } from "@/components/AdminReaders";
import { getPool } from "@/db";
import { fmtDateTime } from "@/lib/format";
import { authorised } from "@/lib/admin";

/* Who has signed up, and what they are keeping.
 *
 * Guarded by one secret in an environment variable, compared in constant time. That is the whole of the
 * access control and it is proportionate to what is behind it. The repository is public, so the secret
 * cannot live in it: ADMIN_KEY is set in Netlify (Project configuration > Environment variables). With it
 * unset the page refuses everyone, including the owner -- the right way round for a page that is
 * otherwise world-readable.
 *
 * What is deliberately absent, and should stay absent: the text of anyone's notes, and what each reader
 * read. Notes are the readers' own words and the owner has no reason to need them in aggregate -- the
 * count is enough to know the feature is used. A reading history would be a row per page view per person,
 * which is the one addition that would turn this from "who signed up" into surveillance, and it should be
 * its own decision with its own retention rule rather than a column added quietly.
 *
 * The popularity tables are the useful half: "which sections do practitioners actually care about" is a
 * question nothing else on this site can answer, and it is answered here without naming anybody.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin", robots: { index: false, follow: false } };

function Stat({ n, label }: { n: unknown; label: string }) {
  return (
    <span>
      <span className="num text-[18px] font-semibold text-[var(--ink)]">{String(n ?? 0)}</span>{" "}
      <span className="text-[var(--ink-3)]">{label}</span>
    </span>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
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
  const [totals, readers, popular, marked, queries] = await Promise.all([
    pool.query(
      `SELECT (SELECT count(*) FROM reader)                                              AS readers,
              (SELECT count(*) FROM reader WHERE last_seen_at > now() - interval '7 days') AS active,
              (SELECT count(*) FROM reader WHERE alerts_on)                              AS alerts,
              (SELECT count(*) FROM reader WHERE source = 'admin')                       AS added,
              (SELECT count(*) FROM reader WHERE alerts_ok_at IS NOT NULL)               AS confirmed,
              (SELECT count(*) FROM reader_watch WHERE kind = 'follow')                  AS follows,
              (SELECT count(*) FROM reader_watch WHERE kind = 'bookmark')                AS bookmarks,
              (SELECT count(*) FROM reader_note)                                         AS notes,
              (SELECT count(*) FROM reader_search)                                       AS searches`,
    ),
    pool.query(
      `SELECT r.id, r.email, r.name, r.created_at, r.last_seen_at, r.alerts_on, r.source,
              (r.alerts_ok_at IS NOT NULL) AS confirmed,
              count(w.*) FILTER (WHERE w.kind = 'follow')   AS follows,
              count(w.*) FILTER (WHERE w.kind = 'bookmark') AS bookmarks,
              (SELECT count(*) FROM reader_note n  WHERE n.reader_id = r.id) AS notes,
              (SELECT count(*) FROM reader_search s WHERE s.reader_id = r.id) AS searches
         FROM reader r
         LEFT JOIN reader_watch w ON w.reader_id = r.id
        GROUP BY r.id
        ORDER BY r.last_seen_at DESC
        LIMIT 500`,
    ),
    pool.query(
      `SELECT i.short_code, i.slug, p.number, count(*) AS n
         FROM reader_watch w
         JOIN provision p  ON p.id = w.provision_id
         JOIN instrument i ON i.id = p.instrument_id
        WHERE w.kind = 'follow'
        GROUP BY i.short_code, i.slug, p.number
        ORDER BY count(*) DESC, i.short_code
        LIMIT 15`,
    ),
    pool.query(
      `SELECT i.short_code, i.slug, p.number, count(*) AS n
         FROM reader_watch w
         JOIN provision p  ON p.id = w.provision_id
         JOIN instrument i ON i.id = p.instrument_id
        WHERE w.kind = 'bookmark'
        GROUP BY i.short_code, i.slug, p.number
        ORDER BY count(*) DESC, i.short_code
        LIMIT 15`,
    ),
    pool.query(
      `SELECT q, count(*) AS n FROM reader_search GROUP BY q ORDER BY count(*) DESC, q LIMIT 15`,
    ),
  ]);

  const t = (totals.rows[0] ?? {}) as Record<string, unknown>;
  const rows = readers.rows as Record<string, unknown>[];

  const Popular = ({ title, data, note }: { title: string; data: Record<string, unknown>[]; note: string }) => (
    <section>
      <h2 className="eyebrow">{title}</h2>
      <p className="mt-0.5 text-[11.5px] text-[var(--ink-4)]">{note}</p>
      {data.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--ink-3)]">Nothing yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
          {data.map((d, i) => (
            <li key={`${String(d.slug)}-${String(d.number)}-${i}`} className="flex justify-between gap-3 py-1.5 text-[13px]">
              <Link href={`/browse/${String(d.slug)}/text`} className="truncate text-[var(--link)] hover:underline">
                <span className="num font-medium">{String(d.number)}</span>
                <span className="text-[var(--ink-3)]"> · {String(d.short_code)}</span>
              </Link>
              <span className="num shrink-0 text-[var(--ink-3)]">{String(d.n)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="mx-auto max-w-6xl py-2">
      <p className="eyebrow">Admin</p>
      <h1 className="serif mt-1 text-[25px] font-semibold text-[var(--ink)]">Readers</h1>

      {/* The other half of the console. /status carries the same key, so this hands it over rather than
          making the owner paste it a second time -- which is the sort of friction that ends with a key
          written down somewhere it should not be. */}
      <p className="mt-1 text-[13px]">
        <Link href={`/status?key=${encodeURIComponent(key ?? "")}`} className="text-[var(--link)] hover:underline">
          Collection status &rarr;
        </Link>
        <span className="ml-2 text-[var(--ink-4)]">what last ran, what failed, what is queued</span>
      </p>
      <p className="mt-0.5 text-[13px]">
        <Link href={`/quality?key=${encodeURIComponent(key ?? "")}`} className="text-[var(--link)] hover:underline">
          Text that needs a look &rarr;
        </Link>
        <span className="ml-2 text-[var(--ink-4)]">provisions whose stored text looks wrong</span>
      </p>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-y border-[var(--rule)] py-3 text-[13px]">
        <Stat n={t.readers} label="signed up" />
        <Stat n={t.active} label="seen in 7 days" />
        <Stat n={t.alerts} label="want alerts" />
        <Stat n={t.confirmed} label="confirmed" />
        <Stat n={t.added} label="added by hand" />
        <Stat n={t.follows} label="follows" />
        <Stat n={t.bookmarks} label="bookmarks" />
        <Stat n={t.notes} label="notes" />
        <Stat n={t.searches} label="saved searches" />
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <Popular title="Most followed" data={popular.rows as Record<string, unknown>[]} note="Sections readers want to be told about." />
        <Popular title="Most bookmarked" data={marked.rows as Record<string, unknown>[]} note="Sections readers come back to." />
        <section>
          <h2 className="eyebrow">Saved searches</h2>
          <p className="mt-0.5 text-[11.5px] text-[var(--ink-4)]">Kept deliberately, not logged.</p>
          {queries.rows.length === 0 ? (
            <p className="mt-2 text-[13px] text-[var(--ink-3)]">Nothing yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-[var(--rule)] border-y border-[var(--rule)]">
              {(queries.rows as Record<string, unknown>[]).map((d, i) => (
                <li key={i} className="flex justify-between gap-3 py-1.5 text-[13px]">
                  <span className="truncate">{String(d.q)}</span>
                  <span className="num shrink-0 text-[var(--ink-3)]">{String(d.n)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <AdminReaders adminKey={key ?? ""} />

      <h2 className="eyebrow mt-8">Everyone</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13.5px] text-[var(--ink-3)]">Nobody has signed in yet.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--rule-strong)] text-left">
                {["Email", "Name", "Follows", "Marks", "Notes", "Searches", "Alerts", "Source", "Joined", "Last seen"].map((h, i) => (
                  <th key={h} className={`py-2 pr-3 font-semibold ${i >= 2 && i <= 5 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.id)} className="border-b border-[var(--rule)]">
                  <td className="py-1.5 pr-3 break-all">{String(r.email)}</td>
                  <td className="py-1.5 pr-3">{(r.name as string) || <span className="text-[var(--ink-4)]">—</span>}</td>
                  <td className="num py-1.5 pr-3 text-right">{String(r.follows)}</td>
                  <td className="num py-1.5 pr-3 text-right">{String(r.bookmarks)}</td>
                  <td className="num py-1.5 pr-3 text-right">{String(r.notes)}</td>
                  <td className="num py-1.5 pr-3 text-right">{String(r.searches)}</td>
                  <td className="py-1.5 pr-3 text-[12px]">
                    {r.alerts_on ? (
                      <span className={r.confirmed ? undefined : "text-[var(--ink-2)]"}>
                        on{r.confirmed ? "" : ", unconfirmed"}
                      </span>
                    ) : (
                      <span className="text-[var(--ink-4)]">off</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-[12px]">
                    {r.source === "admin" ? (
                      <span className="text-[var(--ink-2)]">added by hand</span>
                    ) : (
                      <span className="text-[var(--ink-4)]">signed up</span>
                    )}
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
