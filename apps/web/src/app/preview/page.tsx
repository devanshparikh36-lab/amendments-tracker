import { IBM_Plex_Sans, IBM_Plex_Serif, Inter, Literata, Source_Serif_4 } from "next/font/google";

/* A scratch page for choosing type and colour, and nothing else.
 *
 * Temporary by design: it exists so the options can be looked at on a real screen at real sizes instead of
 * described in words, and it comes out again once a choice is made. noindex so it never turns up in a search
 * result in the meantime.
 *
 * Every family here is self-hosted by next/font at build time -- the files are served from this origin, so
 * there is no request to Google, nothing to block, and no shift while a webfont swaps in. */

const sourceSerif = Source_Serif_4({ subsets: ["latin"], display: "swap" });
const literata = Literata({ subsets: ["latin"], display: "swap" });
const plexSerif = IBM_Plex_Serif({ subsets: ["latin"], weight: ["400", "600"], display: "swap" });
const inter = Inter({ subsets: ["latin"], display: "swap" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const metadata = { title: "Preview", robots: { index: false, follow: false } };
export const dynamic = "force-static";

// A real provision, because lorem ipsum hides exactly the problems that matter here: numerals, sub-clause
// references, and the long subordinate clauses Indian drafting runs on.
const STATUTE = `(1) Where an assessee, being an individual or a Hindu undivided family, has in the previous year paid or deposited any sums out of his income chargeable to tax, he shall, in accordance with and subject to the provisions of this section, be allowed a deduction in computing the total income of an amount not exceeding one lakh fifty thousand rupees.`;

const UI_BITS = ["Acts & Rules", "Notifications", "Definitions", "80C", "LODR 17", "section 16 CGST", "G.S.R. 357(E)"];

const SERIFS = [
  { name: "Source Serif 4", cls: sourceSerif.className, note: "Drawn for long-form reading. Neutral and modern." },
  { name: "Literata", cls: literata.className, note: "Made for sustained on-screen reading. Warmer, more character." },
  { name: "IBM Plex Serif", cls: plexSerif.className, note: "Institutional and engineered. Cooler in tone." },
  { name: "Georgia — what you have now", cls: "", note: "System fallback. Renders differently on every machine." },
];

const SANS = [
  { name: "Inter", cls: inter.className, note: "The clearest UI face at small sizes." },
  { name: "IBM Plex Sans", cls: plexSans.className, note: "Pairs with Plex Serif for one coherent identity." },
  { name: "Segoe UI — what you have now", cls: "", note: "Whatever the visitor's system provides." },
];

const SUBJECTS = [
  { label: "Income tax", now: "#1d4ed8", warm: "#1e40af" },
  { label: "GST", now: "#b45309", warm: "#a16207" },
  { label: "FEMA", now: "#0f766e", warm: "#0f766e" },
  { label: "SEBI", now: "#7c3aed", warm: "#6d28d9" },
  { label: "Companies", now: "#be123c", warm: "#9f1239" },
];

function Swatch({ hex, label }: { hex: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <span className="h-4 w-4 rounded-sm ring-1 ring-black/10" style={{ background: hex }} />
      {label} <span className="num text-[var(--ink-4)]">{hex}</span>
    </span>
  );
}

export default function PreviewPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-16">
      <header className="border-b border-[var(--rule)] pb-3">
        <h1 className="page-title">Type and colour, to look at</h1>
        <p className="meta mt-1">
          A temporary page. Pick a serif, a sans and a colour option, tell me the names, and this comes down.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="eyebrow">Serif — the statutory text you actually read</h2>
        {SERIFS.map((f) => (
          <div key={f.name} className="panel panel-body">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="text-[13px] font-semibold">{f.name}</span>
              <span className="meta">{f.note}</span>
            </div>
            <p className={`${f.cls} text-[16px] leading-relaxed text-[var(--ink)]`} style={f.cls ? {} : { fontFamily: "var(--serif)" }}>
              {STATUTE}
            </p>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="eyebrow">Sans — navigation, labels, citations</h2>
        {SANS.map((f) => (
          <div key={f.name} className="panel panel-body">
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <span className="text-[13px] font-semibold">{f.name}</span>
              <span className="meta">{f.note}</span>
            </div>
            <div className={`${f.cls} flex flex-wrap items-center gap-x-4 gap-y-2`} style={f.cls ? {} : { fontFamily: "var(--ui)" }}>
              <span className="text-[19px] font-semibold tracking-tight">As Amended</span>
              {UI_BITS.map((b) => (
                <span key={b} className="text-[13.5px] text-[var(--ink-2)]">{b}</span>
              ))}
              <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-4)]">
                Indian tax &amp; corporate law
              </span>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="eyebrow">Colour</h2>

        <div className="panel panel-body">
          <p className="mb-3 text-[13px] font-semibold">
            Option 1 — surface the subject palette you already have
          </p>
          <p className="meta mb-3">
            These five colours are already defined and used in two places. This puts them on subject cards,
            instrument headers, regulator tags and the active nav item. Paper and ink unchanged.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {SUBJECTS.map((s) => (
              <Swatch key={s.label} hex={s.now} label={s.label} />
            ))}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {SUBJECTS.slice(0, 4).map((s) => (
              <div key={s.label} className="rounded border border-[var(--rule)] bg-white p-3" style={{ borderLeft: `4px solid ${s.now}` }}>
                <div className="text-[13px] font-medium">{s.label}</div>
                <div className="meta">Income-tax Act, 1961 · 935 sections</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel panel-body">
          <p className="mb-3 text-[13px] font-semibold">Option 2 — the same, plus a warmer accent</p>
          <p className="meta mb-3">
            Everything in option 1, and the near-black green on buttons and the masthead replaced with
            something less severe. Compare the two buttons.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Swatch hex="#1d4030" label="Now" />
            <button className="rounded px-4 py-2 text-[13px] font-medium text-white" style={{ background: "#1d4030" }}>
              Look up
            </button>
            <span className="text-[var(--ink-4)]">vs</span>
            <Swatch hex="#276749" label="Warmer" />
            <button className="rounded px-4 py-2 text-[13px] font-medium text-white" style={{ background: "#276749" }}>
              Look up
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {SUBJECTS.map((s) => (
              <Swatch key={s.label} hex={s.warm} label={s.label} />
            ))}
          </div>
          <p className="meta mt-2">
            Subject colours are a touch deeper here too, so they sit at a consistent weight against paper
            rather than the mixed lightness they have now.
          </p>
        </div>
      </section>
    </div>
  );
}
