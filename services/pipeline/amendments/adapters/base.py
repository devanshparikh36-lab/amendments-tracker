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
    # The page a reader should open, when that is not the URL the seeder read. Most regulators need nothing
    # here: their detail page is both. CBDT's portal is a JSON API behind a Liferay site, so `source_url` is
    # an endpoint and this is the page -- see migration 0009. Left None unless an adapter knows better, and
    # the display layer falls back to `source_url`.
    reader_url: str | None = None
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


@dataclass
class SeedResult:
    """What a seeder found: the regulator's text, and the regulator's own file it came from.

    Storing the PDF and the page each provision starts on is what lets a reader open the official
    document at the right place instead of taking our transcription on trust.
    """

    text: str | None = None
    provisions: list | None = None          # list[ParsedProvision] when the source is already structured
    updated_as_on: date | None = None
    source_url: str = ""
    pdf_bytes: bytes | None = None          # the official PDF itself, to be stored verbatim
    pdf_url: str | None = None              # where that PDF lives on the regulator's site


class SourceHasNoText(RuntimeError):
    """The regulator's page offers no text and no file, and that is a fact about the source, not a failure.

    Raised only when there is nothing to retry *for*: the page loaded, it was read, and it contains a title
    and a date. Three of SEBI's master circulars are in exactly that state -- 184 to 271 characters, zero
    attachments -- and treating them as failures cost three attempts and a red workflow every day, which on
    10 October was 88 of 160 failed self-check rows. An alarm that cannot be cleared stops being read, and
    takes the real ones with it.

    Distinct from an unreachable source, which is transient and *should* be retried. The test is whether
    reading succeeded and came back empty, never whether reading failed.
    """


def as_seed_result(official: "SeedResult | tuple") -> "SeedResult":
    """Whatever a seeder returned, as a SeedResult.

    Seeders predate this class and most still return the original 3-tuple `(text, updated_as_on,
    source_url)`; the ones that fetch the regulator's own PDF return a SeedResult. The caller was unpacking
    both shapes inline, which works and leaves the contract stated nowhere -- so the two-shaped return value
    was the one piece of the seeding path with no test, and `text` versus `provisions` is exactly the kind of
    distinction that is got wrong quietly.

    `provisions` wins over `text` when both are set: a source that already supplies its sections separately
    (the income-tax portal's per-section API) has no need to be re-split, and re-splitting it would be the
    bug.
    """
    if isinstance(official, SeedResult):
        return official
    text, updated_as_on, source_url = official
    if isinstance(text, list):
        return SeedResult(provisions=text, updated_as_on=updated_as_on, source_url=source_url)
    return SeedResult(text=text, updated_as_on=updated_as_on, source_url=source_url)


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
