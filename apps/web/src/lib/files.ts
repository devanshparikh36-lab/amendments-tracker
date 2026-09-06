// Public URL for a stored file. Same rule everywhere: R2 public base when configured, else the
// authenticated proxy route, else whatever official URL we recorded.
export function fileHref(storageKey: string | null | undefined, fallbackUrl?: string | null): string {
  if (!storageKey) return fallbackUrl ?? "";
  const base = process.env.R2_PUBLIC_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/${storageKey}` : `/api/files/${storageKey}`;
}

// Adobe / Chrome / Firefox all honour #page=N; FitH keeps the width readable in a narrow pane.
export function pdfHref(url: string, page?: number | null, fit = false): string {
  if (!url) return url;
  const frag = [page ? `page=${page}` : "", fit ? "view=FitH" : ""].filter(Boolean).join("&");
  return frag ? `${url}#${frag}` : url;
}
