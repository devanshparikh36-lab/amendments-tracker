import { fileHref, pdfHref } from "@/lib/files";
import type { InstrumentRow, ProvisionRow } from "@/lib/queries";

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
