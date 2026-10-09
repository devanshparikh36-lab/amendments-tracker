import { fileHref, pdfHref } from "@/lib/files";
import type { InstrumentRow, ProvisionRow } from "@/lib/queries";

/* The regulator's page, as a reader would open it.
 *
 * `instrument.official_url` is where the *seeder* reads the text, and for some regulators that is not a page
 * at all. CBIC's GST portal is an Angular app over a JSON API, so the Acts and Rules are seeded from
 * endpoints like `taxinformation.cbic.gov.in/api/cbic-act-section-msts/findByActId/1000006` -- and the site
 * was offering exactly that as "CBIC's page", which hands a reader raw JSON. A few instruments have no
 * official_url at all (IGST Rules, eight SEBI regulations registered from the listing), so the link simply
 * vanished for those.
 *
 * Keeping this in the presentation layer rather than adding a column: the stored value is correct for what it
 * is for, and only the display of it was ever wrong.
 */
/* Every URL below was opened and checked, not inferred from a pattern.
 *
 * Two traps made that necessary. CBIC's portal is an Angular app, so it answers 200 to any path at all --
 * `/content-page/explore-act/1000006` looks alive and is a client-side 404. And SEBI's tidy
 * `sebi.gov.in/legal/regulations` returns a genuine 403 to a real browser, not merely to a scripted client,
 * so the obvious URL is a dead end; its listings live under `/sebiweb/` with a section id.
 *
 * CBDT and MCA answer 403 to curl and load normally in a browser -- that is bot protection, which is why the
 * pipeline drives them through Chromium. Those two were confirmed by loading them in one.
 */
const READER_PAGES: { when: (i: InstrumentRow) => boolean; url: string }[] = [
  { when: (i) => i.regulator_code === "CBIC" && i.kind === "rules", url: "https://cbic-gst.gov.in/gst-rules.html" },
  { when: (i) => i.regulator_code === "CBIC", url: "https://cbic-gst.gov.in/gst-acts.html" },
  // ssid picks the section of SEBI's Legal listing: 1 acts, 3 regulations, 6 master circulars.
  { when: (i) => i.regulator_code === "SEBI" && i.kind === "act", url: "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=1&smid=0" },
  { when: (i) => i.regulator_code === "SEBI" && i.kind === "master_circular", url: "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=6&smid=0" },
  { when: (i) => i.regulator_code === "SEBI", url: "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=3&smid=0" },
  { when: (i) => i.regulator_code === "CBDT" && i.kind === "rules", url: "https://www.incometaxindia.gov.in/income-tax-rules" },
  { when: (i) => i.regulator_code === "CBDT", url: "https://www.incometaxindia.gov.in/income-tax-act" },
  { when: (i) => i.regulator_code === "MCA" && i.kind === "rules", url: "https://www.mca.gov.in/content/mca/global/en/acts-rules/ebooks/rules.html" },
  { when: (i) => i.regulator_code === "MCA", url: "https://www.mca.gov.in/content/mca/global/en/acts-rules/ebooks/acts.html" },
  { when: (i) => i.regulator_code === "RBI" || i.regulator_code === "DEA", url: "https://www.rbi.org.in/Scripts/BS_FemaNotifications.aspx" },
];

/** True when a URL is something a machine reads rather than something a person opens. */
function isMachineEndpoint(url: string): boolean {
  return /\/api\/|\/content\/(html|pdf)\/|format=json/i.test(url);
}

/** Where "the regulator's page" should actually send a reader. Null when there is nowhere honest to send them. */
export function regulatorPageUrl(inst: InstrumentRow): string | null {
  const stored = inst.official_url;
  if (stored && !isMachineEndpoint(stored)) return stored;
  return READER_PAGES.find((r) => r.when(inst))?.url ?? null;
}

export type OfficialSource =
  | { kind: "pdf"; href: string; embed: string; label: string; page: number | null }
  | { kind: "link"; href: string; embed: null; label: string; page: null }
  | null;

// The official document behind what is on screen: the provision's own page in its own file if the
// pipeline recorded one, otherwise the instrument's consolidated PDF, otherwise the regulator's page.
export function officialSource(inst: InstrumentRow, p?: ProvisionRow | null): OfficialSource {
  const key = p?.pdf_storage_key ?? inst.pdf_storage_key ?? null;
  const url = fileHref(key, null) || null;
  const page = p?.pdf_page ?? null;
  if (url) {
    return {
      kind: "pdf",
      href: pdfHref(url, page),
      embed: pdfHref(url, page, true),
      label: page ? `Official PDF, page ${page}` : "Official PDF",
      page,
    };
  }
  const link = p?.source_url ?? inst.pdf_source_url ?? inst.official_url ?? null;
  return link ? { kind: "link", href: link, embed: null, label: "Official source", page: null } : null;
}
