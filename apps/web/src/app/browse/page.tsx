import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { listInstruments } from "@/lib/queries";

export const dynamic = "force-dynamic";

const REGULATOR_LABEL: Record<string, string> = {
  RBI: "Reserve Bank of India — FEMA",
  DEA: "Ministry of Finance — FEMA",
  CBDT: "Income Tax",
  CBIC: "GST",
  SEBI: "SEBI",
  MCA: "Companies Act",
};

const KIND_LABEL: Record<string, string> = {
  act: "Act",
  rules: "Rules",
  regulations: "Regulations",
  master_direction: "Master Direction",
  master_circular: "Master Circular",
  scheme: "Scheme",
  other: "Other",
};

const KIND_ORDER = ["act", "rules", "regulations", "master_direction", "master_circular", "scheme", "other"];

type Search = Promise<{ q?: string; regulator?: string; seeded?: string }>;

export default async function BrowsePage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const all = await listInstruments();
  const q = (sp.q ?? "").trim().toLowerCase();
  const instruments = all.filter(
    (i) =>
      (!sp.regulator || i.regulator_code === sp.regulator) &&
      (!q || i.title.toLowerCase().includes(q) || i.short_code.toLowerCase().includes(q)) &&
      (sp.seeded !== "1" || i.provision_count > 0),
  );

  const regulators = [...new Set(all.map((i) => i.regulator_code))].sort(
    (a, b) => Object.keys(REGULATOR_LABEL).indexOf(a) - Object.keys(REGULATOR_LABEL).indexOf(b),
  );
  const groups = new Map<string, typeof instruments>();
  for (const i of instruments) groups.set(i.regulator_code, [...(groups.get(i.regulator_code) ?? []), i]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Regulations</h1>
        <p className="text-sm text-stone-600">
          {instruments.length} of {all.length} tracked · {instruments.reduce((n, i) => n + i.provision_count, 0).toLocaleString("en-IN")} provisions
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-stone-200 bg-white p-3 text-sm">
        <label className="flex flex-col text-xs text-stone-500">
          Search
          <input name="q" defaultValue={sp.q ?? ""} placeholder="LODR, ECB, incorporation" className="w-64 rounded border border-stone-300 px-2 py-1 text-sm" />
        </label>
        <label className="flex flex-col text-xs text-stone-500">
          Regulator
          <select name="regulator" defaultValue={sp.regulator ?? ""} className="rounded border border-stone-300 px-2 py-1 text-sm">
            <option value="">All</option>
            {regulators.map((r) => (
              <option key={r} value={r}>{REGULATOR_LABEL[r] ?? r}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-stone-600">
          <input type="checkbox" name="seeded" value="1" defaultChecked={sp.seeded === "1"} /> with text only
        </label>
        <button className="rounded bg-stone-800 px-3 py-1.5 text-white">Filter</button>
        {(sp.q || sp.regulator || sp.seeded) && (
          <Link href="/browse" className="text-sm text-stone-600 hover:underline">clear</Link>
        )}
      </form>

      {regulators
        .filter((r) => groups.has(r))
        .map((code) => {
          const items = (groups.get(code) ?? []).slice().sort((a, b) => {
            const k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
            return k !== 0 ? k : a.title.localeCompare(b.title);
          });
          return (
            <section key={code}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                {REGULATOR_LABEL[code] ?? code} <span className="font-normal normal-case text-stone-400">({items.length})</span>
              </h2>
              <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="px-3 py-2">Title</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Text as on</th>
                      <th className="px-3 py-2 text-right">Provisions</th>
                      <th className="px-3 py-2 text-right">Documents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id} className="border-t border-stone-100 hover:bg-stone-50">
                        <td className="px-3 py-2">
                          <Link href={`/browse/${i.slug}`} className="font-medium hover:underline">{i.title}</Link>
                          {i.provision_count === 0 && <span className="ml-2 text-xs text-stone-400">not seeded yet</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-stone-600">{KIND_LABEL[i.kind] ?? i.kind}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-stone-600">{fmtDate(i.official_updated_as_on)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{i.provision_count || ""}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{i.doc_count || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      {instruments.length === 0 && <p className="text-stone-500">Nothing matches that filter.</p>}
    </div>
  );
}
