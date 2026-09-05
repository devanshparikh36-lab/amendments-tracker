import Link from "next/link";
import { fmtDate } from "@/lib/format";
import { listInstruments } from "@/lib/queries";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  act: "Acts",
  rules: "Rules",
  regulations: "Regulations",
  master_direction: "RBI Master Directions",
  scheme: "Schemes",
  other: "Other",
};

export default async function BrowsePage() {
  const instruments = await listInstruments();
  const groups = new Map<string, typeof instruments>();
  for (const i of instruments) groups.set(i.kind, [...(groups.get(i.kind) ?? []), i]);
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Regulations</h1>
      {[...groups.entries()].map(([kind, items]) => (
        <section key={kind}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{KIND_LABEL[kind] ?? kind}</h2>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Regulator</th>
                  <th className="px-3 py-2">Official text as on</th>
                  <th className="px-3 py-2 text-right">Provisions</th>
                  <th className="px-3 py-2 text-right">Machine-consolidated</th>
                  <th className="px-3 py-2 text-right">Documents</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="px-3 py-2">
                      <Link href={`/browse/${i.slug}`} className="font-medium hover:underline">{i.title}</Link>
                      {!i.seeded_at && <span className="ml-2 text-xs text-stone-400">not yet seeded</span>}
                    </td>
                    <td className="px-3 py-2 text-stone-600">{i.regulator_code}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-stone-600">{fmtDate(i.official_updated_as_on)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.provision_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.machine_count || ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.doc_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {instruments.length === 0 && <p className="text-stone-500">No regulations registered yet.</p>}
    </div>
  );
}
