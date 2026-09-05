"""Adapter contract. Every official source implements `discover()` (list documents) and `fetch()` (full content)."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date


@dataclass
class DiscoveredDocument:
    """A document as seen on a listing page. Enough to dedupe and to fetch."""

    source_url: str                 # canonical detail-page URL (unique key)
    title: str
    doc_type: str                   # notification | apdir_circular | master_direction | act | rules | gsr | press_release | faq | other
    number: str | None = None
    date_issued: date | None = None
    pdf_urls: list[str] = field(default_factory=list)   # PDFs already visible on the listing page
    extra: dict = field(default_factory=dict)           # adapter specific (e.g. updated_as_on, rbi_id)


@dataclass
class FetchedAttachment:
    source_url: str
    filename: str
    is_primary: bool = False


@dataclass
class FetchedDocument:
    raw_html: str
    body_text: str                  # verbatim text extracted from the detail page HTML
    attachments: list[FetchedAttachment]
    date_issued: date | None = None
    date_effective: date | None = None
    number: str | None = None
    title: str | None = None
    updated_as_on: date | None = None


class Adapter(ABC):
    name: str                       # matches document.source_adapter
    regulator_code: str
    needs_browser: bool = False     # True when the site refuses plain HTTP clients (files must go via the browser)
    browser_home: str = ""          # page the browser session anchors on when needs_browser is True

    @abstractmethod
    def discover(self, *, since_year: int | None = None) -> list[DiscoveredDocument]:
        """List documents. `since_year` requests archive years for backfill; None means the current listing only."""

    @abstractmethod
    def fetch(self, doc: DiscoveredDocument) -> FetchedDocument:
        """Download the detail page and identify attachments."""
