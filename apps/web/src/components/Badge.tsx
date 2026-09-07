const styles: Record<string, string> = {
  official: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  machine_merged: "bg-amber-50 text-amber-800 ring-amber-200",
  differs_from_official: "bg-red-50 text-red-800 ring-red-200",
  matches_official: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  unchecked: "bg-stone-100 text-stone-700 ring-stone-200",
  cannot_apply: "bg-red-50 text-red-800 ring-red-200",
  insert: "bg-sky-50 text-sky-800 ring-sky-200",
  substitute: "bg-violet-50 text-violet-800 ring-violet-200",
  omit: "bg-stone-100 text-stone-700 ring-stone-200",
  renumber: "bg-stone-100 text-stone-700 ring-stone-200",
  amends: "bg-violet-50 text-violet-800 ring-violet-200",
  supersedes: "bg-violet-50 text-violet-800 ring-violet-200",
  clarifies: "bg-sky-50 text-sky-800 ring-sky-200",
  references: "bg-stone-100 text-stone-700 ring-stone-200",
  pending: "bg-stone-100 text-stone-700 ring-stone-200",
  tagged: "bg-sky-50 text-sky-800 ring-sky-200",
  merged: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  failed: "bg-red-50 text-red-800 ring-red-200",
  skipped: "bg-stone-100 text-stone-700 ring-stone-200",
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
  const cls = styles[kind] ?? "bg-stone-100 text-stone-700 ring-stone-200";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-px text-[11.5px] font-medium ring-1 ring-inset ${cls}`}
    >
      {children ?? labels[kind] ?? kind.replace(/_/g, " ")}
    </span>
  );
}
