"""Keep the regulator's own HTML rendering of a provision.

The Income Tax department (and CBIC) publish each section as formatted HTML: tables of rates, indented
sub-clauses, provisos, footnote markers. Flattening that to plain text destroys the alignment a reader
needs. This module keeps the markup but strips everything that belongs to the portal's page furniture
(scripts, styles, navigation, inline colours), so the site can render it faithfully and safely.
"""
from __future__ import annotations

import re

from bs4 import BeautifulSoup, NavigableString, Tag

# Tags worth keeping: structure, emphasis and tables. Everything else is unwrapped.
_KEEP = {
    "p", "br", "b", "strong", "i", "em", "u", "sup", "sub", "span", "div",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "col", "colgroup",
    "ul", "ol", "li", "dl", "dt", "dd", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "a",
}
_DROP = {"script", "style", "noscript", "iframe", "object", "embed", "form", "input", "button", "svg", "meta", "link"}
# Attributes worth keeping: table shape and alignment carry legal meaning (rate tables, schedules).
_KEEP_ATTRS = {"colspan", "rowspan", "align", "valign", "start", "type", "href", "id"}


def clean_official_html(html: str, *, base_url: str | None = None) -> str:
    """Return the provision's markup, safe to render, with the publisher's structure intact."""
    if not html or "<" not in html:
        return ""
    soup = BeautifulSoup(html, "lxml")
    body = soup.body or soup

    for tag in body.find_all(list(_DROP)):
        tag.decompose()

    for tag in body.find_all(True):
        if tag.name not in _KEEP:
            tag.unwrap()
            continue
        attrs = {}
        for name, value in list(tag.attrs.items()):
            if name in _KEEP_ATTRS:
                attrs[name] = value
        if tag.name == "a":
            href = attrs.get("href", "")
            if base_url and href and href.startswith("/"):
                attrs["href"] = base_url.rstrip("/") + href
            if not attrs.get("href", "").startswith(("http://", "https://")):
                tag.unwrap()
                continue
            attrs = {"href": attrs["href"], "target": "_blank", "rel": "noreferrer"}
        tag.attrs = attrs

    html_out = body.decode_contents() if hasattr(body, "decode_contents") else str(body)
    html_out = re.sub(r"(&nbsp;|\xa0)", " ", html_out)
    html_out = re.sub(r"(\s*<br\s*/?>\s*){3,}", "<br/><br/>", html_out)
    html_out = re.sub(r"<p>\s*</p>", "", html_out)
    return html_out.strip()


def html_to_text(html: str) -> str:
    """Plain text for search and diffing, with block boundaries preserved as newlines."""
    if not html:
        return ""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all(list(_DROP)):
        tag.decompose()
    for br in soup.find_all("br"):
        br.replace_with(NavigableString("\n"))
    lines: list[str] = []
    for el in soup.find_all(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"]):
        if el.find(["p", "div", "li", "tr"]):
            continue
        if el.name == "tr":
            cells = [c.get_text(" ", strip=True) for c in el.find_all(["td", "th"])]
            text = " | ".join(c for c in cells if c)
        else:
            text = el.get_text(" ", strip=True)
        if text:
            lines.append(re.sub(r"[ \t\xa0]+", " ", text))
    if not lines:
        text = soup.get_text("\n", strip=True)
        lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    out = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", out).strip()
