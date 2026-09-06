// Minimal allow-list sanitiser for regulator-published HTML (provision_version.html).
// The source is a government website scraped by our own pipeline, but it is still untrusted input:
// everything outside the allow-list is dropped, and no attribute that can execute survives.

const ALLOWED_TAGS = new Set([
  "p", "br", "hr", "div", "span", "section",
  "b", "strong", "i", "em", "u", "s", "sup", "sub", "small", "mark",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "pre", "code", "a", "figure", "figcaption",
]);

// Tags whose entire contents must go, not just the tag itself.
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|form|input|button|select|textarea|noscript|svg|math|template)\b[\s\S]*?<\/\1\s*>/gi;

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title"]),
  td: new Set(["colspan", "rowspan", "align", "valign"]),
  th: new Set(["colspan", "rowspan", "align", "valign", "scope"]),
  col: new Set(["span"]),
  colgroup: new Set(["span"]),
  ol: new Set(["start", "type"]),
};

function safeHref(value: string): string | null {
  const v = value.trim().replace(/\s+/g, "");
  if (/^(https?:|mailto:|#|\/)/i.test(v)) return value.trim();
  return null;
}

function cleanAttributes(tag: string, attrText: string): string {
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed) return "";
  const out: string[] = [];
  const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText))) {
    const name = m[1].toLowerCase();
    if (!allowed.has(name)) continue;
    const raw = m[3] ?? m[4] ?? m[5] ?? "";
    if (name === "href") {
      const href = safeHref(raw);
      if (!href) continue;
      out.push(`href="${escapeAttr(href)}" rel="noreferrer" target="_blank"`);
      continue;
    }
    out.push(`${name}="${escapeAttr(raw)}"`);
  }
  return out.length ? " " + out.join(" ") : "";
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  // Two passes: nested drops (e.g. a <script> inside a <form>) collapse cleanly.
  out = out.replace(DROP_WITH_CONTENT, "").replace(DROP_WITH_CONTENT, "");
  // Any leftover opening tag of a dropped element (unbalanced markup) goes too.
  out = out.replace(/<\/?(script|style|iframe|object|embed|form|input|button|select|textarea|noscript|svg|math|template)\b[^>]*>/gi, "");
  out = out.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_full, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    const closing = /^<\//.test(_full);
    if (closing) return `</${tag}>`;
    const selfClosing = /\/\s*$/.test(attrs);
    return `<${tag}${cleanAttributes(tag, attrs)}${selfClosing ? " /" : ""}>`;
  });
  return out.trim();
}

export function hasRealHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  return sanitizeHtml(html).replace(/<[^>]*>/g, "").trim().length > 0;
}
