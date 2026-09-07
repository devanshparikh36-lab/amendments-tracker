// Rendering the regulator's own HTML the way the regulator lays it out.
//
// The Income Tax department publishes each section as formatted HTML, and we store that markup in
// provision_version.html. Two things about it need handling before it can be shown:
//
//  1. Clause lists are marked up as layout tables — "(i) | (spacer) | text" — not as <ol>. Rendered as
//     a generic table they turn into a grid of bordered boxes, which is not how the department shows
//     them. Each such table is tagged clause-layout here and styled back into the indented clause list
//     it is. A table with header cells, or with long text in the first column (a rate schedule), keeps
//     its grid.
//  2. The seeder prepends its own <p class="provision-heading"> to the department's markup. Where the
//     page already prints that heading, the copy inside the text is dropped so the heading is not
//     shown three times over.
//
// Nothing is reworded, reordered or dropped from the department's own content.

import { sanitizeHtml } from "@/lib/sanitize";

const HEADING_P = /<p\s+class="provision-heading"[^>]*>[\s\S]*?<\/p>\s*/gi;
// <p><b></b></p>, <p>&nbsp;</p> and friends: spacing artefacts of the source page, not content.
const EMPTY_P = /<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>|<\/?(?:b|i|u|em|strong|span|font)\b[^>]*>)*<\/p>/gi;

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// A layout table: every row leads with a short clause marker (or nothing at all, for a proviso that
// continues the previous clause) and carries the text in a later cell.
function isClauseLayout(inner: string): boolean {
  if (/<t(?:h|head)\b/i.test(inner)) return false;
  const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (!rows.length) return false;
  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 2) return false;
    if (plainText(cells[0][1]).length > 16) return false;
  }
  return true;
}

// Walk the markup and tag every table, honouring nesting so an outer table is classified on its own
// content rather than on the first </table> that happens to come along.
function tagTables(html: string): string {
  const open = /<table\b[^>]*>/gi;
  let out = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html))) {
    if (m.index < cursor) continue; // inside a table already handled
    const start = m.index;
    const bodyStart = start + m[0].length;
    // Find this table's own closing tag.
    const scan = /<\/?table\b[^>]*>/gi;
    scan.lastIndex = bodyStart;
    let depth = 1;
    let end = -1;
    let closeEnd = -1;
    let t: RegExpExecArray | null;
    while ((t = scan.exec(html))) {
      if (t[0].startsWith("</")) depth--;
      else depth++;
      if (depth === 0) {
        end = t.index;
        closeEnd = t.index + t[0].length;
        break;
      }
    }
    if (end < 0) break; // unbalanced markup: leave the rest as it is
    const inner = html.slice(bodyStart, end);
    const openTag = isClauseLayout(inner) ? '<table class="clause-layout">' : "<table>";
    out += html.slice(cursor, start) + openTag + tagTables(inner) + "</table>";
    cursor = closeEnd;
    open.lastIndex = closeEnd;
  }
  return out + html.slice(cursor);
}

export type LegalHtmlOptions = {
  // Drop the seeder's own heading paragraph — set where the page prints the heading itself.
  dropHeading?: boolean;
};

export function prepareLegalHtml(html: string | null | undefined, opts: LegalHtmlOptions = {}): string {
  if (!html) return "";
  let out = html;
  if (opts.dropHeading) out = out.replace(HEADING_P, "");
  out = out.replace(EMPTY_P, "");
  out = tagTables(out);
  return sanitizeHtml(out);
}

// Is there anything in this markup worth showing? (Text after tags are stripped.)
export function hasLegalHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  return plainText(html).length > 0;
}
