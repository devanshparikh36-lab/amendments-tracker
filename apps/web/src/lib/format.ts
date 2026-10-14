export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d.length === 10 ? d + "T00:00:00Z" : d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

// An instant, shown in IST. The zone has to be named: "en-IN" chooses how the date is written, not
// which clock it is written from, and with no timeZone the runtime's own zone is used -- UTC on
// Netlify. The site read "Last checked 14 Oct 2026, 02:23 am" for a collection that ran at 07:53 IST,
// which is that same instant five and a half hours earlier, and made the collector look like it ran
// in the middle of the night.
//
// fmtDate above pins UTC instead, and that is right rather than inconsistent: those are date-only
// values, and anchoring them anywhere east of UTC would roll a date into the previous day.
export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return String(d);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

// Every subject shares this list, so the labels stay generic: a CBDT notification is not a FEMA one.
export const DOC_TYPE_LABEL: Record<string, string> = {
  notification: "Notification",
  gsr: "Gazette (GSR)",
  apdir_circular: "A.P. (DIR Series) Circular",
  master_direction: "Master Direction",
  act: "Act",
  rules: "Rules",
  press_release: "Press release",
  faq: "FAQ",
  other: "Other",
};

export function slugifyNumber(n: string): string {
  return n.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export function fmtBytes(n: number | null | undefined): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
