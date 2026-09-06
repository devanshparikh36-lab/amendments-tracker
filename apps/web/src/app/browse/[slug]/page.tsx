import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { SectionFilter } from "@/components/SectionFilter";
import { KIND_LABEL } from "@/lib/catalogue";
import { fileHref, pdfHref } from "@/lib/files";
import { fmtDate, slugifyNumber } from "@/lib/format";
import {
  getInstrument,
  getProvision,
  instrumentDocuments,
  listProvisionIndex,
  listProvisions,
  provisionDocuments,
  type InstrumentRow,
  type ProvisionRow,
} from "@/lib/queries";
import { hasRealHtml, sanitizeHtml } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type Search = Promise<{ p?: string; asOn?: string; view?: string }>;

function unitFor(kind: string): string {
  if (kind === "rules") return "rule";
  if (kind === "regulations") return "regulation";
  if (kind === "master_direction" || kind === "master_circular") return "paragraph";
  return "section";
}

// The official PDF for a provision: its own page in its own file if the pipeline recorded one,
// otherwise the instrument's consolidated PDF, otherwise whatever official URL we have.
function officialSource(inst: InstrumentRow, p?: ProvisionRow | null) {
  const key = p?.pdf_storage_key ?? inst.pdf_storage_key ?? null;
  const url = fileHref(key, null) || null;
  const page = p?.pdf_page ?? null;
  if (url) {
    return {
      kind: "pdf" as const,
      href: pdfHref(url, page),
      embed: pdfHref(url, page, true),
      label: page ? `Open official PDF at page ${page}` : "Open official PDF",
      page,
    };
  }
  const link = p?.source_url ?? inst.pdf_source_url ?? inst.official_url ?? null;
  return link ? { kind: "link" as const, href: link, embed: null, label: "Open official source", page: null } : null;
}

export default async function InstrumentPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { slug } = await params;
  const sp = await searchParams;
  const inst = await getInstrument(slug);
  if (!inst) notFound();

  const unit = unitFor(inst.kind);
  const suffix = sp.asOn ? `&asOn=${sp.asOn}` : "";
  const fullText = sp.view === "full" && !sp.p;

  const [index, docs, selected, fullRows] = await Promise.all([
    listProvisionIndex(inst.id),
    instrumentDocuments(inst.id),
    sp.p ? getProvision(inst.id, sp.p, sp.asOn) : Promise.resolve(null),
    fullText ? listProvisions(inst.id, sp.asOn) : Promise.resolve([]),
  ]);
  const selectedDocs = selected ? await provisionDocuments(selected.id) : [];
  const source = officialSource(inst, selected);
  const sections = index.filter((i) => i.level !== "chapter");
  // The sidebar ships to the browser: send trimmed headings so a 900-section Act stays light.
  const navItems = index.map((i) => ({
    ...i,
    heading: i.heading && i.heading.length > 80 ? `${i.heading.slice(0, 80)}…` : i.heading,
  }));

  return (
    <div className="space-y-4">
      <div className="no-print">
        <div className="text-xs text-stone-500">
          <Link href="/" className="hover:underline">
            Home
          </Link>{" "}
          /{" "}
          <Link href="/browse" className="hover:underline">
            Acts &amp; Rules
          </Link>{" "}
          / {inst.regulator_code}
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[19px] font-semibold tracking-tight text-stone-900">{inst.title}</h1>
          <span className="text-xs text-stone-500">
            {KIND_LABEL[inst.kind] ?? inst.kind} · {sections.length} {unit}s
            {inst.official_updated_as_on && <> · official text as on {fmtDate(inst.official_updated_as_on)}</>}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {!sp.p && source && (
            <a
              href={source.href}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-stone-300 px-3 py-1.5 text-[13px] text-stone-800 hover:bg-stone-100"
            >
              {source.label}
            </a>
          )}
          <Link
            href={`/browse/${slug}${fullText ? "" : "?view=full"}${sp.asOn ? `${fullText ? "?" : "&"}asOn=${sp.asOn}` : ""}`}
            className="text-[13px] text-[var(--link)] hover:underline"
          >
            {fullText ? "Contents" : "Read full text"}
          </Link>
          <form className="ml-auto flex items-center gap-2">
            {sp.p && <input type="hidden" name="p" value={sp.p} />}
            {fullText && <input type="hidden" name="view" value="full" />}
            <label htmlFor="asOn" className="text-xs text-stone-500">
              Text as on
            </label>
            <input
              id="asOn"
              type="date"
              name="asOn"
              defaultValue={sp.asOn ?? ""}
              className="rounded border border-stone-300 px-2 py-1 text-xs"
            />
            <button className="rounded border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100">Apply</button>
            {sp.asOn && (
              <Link href={`/browse/${slug}${sp.p ? `?p=${encodeURIComponent(sp.p)}` : ""}`} className="text-xs text-stone-500 hover:underline">
                today
              </Link>
            )}
          </form>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
        <aside className="no-print sticky top-4 h-[calc(100vh-6rem)] overflow-hidden rounded-lg border border-stone-200 bg-white">
          <SectionFilter items={navItems} slug={slug} selected={sp.p} suffix={suffix} unit={unit} />
        </aside>

        <div className="print-full min-w-0 space-y-4">
          {selected ? (
            <ProvisionView
              inst={inst}
              p={selected}
              slug={slug}
              unit={unit}
              source={source}
              docs={selectedDocs}
              asOn={sp.asOn}
            />
          ) : fullText ? (
            <article className="space-y-3">
              {fullRows.map((p) => (
                <section key={p.id} id={slugifyNumber(p.number)} className="rounded-lg border border-stone-200 bg-white p-4">
                  <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                    <Link href={`/browse/${slug}?p=${encodeURIComponent(p.number)}`} className="font-semibold hover:underline">
                      {p.level === "chapter" ? p.heading : p.number}
                    </Link>
                    {p.level !== "chapter" && p.heading && <span className="text-sm text-stone-600">{p.heading}</span>}
                    {p.source_kind === "machine_merged" && <Badge kind="machine_merged" />}
                  </div>
                  <ProvisionBody p={p} />
                </section>
              ))}
              {fullRows.length === 0 && <NotSeeded />}
            </article>
          ) : index.length === 0 ? (
            <NotSeeded />
          ) : (
            <Contents index={index} slug={slug} suffix={suffix} unit={unit} inst={inst} source={source} docs={docs} />
          )}
        </div>
      </div>
    </div>
  );
}

function NotSeeded() {
  return (
    <p className="rounded-lg border border-dashed border-stone-300 bg-white p-8 text-center text-stone-600">
      The official text for this instrument has not been loaded yet. Notifications and circulars tagged to it are still
      listed under <Link href="/documents" className="text-[var(--link)] underline">Notifications</Link>.
    </p>
  );
}

function ProvisionBody({ p }: { p: ProvisionRow }) {
  if (hasRealHtml(p.html)) {
    // The regulator's own markup: tables, indentation and provisos survive intact.
    return <div className="legal" dangerouslySetInnerHTML={{ __html: sanitizeHtml(p.html) }} />;
  }
  if (p.text) return <div className="legal-pre">{p.text}</div>;
  return <p className="text-stone-500">No text recorded for this date.</p>;
}

type Source = ReturnType<typeof officialSource>;

function ProvisionView({
  inst,
  p,
  slug,
  unit,
  source,
  docs,
  asOn,
}: {
  inst: InstrumentRow;
  p: ProvisionRow;
  slug: string;
  unit: string;
  source: Source;
  docs: Awaited<ReturnType<typeof provisionDocuments>>;
  asOn?: string;
}) {
  const showEmbed = source?.kind === "pdf";
  return (
    <div className={showEmbed ? "grid gap-4 xl:grid-cols-2" : ""}>
      <article className="rounded-lg border border-stone-200 bg-white">
        <header className="border-b border-stone-200 px-5 py-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-[17px] font-semibold capitalize text-stone-900">
              {unit} {p.number}
            </h2>
            {p.heading && <span className="text-[15px] text-stone-700">{p.heading.replace(/[.\-\s]+$/, "")}</span>}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <Link href={`/browse/${slug}`} className="hover:underline">
              {inst.title}
            </Link>
            {p.source_kind && <Badge kind={p.source_kind} />}
            {p.differs > 0 && <Badge kind="differs_from_official" />}
            {p.effective_from && <span>w.e.f. {fmtDate(p.effective_from)}</span>}
            {asOn && <span>as on {fmtDate(asOn)}</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
            {source ? (
              <a
                href={source.href}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-[var(--accent)] px-3.5 py-2 text-[13px] font-medium text-white hover:bg-[#173618]"
              >
                {source.label}
              </a>
            ) : (
              <span className="text-xs text-stone-400">Official file not linked yet.</span>
            )}
            {p.source_url && source?.kind === "pdf" && (
              <a
                href={p.source_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-stone-300 px-3 py-2 text-[13px] hover:bg-stone-100"
              >
                Source page
              </a>
            )}
            <Link
              href={`/browse/${slug}/${slugifyNumber(p.number)}/history`}
              className="rounded-md border border-stone-300 px-3 py-2 text-[13px] hover:bg-stone-100"
            >
              Amendment history{p.effect_count ? ` (${p.effect_count})` : ""}
            </Link>
          </div>
        </header>
        <div className="px-5 py-4">
          <ProvisionBody p={p} />
          {p.footnote && (
            <p className="mt-3 border-t border-stone-100 pt-2 text-xs leading-relaxed text-stone-500">{p.footnote}</p>
          )}
        </div>
        {docs.length > 0 && (
          <section className="border-t border-stone-200 px-5 py-3">
            <h3 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-stone-500">
              Documents affecting this {unit}
            </h3>
            <ul className="space-y-1.5 text-sm">
              {docs.map((d) => (
                <li key={d.id}>
                  <Link href={`/documents/${d.id}`} className="text-stone-800 hover:underline">
                    {d.title}
                  </Link>
                  <div className="text-xs text-stone-500">
                    {fmtDate(d.date_issued)} {d.number && <>· {d.number}</>}{" "}
                    {d.change_type && <Badge kind={d.change_type} />}{" "}
                    {d.verification_status && d.verification_status !== "unchecked" && <Badge kind={d.verification_status} />}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>

      {showEmbed && source?.embed && (
        <aside className="no-print sticky top-4 h-[calc(100vh-6rem)] overflow-hidden rounded-lg border border-stone-200 bg-white">
          <div className="flex items-center justify-between border-b border-stone-200 px-3 py-1.5 text-xs text-stone-600">
            <span>Official PDF{source.page ? `, page ${source.page}` : ""}</span>
            <a href={source.href} target="_blank" rel="noreferrer" className="text-[var(--link)] hover:underline">
              open in new tab
            </a>
          </div>
          <iframe src={source.embed} title="Official PDF" className="h-[calc(100%-2rem)] w-full" />
        </aside>
      )}
    </div>
  );
}

function Contents({
  index,
  slug,
  suffix,
  unit,
  inst,
  source,
  docs,
}: {
  index: Awaited<ReturnType<typeof listProvisionIndex>>;
  slug: string;
  suffix: string;
  unit: string;
  inst: InstrumentRow;
  source: Source;
  docs: Awaited<ReturnType<typeof instrumentDocuments>>;
}) {
  const groups: { title: string | null; items: typeof index }[] = [];
  for (const row of index) {
    if (row.level === "chapter") groups.push({ title: row.heading || row.number, items: [] });
    else {
      if (!groups.length) groups.push({ title: null, items: [] });
      groups[groups.length - 1].items.push(row);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <p className="text-sm text-stone-600">
          Pick a {unit} from the list on the left, or type its number in the filter box and press Enter. Every {unit}{" "}
          opens with the official text and a link to the regulator&rsquo;s own file.
        </p>
        {source && (
          <a href={source.href} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-[var(--link)] hover:underline">
            {source.label}
          </a>
        )}
      </div>

      {groups.map((g, gi) => (
        <section key={gi} className="rounded-lg border border-stone-200 bg-white p-4">
          {g.title && <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-stone-500">{g.title}</h2>}
          <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2 xl:grid-cols-3">
            {g.items.map((i) => (
              <li key={i.id} className="min-w-0">
                <Link
                  href={`/browse/${slug}?p=${encodeURIComponent(i.number)}${suffix}`}
                  className="block truncate rounded px-1 py-0.5 text-[13.5px] hover:bg-stone-100"
                  title={i.heading ? `${i.number} — ${i.heading}` : i.number}
                >
                  <span className="font-medium tabular-nums text-stone-900">{i.number}</span>
                  {i.heading && <span className="text-stone-600"> {i.heading.replace(/[.\-\s]+$/, "")}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-stone-500">
          Amending documents ({docs.length})
        </h2>
        <ul className="space-y-1.5 text-sm">
          {docs.slice(0, 25).map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-24 shrink-0 text-xs tabular-nums text-stone-500">{fmtDate(d.date_issued)}</span>
              <Link href={`/documents/${d.id}`} className="min-w-0 flex-1 text-stone-800 hover:underline">
                {d.title}
              </Link>
              <Badge kind={d.relation} />
            </li>
          ))}
          {docs.length === 0 && <li className="text-stone-500">Nothing tagged to {inst.short_code} yet.</li>}
        </ul>
        {docs.length > 25 && (
          <Link href={`/documents?instrument=${slug}`} className="mt-2 inline-block text-sm text-[var(--link)] hover:underline">
            All {docs.length} documents for this instrument
          </Link>
        )}
      </section>
    </div>
  );
}
