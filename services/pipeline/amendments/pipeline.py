"""Orchestration: discover -> fetch (verbatim + attachments) -> tag -> merge -> self-check -> notify.

Every step is a job row in Postgres so a crashed run resumes where it stopped. No human step anywhere.
"""
from __future__ import annotations

import difflib
import json
import logging
import re
import traceback
from datetime import date, datetime, timedelta, timezone
from typing import Any

import psycopg

from . import db, rules
from .adapters import registry, official_text_for
from .adapters.base import DiscoveredDocument, SeedResult
from .ai import tasks as ai
from .config import settings
from .http import get_bytes, sha256
from .instruments import PHASE1_INSTRUMENTS
from .notify import email as email_notify
from .notify import teams
from .parsers.pdf import extract_pdf_text
from .parsers.provisions import split_provisions
from .storage.files import build_key, guess_mime, storage

log = logging.getLogger(__name__)

# Consolidated texts the regulator maintains itself: never year-pruned, and they seed / self-check their instrument.
# Above this share of empty provisions, a parse is not trustworthy and the official PDF is served instead.
EMPTY_PROVISION_LIMIT = 0.25

MASTER_DIRECTION_TYPES = {"master_direction", "master_circular"}


# ----------------------------------------------------------------------------- helpers

def enqueue(conn: psycopg.Connection, job_type: str, payload: dict) -> None:
    # avoid duplicate queued jobs for the same payload
    row = db.fetch_one(
        conn,
        "SELECT id FROM job WHERE type = %s AND payload = %s::jsonb AND status IN ('queued','running')",
        (job_type, json.dumps(payload)),
    )
    if row:
        return
    db.execute(conn, "INSERT INTO job (type, payload) VALUES (%s, %s::jsonb)", (job_type, json.dumps(payload)))


def _doc_meta(conn: psycopg.Connection, doc_id: int) -> dict[str, Any]:
    row = db.fetch_one(
        conn,
        """SELECT d.*, r.code AS regulator_code FROM document d JOIN regulator r ON r.id = d.regulator_id WHERE d.id = %s""",
        (doc_id,),
    )
    if not row:
        raise LookupError(f"document {doc_id} not found")
    return row


def _doc_full_text(conn: psycopg.Connection, doc: dict) -> str:
    """Verbatim text for AI steps: the detail page body, plus text of every attachment."""
    parts = []
    if doc.get("extracted_text"):
        parts.append(doc["extracted_text"])
    for a in db.fetch_all(
        conn, "SELECT filename, extracted_text FROM attachment WHERE document_id = %s ORDER BY is_primary DESC, id", (doc["id"],)
    ):
        if a["extracted_text"] and a["extracted_text"] not in parts:
            parts.append(f"\n\n===== ATTACHMENT: {a['filename']} =====\n{a['extracted_text']}")
    return "\n".join(parts).strip()


# ----------------------------------------------------------------------------- instruments

def ensure_instruments(conn: psycopg.Connection) -> None:
    for inst in PHASE1_INSTRUMENTS:
        reg_id = db.regulator_id(conn, inst["regulator"])
        db.execute(
            conn,
            """INSERT INTO instrument (regulator_id, slug, short_code, title, kind, official_url)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (slug) DO UPDATE SET title = EXCLUDED.title, official_url = EXCLUDED.official_url""",
            (reg_id, inst["slug"], inst["short_code"], inst["title"], inst["kind"], inst["official_url"]),
        )


def enqueue_unseeded_instruments(conn: psycopg.Connection) -> int:
    """Queue a seed for configured instruments that have no provisions yet (e.g. the FEMA Act, whose source is not
    a discovered document). Master Directions seed themselves when their document is fetched."""
    n = 0
    for inst in PHASE1_INSTRUMENTS:
        if inst["seed"].get("adapter") == "rbi_master_directions":
            continue
        row = db.fetch_one(conn, "SELECT id, seeded_at FROM instrument WHERE slug = %s", (inst["slug"],))
        if row and row["seeded_at"] is None:
            enqueue(conn, "selfcheck_instrument", {"slug": inst["slug"]})
            n += 1
    return n


def _store_official_pdf(inst: dict, data: bytes, pdf_url: str, parsed: list) -> tuple[str | None, int | None]:
    """Store the regulator's PDF verbatim and set `pdf_page` on each provision. Returns (storage key, page count)."""
    from .parsers import pdfmap

    checksum = sha256(data)
    key = f"official/{inst['slug']}/{checksum[:12]}.pdf"
    store = storage()
    try:
        if not store.exists(key):
            store.put(key, data, "application/pdf")
    except Exception as exc:
        log.warning("%s: could not store the official PDF: %s", inst["slug"], str(exc)[:120])
        return None, None
    try:
        index = pdfmap.build_index(data)
        pages = index.page_count
        # Index every page so a search can land on the right page of the official document.
        with db.transaction() as conn:
            db.execute(conn, "DELETE FROM instrument_page WHERE instrument_id = %s", (inst["id"],))
            for n, page_text in enumerate(index.flat, start=1):
                if page_text.strip():
                    db.execute(
                        conn,
                        "INSERT INTO instrument_page (instrument_id, page_no, text, storage_key) VALUES (%s, %s, %s, %s)"
                        " ON CONFLICT (instrument_id, page_no) DO UPDATE SET text = EXCLUDED.text, storage_key = EXCLUDED.storage_key",
                        (inst["id"], n, page_text, key),
                    )
        located = pdfmap.find_pages(index, [p for p in parsed if p.level != "chapter"])
        log.info("%s: official PDF %d pages indexed, %d of %d provisions located", inst["slug"], pages, located, len(parsed))
    except Exception as exc:
        log.warning("%s: could not index the official PDF: %s", inst["slug"], str(exc)[:120])
        pages = None
    with db.transaction() as conn:
        db.execute(
            conn,
            """UPDATE instrument SET pdf_storage_key = %s, pdf_source_url = %s, pdf_page_count = %s, pdf_fetched_at = now()
               WHERE id = %s""",
            (key, pdf_url, pages, inst["id"]),
        )
    return key, pages


REFRESH_AFTER_DAYS = 7


def enqueue_stale_instruments(conn: psycopg.Connection, *, days: int = REFRESH_AFTER_DAYS, limit: int = 25) -> int:
    """Re-read the regulator's own text for instruments we have not checked recently.

    RBI and SEBI republish as a new document, which discovery already notices. The Income Tax department, CBIC
    and MCA instead edit their consolidated text in place behind an API, so nothing new appears to discover.
    Re-reading the oldest instruments on every scheduled run means an in-place edit shows up here too, and the
    self-check records it as a new version of whichever provisions changed.
    """
    rows = db.fetch_all(
        conn,
        """SELECT slug FROM instrument
           WHERE official_url IS NOT NULL
             AND (last_checked_at IS NULL OR last_checked_at < now() - (%s || ' days')::interval)
           ORDER BY last_checked_at NULLS FIRST LIMIT %s""",
        (days, limit),
    )
    for row in rows:
        enqueue(conn, "selfcheck_instrument", {"slug": row["slug"]})
    return len(rows)


def _seed_config(slug: str) -> dict | None:
    for inst in PHASE1_INSTRUMENTS:
        if inst["slug"] == slug:
            return inst["seed"]
    return None


# ----------------------------------------------------------------------------- discovery

class EmptyDiscovery(RuntimeError):
    """An adapter listed nothing although it has listed documents recently.

    Adapters tolerate failures unit by unit on purpose: one dead category or listing page must not cost us the rest.
    The price is that a site-wide outage looks exactly like a source that is genuinely empty — every unit fails, the
    warnings go to the log, and `discover` returns an empty list. Recorded as a successful run, that leaves the
    collector green on /status while it quietly collects nothing, which is how five adapters went a full day
    without anyone noticing. So an empty result from an adapter that was productive days ago is raised as a failure.
    """


def _recent_peak(conn: psycopg.Connection, adapter_name: str, days: int = 30) -> int:
    """The most documents this adapter listed in any successful run of the last `days` days.

    Deliberately a time window rather than a run count: a run-count window fills with zeros during a long outage and
    stops flagging precisely when the outage is worst.
    """
    row = db.fetch_one(
        conn,
        """SELECT coalesce(max(docs_found), 0) AS peak FROM source_run
            WHERE adapter = %s AND ok IS TRUE AND started_at > now() - (%s || ' days')::interval""",
        (adapter_name, days),
    )
    return int(row["peak"]) if row else 0


def adapters_failed_since(when: datetime) -> list[str]:
    """Adapters whose run since `when` ended in failure.

    `run_discovery` swallows one adapter's failure on purpose so the rest still collect, which means the process
    exits 0 no matter how many broke. With no Teams webhook configured that is completely silent — five adapters
    collected nothing for a full day and `/status` was the only place that said so. The CLI turns this into a
    non-zero exit so the workflow goes red and GitHub emails the repository owner, the same free channel the
    free-tier watch uses.
    """
    with db.transaction() as conn:
        rows = db.fetch_all(
            conn,
            "SELECT DISTINCT adapter FROM source_run WHERE started_at >= %s AND ok IS FALSE ORDER BY adapter",
            (when,),
        )
    return [r["adapter"] for r in rows]


def run_discovery(adapter_names: list[str] | None = None, *, since_year: int | None = None) -> dict[str, int]:
    """List documents on every adapter, upsert them, and queue fetches for new ones."""
    names = adapter_names or list(registry.keys())
    summary: dict[str, int] = {}
    for name in names:
        adapter = registry[name]
        with db.transaction() as conn:
            run = db.fetch_one(conn, "INSERT INTO source_run (adapter) VALUES (%s) RETURNING id", (name,))
        found = new = 0
        try:
            docs = adapter.discover(since_year=since_year)
            found = len(docs)
            if found == 0:
                with db.transaction() as conn:
                    peak = _recent_peak(conn, name)
                if peak:
                    raise EmptyDiscovery(
                        f"listed 0 documents, but listed up to {peak} in a successful run within the last 30 days. "
                        "Every unit of work inside the adapter failed; the per-unit warnings are above this line."
                    )
            with db.transaction() as conn:
                reg_id = db.regulator_id(conn, adapter.regulator_code)
                for d in docs:
                    if _upsert_discovered(conn, reg_id, name, d):
                        new += 1
                db.execute(
                    conn,
                    "UPDATE source_run SET finished_at = now(), docs_found = %s, docs_new = %s, ok = true WHERE id = %s",
                    (found, new, run["id"]),
                )
            log.info("%s: %d found, %d new", name, found, new)
        except Exception as exc:  # one adapter failing must not stop the others
            err = f"{exc}\n{traceback.format_exc()}"
            log.exception("adapter %s failed", name)
            with db.transaction() as conn:
                db.execute(
                    conn,
                    "UPDATE source_run SET finished_at = now(), docs_found = %s, docs_new = %s, ok = false, error = %s WHERE id = %s",
                    (found, new, err[:4000], run["id"]),
                )
            teams.notify_adapter_failure(name, str(exc), settings.site_url)
        summary[name] = new
    return summary


def _ensure_instrument(conn: psycopg.Connection, reg_id: int, d: DiscoveredDocument) -> None:
    """An adapter that knows a document IS an instrument's official text names the instrument in `extra`.

    (SEBI publishes one consolidated "[Last amended on ...]" page per Act / Regulation and mints a new URL for every
    republication, so the slug is the identity and `official_url` is refreshed to the newest page.)
    """
    slug = d.extra.get("instrument_slug")
    if not slug:
        return
    existing = db.fetch_one(conn, "SELECT id, official_url FROM instrument WHERE slug = %s", (slug,))
    if existing:
        if existing["official_url"] != d.source_url:
            db.execute(conn, "UPDATE instrument SET official_url = %s WHERE id = %s", (d.source_url, existing["id"]))
        return
    db.execute(
        conn,
        """INSERT INTO instrument (regulator_id, slug, short_code, title, kind, official_url)
           VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (slug) DO NOTHING""",
        (
            reg_id,
            slug,
            (d.extra.get("instrument_short_code") or slug).upper()[:24],
            d.extra.get("instrument_title") or d.title,
            d.extra.get("instrument_kind") or "regulations",
            d.source_url,
        ),
    )


def _ensure_md_instrument(conn: psycopg.Connection, reg_id: int, d: DiscoveredDocument) -> None:
    """Every FEMA Master Direction on RBI's listing becomes a tracked instrument automatically."""
    if d.extra.get("instrument_slug"):
        _ensure_instrument(conn, reg_id, d)
        return
    if db.fetch_one(conn, "SELECT id FROM instrument WHERE official_url = %s", (d.source_url,)):
        return
    base = re.sub(r"\(\s*[Uu]pdated[^)]*\)", " ", d.title)
    base = re.sub(r",?\s*dated\s+[A-Z][a-z]+ \d{1,2},? \d{4}", "", base)
    base = re.sub(r"^Master Directions?\s*[-–—:]?\s*", "", base)
    base = re.sub(r"\s+", " ", base).strip(" -–—,")
    slug = "md-" + re.sub(r"[^a-z0-9]+", "-", base.lower()).strip("-")[:70]
    if db.fetch_one(conn, "SELECT id FROM instrument WHERE slug = %s", (slug,)):
        slug = f"{slug}-{d.source_url.rsplit('=', 1)[-1]}"
    db.execute(
        conn,
        """INSERT INTO instrument (regulator_id, slug, short_code, title, kind, official_url)
           VALUES (%s, %s, %s, %s, 'master_direction', %s) ON CONFLICT (slug) DO NOTHING""",
        (reg_id, slug, slug.upper()[:24], "Master Direction - " + base, d.source_url),
    )


def is_before_cutoff(doc_type: str, title: str | None, date_issued: date | None) -> bool:
    """True if the document falls before MIN_DOCUMENT_YEAR and is not a base text we must keep."""
    y = settings.min_document_year
    if not y or not date_issued or date_issued.year >= y:
        return False
    if doc_type in MASTER_DIRECTION_TYPES:
        return False
    # original (non-amending) Acts / regulations / rules are base texts: keep them whatever their year
    if doc_type in ("notification", "gsr", "rules", "regulations", "act") and not re.search(r"\bAmendment\b|\bamend", title or "", re.I):
        return False
    return True


def _upsert_discovered(conn: psycopg.Connection, reg_id: int, adapter: str, d: DiscoveredDocument) -> bool:
    if is_before_cutoff(d.doc_type, d.title, d.date_issued):
        return False
    if d.doc_type in MASTER_DIRECTION_TYPES or d.extra.get("instrument_slug"):
        _ensure_md_instrument(conn, reg_id, d)
    existing = db.fetch_one(conn, "SELECT id, title FROM document WHERE source_url = %s", (d.source_url,))
    if existing:
        db.execute(conn, "UPDATE document SET last_seen_at = now() WHERE id = %s", (existing["id"],))
        # A Master Direction whose listing now shows a newer "Updated as on" date than the text we hold is a
        # republication: re-fetch it, which re-runs the self-check against the new official text.
        if d.doc_type in MASTER_DIRECTION_TYPES and d.extra.get("updated_as_on"):
            inst = db.fetch_one(conn, "SELECT official_updated_as_on FROM instrument WHERE official_url = %s", (d.source_url,))
            held = inst["official_updated_as_on"] if inst else None
            if held is None or d.extra["updated_as_on"] > held:
                db.execute(conn, "UPDATE document SET title = %s WHERE id = %s", (d.title, existing["id"]))
                enqueue(conn, "fetch_document", {"document_id": existing["id"], "republished": True})
        return False
    row = db.fetch_one(
        conn,
        """INSERT INTO document (regulator_id, source_adapter, doc_type, number, title, date_issued, source_url)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
        (reg_id, adapter, d.doc_type, d.number, d.title, d.date_issued, d.source_url),
    )
    for url in d.pdf_urls:
        db.execute(
            conn,
            """INSERT INTO attachment (document_id, filename, source_url, is_primary)
               VALUES (%s, %s, %s, true) ON CONFLICT (document_id, source_url) DO NOTHING""",
            (row["id"], url.rsplit("/", 1)[-1], url),
        )
    enqueue(conn, "fetch_document", {"document_id": row["id"]})
    return True


# ----------------------------------------------------------------------------- fetch

def fetch_document(doc_id: int, *, republished: bool = False) -> None:
    with db.transaction() as conn:
        doc = _doc_meta(conn, doc_id)
    adapter = registry[doc["source_adapter"]]
    discovered = DiscoveredDocument(
        source_url=doc["source_url"], title=doc["title"], doc_type=doc["doc_type"], number=doc["number"],
        date_issued=doc["date_issued"],
    )
    fetched = adapter.fetch(discovered)

    with db.transaction() as conn:
        db.execute(
            conn,
            """UPDATE document SET raw_html = %s, extracted_text = %s, number = COALESCE(%s, number),
               date_issued = COALESCE(%s, date_issued), date_effective = COALESCE(%s, date_effective),
               title = COALESCE(%s, title), checksum = %s WHERE id = %s""",
            (
                fetched.raw_html, fetched.body_text, fetched.number, fetched.date_issued, fetched.date_effective,
                fetched.title, sha256(fetched.body_text or fetched.raw_html), doc_id,
            ),
        )
        for att in fetched.attachments:
            db.execute(
                conn,
                """INSERT INTO attachment (document_id, filename, source_url, is_primary)
                   VALUES (%s, %s, %s, %s) ON CONFLICT (document_id, source_url) DO UPDATE SET is_primary = EXCLUDED.is_primary""",
                (doc_id, att.filename, att.source_url, att.is_primary),
            )
        pending = db.fetch_all(conn, "SELECT * FROM attachment WHERE document_id = %s AND storage_key IS NULL", (doc_id,))

    store = storage()
    fetch_bytes = get_bytes
    if getattr(adapter, "needs_browser", False):
        from .browser import session as browser_session

        fetch_bytes = browser_session(adapter.browser_home).get_bytes
    for att in pending:
        try:
            data, ctype = fetch_bytes(att["source_url"])
        except Exception as exc:
            log.warning("attachment download failed %s: %s", att["source_url"], exc)
            continue
        mime = guess_mime(att["filename"], ctype)
        key = build_key(doc["source_adapter"], f"{doc_id}-{doc.get('number') or 'doc'}", att["filename"])
        store.put(key, data, mime)
        text = page_count = None
        ocr = False
        if mime == "application/pdf" or att["filename"].lower().endswith(".pdf"):
            try:
                pdf = extract_pdf_text(data)
                text, page_count, ocr = pdf.text, pdf.page_count, pdf.ocr_used
            except Exception as exc:
                log.warning("pdf extraction failed for %s: %s", att["filename"], exc)
        with db.transaction() as conn:
            db.execute(
                conn,
                """UPDATE attachment SET storage_key = %s, mime = %s, size_bytes = %s, page_count = %s,
                   extracted_text = %s, ocr_used = %s, checksum = %s WHERE id = %s""",
                (key, mime, len(data), page_count, text, ocr, sha256(data), att["id"]),
            )

    with db.transaction() as conn:
        # If the page had no body text (PDF-only notification), use the primary PDF's text as the document text.
        doc = _doc_meta(conn, doc_id)
        if not doc.get("extracted_text"):
            prim = db.fetch_one(
                conn,
                "SELECT extracted_text FROM attachment WHERE document_id = %s AND extracted_text IS NOT NULL ORDER BY is_primary DESC, id LIMIT 1",
                (doc_id,),
            )
            if prim:
                db.execute(conn, "UPDATE document SET extracted_text = %s WHERE id = %s", (prim["extracted_text"], doc_id))

        inst = db.fetch_one(conn, "SELECT id, slug FROM instrument WHERE official_url = %s", (doc["source_url"],))
        if doc["doc_type"] in MASTER_DIRECTION_TYPES or inst:
            # A Master Direction / Master Circular / consolidated SEBI Regulation is the regulator's own text:
            # it seeds and self-checks the instrument instead of being tagged as an amendment.
            if inst:
                enqueue(conn, "selfcheck_instrument", {"slug": inst["slug"], "document_id": doc_id})
            db.execute(conn, "UPDATE document SET tag_status = 'skipped', is_amending = false WHERE id = %s", (doc_id,))
        else:
            enqueue(conn, "tag_document", {"document_id": doc_id})


# ----------------------------------------------------------------------------- tag

def tag_document(doc_id: int) -> None:
    with db.transaction() as conn:
        doc = _doc_meta(conn, doc_id)
        text = _doc_full_text(conn, doc)
        instruments = db.fetch_all(conn, "SELECT id, slug, title, kind FROM instrument ORDER BY id")

    if not text:
        with db.transaction() as conn:
            db.execute(conn, "UPDATE document SET tag_status = 'skipped' WHERE id = %s", (doc_id,))
        teams.notify_new_document(doc, [], settings.site_url)
        return

    if not settings.ai_enabled:
        _tag_document_by_rules(doc, text, instruments)
        return

    meta = {k: doc.get(k) for k in ("doc_type", "number", "date_issued", "title", "source_url")}
    stage1 = ai.tag_instruments(meta, text, instruments)
    by_slug = {i["slug"]: i for i in instruments}
    tag_names: list[str] = []
    effective = _parse_iso(stage1.get("effective_date"))

    with db.transaction() as conn:
        db.execute(
            conn,
            "UPDATE document SET is_amending = %s, date_effective = COALESCE(date_effective, %s) WHERE id = %s",
            (bool(stage1["is_amending"]), effective, doc_id),
        )
        for t in stage1["instruments"]:
            inst = by_slug.get(t["slug"])
            if not inst:
                continue
            db.execute(
                conn,
                """INSERT INTO document_tag (document_id, instrument_id, provision_id, relation, confidence)
                   VALUES (%s, %s, NULL, %s, %s) ON CONFLICT DO NOTHING""",
                (doc_id, inst["id"], t["relation"], t["confidence"]),
            )
            tag_names.append(f"{inst['title']} ({t['relation']})")

    # Stage 2: provisions affected in each amended instrument.
    amended = [t for t in stage1["instruments"] if t["relation"] in ("amends", "supersedes") and t["slug"] in by_slug]
    for t in amended:
        inst = by_slug[t["slug"]]
        with db.transaction() as conn:
            provisions = db.fetch_all(
                conn,
                """SELECT p.id, p.number, p.heading, left(v.text, 120) AS first_words
                   FROM provision p LEFT JOIN provision_version v ON v.provision_id = p.id AND v.effective_to IS NULL
                   WHERE p.instrument_id = %s ORDER BY p.sort_key""",
                (inst["id"],),
            )
        if not provisions:
            log.info("instrument %s not seeded yet; tagging at instrument level only", inst["slug"])
            continue
        stage2 = ai.tag_effects(meta, text, inst, provisions)
        by_number = {p["number"]: p for p in provisions}
        with db.transaction() as conn:
            for e in stage2["effects"]:
                prov = by_number.get(e["provision_number"])
                if prov is None and e["change_type"] == "insert":
                    prov = _create_provision(conn, inst["id"], e["provision_number"])
                if prov is None:
                    # provision number not found: record it as a cannot_apply on a placeholder provision
                    prov = _create_provision(conn, inst["id"], e["provision_number"])
                    db.execute(
                        conn,
                        """INSERT INTO amendment_effect (document_id, provision_id, change_type, confidence, ai_note)
                           VALUES (%s, %s, 'cannot_apply', %s, %s)""",
                        (doc_id, prov["id"], e["confidence"], f"Provision number not in index. Instruction: {e['amending_text'][:2000]}"),
                    )
                    continue
                db.execute(
                    conn,
                    """INSERT INTO amendment_effect (document_id, provision_id, change_type, confidence, ai_note)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (doc_id, prov["id"], e["change_type"], e["confidence"], e["amending_text"]),
                )
                db.execute(
                    conn,
                    """INSERT INTO document_tag (document_id, instrument_id, provision_id, relation, confidence)
                       VALUES (%s, %s, %s, 'amends', %s) ON CONFLICT DO NOTHING""",
                    (doc_id, inst["id"], prov["id"], e["confidence"]),
                )

    with db.transaction() as conn:
        db.execute(conn, "UPDATE document SET tag_status = 'tagged' WHERE id = %s", (doc_id,))
        if amended:
            enqueue(conn, "merge_document", {"document_id": doc_id})
        else:
            db.execute(conn, "UPDATE document SET tag_status = 'merged' WHERE id = %s", (doc_id,))
    ok = teams.notify_new_document(doc, tag_names, settings.site_url)
    with db.transaction() as conn:
        db.execute(conn, "INSERT INTO notification_log (channel, document_id, ok) VALUES ('teams', %s, %s)", (doc_id, ok))


def _tag_document_by_rules(doc: dict, text: str, instruments: list[dict]) -> None:
    """Zero-cost tagging from the document's own wording (see rules.py). Records tags and effects; never merges text."""
    doc_id = doc["id"]
    result = rules.tag(
        {
            "doc_type": doc["doc_type"],
            "title": doc["title"],
            "number": doc.get("number"),
            "source_url": doc.get("source_url"),
            "regulator_code": doc.get("regulator_code"),
            "source_adapter": doc.get("source_adapter", ""),
            "source_url": doc.get("source_url", ""),
        },
        text,
        [dict(i) for i in instruments],
    )
    tag_names: list[str] = []
    with db.transaction() as conn:
        by_slug = {i["slug"]: i for i in db.fetch_all(conn, "SELECT id, slug, title, kind FROM instrument")}
        for ni in result.new_instruments:
            if ni.slug in by_slug:
                continue
            reg_id = db.regulator_id(conn, ni.regulator)
            row = db.fetch_one(
                conn,
                """INSERT INTO instrument (regulator_id, slug, short_code, title, kind, official_url)
                   VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (slug) DO UPDATE SET official_url = COALESCE(instrument.official_url, EXCLUDED.official_url)
                   RETURNING id, slug, title, kind""",
                (reg_id, ni.slug, ni.slug.upper()[:24], ni.title, ni.kind, doc["source_url"] if ni.official_document else None),
            )
            by_slug[ni.slug] = row
            if ni.official_document:
                enqueue(conn, "selfcheck_instrument", {"slug": ni.slug, "document_id": doc_id})
        # An original regulations notification for an instrument that already exists but has no text yet.
        for slug, relation in result.tags:
            inst = by_slug.get(slug)
            if inst and relation in ("supersedes", "references") and inst["kind"] in ("regulations", "rules"):
                cur = db.fetch_one(conn, "SELECT official_url, seeded_at FROM instrument WHERE id = %s", (inst["id"],))
                if cur and cur["official_url"] is None and not re.search(r"\bAmendment\b", doc["title"] or "", re.I):
                    db.execute(conn, "UPDATE instrument SET official_url = %s WHERE id = %s", (doc["source_url"], inst["id"]))
                    enqueue(conn, "selfcheck_instrument", {"slug": slug, "document_id": doc_id})

        for slug, relation in result.tags:
            inst = by_slug.get(slug)
            if not inst:
                continue
            db.execute(
                conn,
                """INSERT INTO document_tag (document_id, instrument_id, provision_id, relation, confidence)
                   VALUES (%s, %s, NULL, %s, 1.0) ON CONFLICT DO NOTHING""",
                (doc_id, inst["id"], relation),
            )
            tag_names.append(f"{inst['title']} ({relation})")

        for e in result.effects:
            inst = by_slug.get(e.instrument_slug)
            if not inst:
                continue
            prov = db.fetch_one(
                conn,
                "SELECT id, number FROM provision WHERE instrument_id = %s AND (number = %s OR number LIKE %s) ORDER BY sort_key LIMIT 1",
                (inst["id"], e.provision_number, f"{e.provision_number} (%"),
            ) or _create_provision(conn, inst["id"], e.provision_number)
            db.execute(
                conn,
                """INSERT INTO amendment_effect (document_id, provision_id, change_type, confidence, ai_note)
                   VALUES (%s, %s, %s, 1.0, %s)""",
                (doc_id, prov["id"], e.change_type, e.excerpt),
            )
            db.execute(
                conn,
                """INSERT INTO document_tag (document_id, instrument_id, provision_id, relation, confidence)
                   VALUES (%s, %s, %s, 'amends', 1.0) ON CONFLICT DO NOTHING""",
                (doc_id, inst["id"], prov["id"]),
            )
        db.execute(
            conn,
            "UPDATE document SET is_amending = %s, tag_status = 'tagged' WHERE id = %s",
            (result.is_amending, doc_id),
        )
    ok = teams.notify_new_document(doc, tag_names, settings.site_url)
    with db.transaction() as conn:
        db.execute(conn, "INSERT INTO notification_log (channel, document_id, ok) VALUES ('teams', %s, %s)", (doc_id, ok))


def _create_provision(conn: psycopg.Connection, instrument_id: int, number: str) -> dict:
    row = db.fetch_one(conn, "SELECT id, number FROM provision WHERE instrument_id = %s AND number = %s", (instrument_id, number))
    if row:
        return row
    mx = db.fetch_one(conn, "SELECT coalesce(max(sort_key), 0) AS m FROM provision WHERE instrument_id = %s", (instrument_id,))
    parent = None
    if "." in number:
        parent = db.fetch_one(
            conn, "SELECT id FROM provision WHERE instrument_id = %s AND number = %s", (instrument_id, number.rsplit(".", 1)[0])
        )
    return db.fetch_one(
        conn,
        """INSERT INTO provision (instrument_id, parent_id, number, level, sort_key)
           VALUES (%s, %s, %s, 'para', %s) RETURNING id, number""",
        (instrument_id, parent["id"] if parent else None, number, mx["m"] + 1),
    )


def _parse_iso(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


# ----------------------------------------------------------------------------- merge

def merge_document(doc_id: int) -> None:
    with db.transaction() as conn:
        doc = _doc_meta(conn, doc_id)
        effects = db.fetch_all(
            conn,
            """SELECT e.*, p.number, p.instrument_id FROM amendment_effect e JOIN provision p ON p.id = e.provision_id
               WHERE e.document_id = %s AND e.new_version_id IS NULL AND e.change_type <> 'cannot_apply' ORDER BY e.id""",
            (doc_id,),
        )
    meta = {k: doc.get(k) for k in ("doc_type", "number", "date_issued", "title", "date_effective")}
    effective = doc.get("date_effective") or doc.get("date_issued")

    for e in effects:
        with db.transaction() as conn:
            current = db.fetch_one(
                conn,
                "SELECT id, text FROM provision_version WHERE provision_id = %s AND effective_to IS NULL ORDER BY id DESC LIMIT 1",
                (e["provision_id"],),
            )
        try:
            result = ai.merge_provision(
                provision_number=e["number"],
                current_text=current["text"] if current else "",
                change_type=e["change_type"],
                amending_text=e["ai_note"] or "",
                doc_meta=meta,
            )
        except Exception as exc:
            log.exception("merge failed for effect %s", e["id"])
            with db.transaction() as conn:
                db.execute(
                    conn,
                    "UPDATE amendment_effect SET change_type = 'cannot_apply', ai_note = %s WHERE id = %s",
                    (f"Merge error: {exc}. Instruction: {(e['ai_note'] or '')[:2000]}", e["id"]),
                )
            continue

        with db.transaction() as conn:
            if result.status != "applied":
                db.execute(
                    conn,
                    "UPDATE amendment_effect SET change_type = 'cannot_apply', confidence = %s, ai_note = %s WHERE id = %s",
                    (result.confidence, f"{result.note} | Instruction: {(e['ai_note'] or '')[:2000]}", e["id"]),
                )
                continue
            new_text = result.new_text if result.new_text else f"{e['number']}. [Omitted] {result.footnote}".strip()
            if current:
                db.execute(conn, "UPDATE provision_version SET effective_to = %s WHERE id = %s", (effective, current["id"]))
            new_v = db.fetch_one(
                conn,
                """INSERT INTO provision_version (provision_id, text, effective_from, source_kind, created_by_document_id, merge_confidence, footnote)
                   VALUES (%s, %s, %s, 'machine_merged', %s, %s, %s) RETURNING id""",
                (e["provision_id"], new_text, effective, doc_id, result.confidence, result.footnote),
            )
            db.execute(
                conn,
                "UPDATE amendment_effect SET old_version_id = %s, new_version_id = %s, confidence = %s, ai_note = %s WHERE id = %s",
                (current["id"] if current else None, new_v["id"], result.confidence, result.note, e["id"]),
            )

    with db.transaction() as conn:
        db.execute(conn, "UPDATE document SET tag_status = 'merged' WHERE id = %s", (doc_id,))


# ----------------------------------------------------------------------------- seed / self-check

def _norm(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip().lower()
    return re.sub(r"[‘’“”\"']", "", text)


def seed_or_selfcheck_instrument(slug: str, *, document_id: int | None = None) -> dict[str, int]:
    """Pull the regulator's consolidated text and make it the canonical version of every provision.

    First run: seeds provisions. Later runs: official text overrules machine merges and flags discrepancies.
    """
    with db.transaction() as conn:
        inst = db.fetch_one(
            conn, "SELECT i.*, r.code AS regulator_code FROM instrument i JOIN regulator r ON r.id = i.regulator_id WHERE slug = %s", (slug,)
        )
    if not inst:
        raise LookupError(slug)
    cfg = _seed_config(slug)
    if cfg is None and inst["regulator_code"] == "SEBI" and inst.get("official_url"):
        # Auto-registered from the SEBI Legal listing. Everything SEBI publishes there is a PDF whose layout
        # interleaves body text with per-page footnotes, so serve the official file and index its pages rather
        # than parse sections out of it.
        cfg = {"adapter": "sebi", "style": "sebi", "pdf_only": True}
    if cfg is None and inst["kind"] == "master_direction":
        cfg = {"adapter": "rbi_master_directions", "style": "master_direction"}
    if cfg is None and inst["kind"] in ("regulations", "rules") and inst.get("official_url"):
        cfg = {"adapter": "document_text", "style": "regulations"}
    if cfg is None:
        raise RuntimeError(f"no seed source configured for {slug}")
    official = official_text_for(inst, cfg)
    # Seeders return either a SeedResult (with the regulator's own PDF) or the older 3-tuple.
    if isinstance(official, SeedResult):
        text = official.provisions if official.provisions is not None else official.text
        updated_as_on, source_url = official.updated_as_on, official.source_url
        pdf_bytes, pdf_url = official.pdf_bytes, official.pdf_url
    else:
        text, updated_as_on, source_url = official
        pdf_bytes, pdf_url = None, None
    if isinstance(text, list):
        # Source already supplies the text section by section (e.g. the Income Tax portal's section API).
        parsed = [p for p in text if p.text.strip()]
    else:
        parsed = [p for p in split_provisions(text, style=cfg.get("style", "auto")) if p.text.strip()]
    # Some official texts exist only as a PDF whose layout interleaves body text with per-page footnotes.
    # Parsing those into sections put text under the wrong provision, so they are served as the official PDF
    # with a page index instead: nothing is invented, and a search still lands on the right page.
    pdf_only = bool(cfg.get("pdf_only"))

    # Quality gate. A parse that leaves many provisions empty means the source's layout defeated the parser
    # (footnote columns, multi-column gazette pages). Publishing that shows a reader a section with nothing in
    # it, so fall back to the regulator's own PDF, which is what they would cite anyway.
    body = [p for p in parsed if p.level != "chapter"]
    empty = sum(1 for p in body if len(p.text.strip()) < 40)
    if body and empty / len(body) > EMPTY_PROVISION_LIMIT:
        if pdf_bytes:
            log.warning(
                "%s: %d of %d provisions parsed empty; serving the official PDF instead",
                slug, empty, len(body),
            )
            pdf_only = True
        else:
            log.warning("%s: %d of %d provisions parsed empty and no official PDF is available", slug, empty, len(body))

    if not pdf_only and len(parsed) < 3:
        raise RuntimeError(f"official text for {slug} parsed into only {len(parsed)} provisions; refusing to overwrite")

    if pdf_only:
        if not pdf_bytes:
            raise RuntimeError(f"{slug} is configured as PDF-only but no official PDF was returned")
        key, pages = _store_official_pdf(inst, pdf_bytes, pdf_url or source_url, [])
        with db.transaction() as conn:
            # Any provisions parsed out of this PDF earlier were unreliable (its layout interleaves body text
            # with per-page footnotes). Remove them rather than leave text filed under the wrong provision.
            # Their provision-level tags go first: without provisions they would all collapse onto the
            # instrument and collide with each other.
            db.execute(
                conn,
                """DELETE FROM document_tag WHERE provision_id IN (SELECT id FROM provision WHERE instrument_id = %s)""",
                (inst["id"],),
            )
            db.execute(
                conn,
                """DELETE FROM amendment_effect WHERE provision_id IN (SELECT id FROM provision WHERE instrument_id = %s)""",
                (inst["id"],),
            )
            removed = db.execute(conn, "DELETE FROM provision WHERE instrument_id = %s", (inst["id"],))
            if removed:
                log.info("%s: removed %d provisions that had been parsed from the PDF", slug, removed)
            db.execute(
                conn,
                "UPDATE instrument SET pdf_only = true, official_updated_as_on = COALESCE(%s, official_updated_as_on),"
                " seeded_at = COALESCE(seeded_at, now()), last_checked_at = now(),"
                " official_url = COALESCE(%s, official_url) WHERE id = %s",
                (updated_as_on, source_url, inst["id"]),
            )
        return {"pdf_pages": pages or 0, "provisions": 0, "mode": "official pdf"}

    # Keep the regulator's own PDF and work out which page each provision starts on, so the site can open the
    # official document at the right place rather than asking anyone to trust our transcription.
    pdf_key = pdf_pages = None
    if pdf_bytes:
        pdf_key, pdf_pages = _store_official_pdf(inst, pdf_bytes, pdf_url or source_url, parsed)

    stats = {"inserted": 0, "unchanged": 0, "replaced_machine": 0, "differs_from_official": 0, "updated_official": 0}
    with db.transaction() as conn:
        number_to_id: dict[str, int] = {}
        for i, p in enumerate(parsed):
            parent_id = number_to_id.get(p.parent_number) if p.parent_number else None
            row = db.fetch_one(
                conn,
                """INSERT INTO provision (instrument_id, parent_id, number, heading, level, sort_key)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (instrument_id, number) DO UPDATE SET heading = COALESCE(EXCLUDED.heading, provision.heading),
                     sort_key = EXCLUDED.sort_key, parent_id = COALESCE(EXCLUDED.parent_id, provision.parent_id)
                   RETURNING id""",
                (inst["id"], parent_id, p.number, p.heading, p.level, i),
            )
            number_to_id[p.number] = row["id"]
            # Where this provision can be read in the regulator's own file.
            if getattr(p, "source_url", None) or getattr(p, "pdf_page", None) or pdf_key:
                db.execute(
                    conn,
                    """UPDATE provision SET source_url = COALESCE(%s, source_url),
                           pdf_page = COALESCE(%s, pdf_page), pdf_storage_key = COALESCE(%s, pdf_storage_key)
                       WHERE id = %s""",
                    (
                        getattr(p, "source_url", None),
                        getattr(p, "pdf_page", None),
                        pdf_key if getattr(p, "pdf_page", None) else None,
                        row["id"],
                    ),
                )
            full_text = p.text + ("\n\n" + "\n".join(p.footnotes) if p.footnotes else "")
            official_html = getattr(p, "html", None)
            current = db.fetch_one(
                conn,
                "SELECT id, text, html, source_kind, effective_from FROM provision_version WHERE provision_id = %s AND effective_to IS NULL ORDER BY id DESC LIMIT 1",
                (row["id"],),
            )
            if current is None:
                db.execute(
                    conn,
                    """INSERT INTO provision_version (provision_id, text, html, effective_from, source_kind, created_by_document_id)
                       VALUES (%s, %s, %s, %s, 'official', %s)""",
                    (row["id"], full_text, official_html, updated_as_on, document_id),
                )
                stats["inserted"] += 1
                continue
            if _norm(current["text"]) == _norm(full_text):
                stats["unchanged"] += 1
                # Backfill the official markup onto a version stored before we kept it.
                if official_html and not current.get("html"):
                    db.execute(conn, "UPDATE provision_version SET html = %s WHERE id = %s", (official_html, current["id"]))
                if current["source_kind"] == "machine_merged":
                    db.execute(
                        conn,
                        "UPDATE amendment_effect SET verification_status = 'matches_official' WHERE new_version_id = %s",
                        (current["id"],),
                    )
                continue
            # Same official publication, re-read: our extraction improved, the law did not change. Refresh the
            # stored version in place instead of inventing an amendment in the timeline.
            same_publication = (
                current["source_kind"] == "official"
                and current.get("effective_from") is not None
                and updated_as_on is not None
                and current["effective_from"] == updated_as_on
            )
            if same_publication:
                db.execute(
                    conn,
                    "UPDATE provision_version SET text = %s, html = COALESCE(%s, html) WHERE id = %s",
                    (full_text, official_html, current["id"]),
                )
                stats["refreshed"] = stats.get("refreshed", 0) + 1
                continue
            # Text differs and the regulator republished: official wins, as a new version.
            db.execute(conn, "UPDATE provision_version SET effective_to = %s WHERE id = %s", (updated_as_on, current["id"]))
            db.execute(
                conn,
                """INSERT INTO provision_version (provision_id, text, html, effective_from, source_kind, created_by_document_id, footnote)
                   VALUES (%s, %s, %s, %s, 'official', %s, %s)""",
                (row["id"], full_text, official_html, updated_as_on, document_id, f"Official consolidated text as on {updated_as_on}"),
            )
            if current["source_kind"] == "machine_merged":
                stats["replaced_machine"] += 1
                ratio = difflib.SequenceMatcher(None, _norm(current["text"]), _norm(full_text)).ratio()
                if ratio < 0.97:
                    stats["differs_from_official"] += 1
                    db.execute(
                        conn,
                        "UPDATE amendment_effect SET verification_status = 'differs_from_official' WHERE new_version_id = %s",
                        (current["id"],),
                    )
                    teams.notify_discrepancy(inst["title"], p.number, settings.site_url, f"/browse/{slug}/{_slugify(p.number)}/history")
                else:
                    db.execute(
                        conn,
                        "UPDATE amendment_effect SET verification_status = 'matches_official' WHERE new_version_id = %s",
                        (current["id"],),
                    )
            else:
                stats["updated_official"] += 1
        db.execute(
            conn,
            "UPDATE instrument SET official_updated_as_on = %s, seeded_at = COALESCE(seeded_at, now()),"
            " last_checked_at = now(), official_url = COALESCE(%s, official_url) WHERE id = %s",
            (updated_as_on, source_url, inst["id"]),
        )
    log.info("seed/selfcheck %s: %s", slug, stats)
    return stats


def _slugify(number: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", number).strip("-").lower()


# ----------------------------------------------------------------------------- section map

def _split_map_title(value: str | None) -> tuple[str, str]:
    """CBDT writes '80C - Deduction ...' for Act rows and '3AC : Audit report ...' for rules and forms."""
    text = (value or "").strip()
    m = re.match(r"^(?P<num>[^:\-]{1,40}?)\s*[:–—-]\s+(?P<title>.*)$", text, re.S)
    if not m:
        return text, ""
    return m.group("num").strip(), m.group("title").strip()


def load_section_map() -> dict[str, int]:
    """Load CBDT's official Income-tax Act 1961 <-> 2025 provision mapping."""
    from .adapters import cbdt

    rows = cbdt.section_map()
    inserted = 0
    with db.transaction() as conn:
        db.execute(conn, "DELETE FROM section_map WHERE map_key = 'income-tax'")
        for i, r in enumerate(rows):
            old_num, old_title = _split_map_title(r["old_title"])
            new_num, new_title = _split_map_title(r["new_title"])
            # The portal marks "no counterpart" with a run of dashes.
            old_num = "" if set(old_num.strip()) <= {"-"} else old_num.strip()
            new_num = "" if set(new_num.strip()) <= {"-"} else new_num.strip()
            raw = (r.get("entity_type") or "").strip().lower()
            entity = {"acts": "section", "act": "section", "rules": "rule", "forms": "form"}.get(raw, raw or "section")
            is_rule = entity in ("rule", "form")
            db.execute(
                conn,
                """INSERT INTO section_map (map_key, old_instrument, new_instrument, old_number, old_title,
                                            new_number, new_title, entity_type, sort_order, source_url)
                   VALUES ('income-tax', %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT DO NOTHING""",
                (
                    "itr-1962" if is_rule else "ita-1961",
                    "itr-2026" if is_rule else "ita-2025",
                    old_num or None,
                    old_title.strip() or None,
                    new_num or None,
                    new_title.strip() or None,
                    entity,
                    r.get("old_priority") or i,
                    "https://www.incometaxindia.gov.in/income-tax-act-202511",
                ),
            )
            inserted += 1
    log.info("section map loaded: %d rows", inserted)
    return {"rows": inserted}


# ----------------------------------------------------------------------------- prune

def compact_duplicated_text(*, apply: bool = False, full: bool = False) -> dict[str, Any]:
    """Reclaim Neon space held by text stored twice, or stored and never read back.

    Two candidates, neither of which costs the site anything it serves:

      * `attachment.extracted_text` that is byte-identical to its document's own `extracted_text`. The document
        copy is the one that matters — `document_fts_idx` indexes it, and `_document_text` already skips an
        attachment whose text it has already seen. Both read paths that fall back to the attachment
        (`adapters/__init__.py`, the backfill below) only fire when the document has *no* text, which by
        definition is not the case here. The PDF stays in R2, so the column can be rebuilt by re-extracting.
      * `document.raw_html`, which every adapter writes and nothing anywhere reads back.

    Dry by default; pass apply=True to clear them. Postgres marks the old rows dead rather than handing the
    space back, so a plain VACUUM follows: that makes the space reusable and stops the database growing into
    new storage, but the size the free-tier check reads barely moves — clearing 103 MB this way took the
    database from 341.97 MB only to 338.33 MB, because `document` grew by the new row versions as fast as
    `attachment` shrank. Pass full=True to rewrite the tables as well and hand the space back; that took the
    same database to 170.76 MB. See `_vacuum_full` for why it locks and why the order matters.
    """
    with db.transaction() as conn:
        dup = db.fetch_one(
            conn,
            """SELECT count(*) AS rows, coalesce(sum(pg_column_size(a.extracted_text)), 0)::bigint AS bytes
                 FROM attachment a JOIN document d ON d.id = a.document_id
                WHERE a.extracted_text IS NOT NULL AND a.extracted_text = d.extracted_text""",
        )
        html = db.fetch_one(
            conn,
            """SELECT count(*) AS rows, coalesce(sum(pg_column_size(raw_html)), 0)::bigint AS bytes
                 FROM document WHERE raw_html IS NOT NULL AND extracted_text IS NOT NULL""",
        )
    out: dict[str, Any] = {
        "duplicate_attachment_text": {"rows": dup["rows"], "bytes": int(dup["bytes"])},
        "unread_raw_html": {"rows": html["rows"], "bytes": int(html["bytes"])},
        "reclaimable_bytes": int(dup["bytes"]) + int(html["bytes"]),
        "applied": apply,
    }
    if not apply:
        return out

    with db.transaction() as conn:
        out["attachments_cleared"] = db.execute(
            conn,
            """UPDATE attachment a SET extracted_text = NULL FROM document d
                WHERE d.id = a.document_id AND a.extracted_text IS NOT NULL
                  AND a.extracted_text = d.extracted_text""",
        )
        out["raw_html_cleared"] = db.execute(
            conn,
            "UPDATE document SET raw_html = NULL WHERE raw_html IS NOT NULL AND extracted_text IS NOT NULL",
        )
    # VACUUM cannot run inside a transaction block, so it needs its own autocommit connection.
    conn = db.connect()
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            for table in VACUUM_ORDER:
                cur.execute(f"VACUUM (ANALYZE) {table}")
            if full:
                out["rewritten"] = _vacuum_full(cur)
            cur.execute("SELECT pg_database_size(current_database())::bigint AS n")
            out["database_bytes"] = int(cur.fetchone()["n"])
    finally:
        conn.close()
    log.info("compacted %s attachment rows and %s raw_html rows", out["attachments_cleared"], out["raw_html_cleared"])
    return out


# Smallest-but-most-bloated first. VACUUM FULL rewrites a table, so it needs free space worth a second copy of
# it; rewriting `attachment` first releases enough room for `document`, which is the one that will not fit
# otherwise. Doing it in the other order stalls at the largest table with nowhere to put the copy.
VACUUM_ORDER = ("attachment", "document", "instrument_page", "provision_version")


def _vacuum_full(cur) -> list[str]:
    """Rewrite each table so freed space goes back to the file, skipping any that will not fit.

    Plain VACUUM only marks space reusable, so the size the free-tier check reads does not move until this runs.
    The lock is ACCESS EXCLUSIVE — reads and writes on that table stall for the rewrite — so this is opt-in, and
    must not run while discovery is writing.
    """
    from .storage.usage import NEON_FREE_BYTES

    done = []
    for table in VACUUM_ORDER:
        cur.execute("SELECT pg_database_size(current_database())::bigint AS db, pg_total_relation_size(%s)::bigint AS t", (table,))
        row = cur.fetchone()
        headroom = NEON_FREE_BYTES - int(row["db"])
        if headroom < int(row["t"]):
            log.warning("skipping VACUUM FULL %s: needs %.0f MB for the rewrite, only %.0f MB free",
                        table, int(row["t"]) / 1024**2, headroom / 1024**2)
            continue
        cur.execute(f"VACUUM FULL {table}")
        done.append(table)
    return done


# What a regulator's bot wall looks like once a PDF reader has been pointed at it. RBI sits behind Imperva,
# which answers a blocked request with an HTML interstitial; saved under a .pdf name it is indistinguishable
# from a document until you read it.
_BOT_WALL = re.compile(r"enable JavaScript to view the page|support ID is|Incapsula|Request unsuccessful", re.I)


def _is_bot_wall(pages: list[str]) -> bool:
    """True when the 'document' is really an anti-bot page. Short and unmistakable, so one page is enough."""
    if len(pages) > 2:
        return False
    return bool(pages) and bool(_BOT_WALL.search(" ".join(pages)[:2000]))


def ocr_backlog(*, minutes: float = 20.0) -> dict[str, Any]:
    """Read the scanned PDFs that carry no text layer, until the time budget runs out.

    Bounded by wall clock rather than count, because OCR cost is per page and the backlog is wildly uneven:
    284 documents, but 76 SEBI master circulars average 166 pages each while most others are under five. A
    count-based limit would make one run take a minute and the next take hours.

    Resumable by construction. `ocr_used` is set on every attachment we attempt, whether or not the attempt
    yielded anything, so a document is never read twice and closing the laptop costs at most the file in
    flight. Smallest first, so the number of *documents* that become searchable climbs as fast as possible.
    """
    import time as _time

    store = storage()
    deadline = _time.monotonic() + minutes * 60
    done = pages = chars = failed = 0
    while _time.monotonic() < deadline:
        with db.transaction() as conn:
            row = db.fetch_one(
                conn,
                """SELECT a.id, a.document_id, a.storage_key, a.page_count
                     FROM attachment a JOIN document d ON d.id = a.document_id
                    WHERE a.storage_key IS NOT NULL AND a.ocr_used IS NOT TRUE
                      AND coalesce(a.page_count, 0) > 0
                      AND coalesce(length(a.extracted_text), 0) < 200
                      AND coalesce(length(d.extracted_text), 0) < 200
                    ORDER BY a.page_count, a.id LIMIT 1""",
            )
        if not row:
            break
        try:
            extracted = extract_pdf_text(store.get(row["storage_key"]))
            text = extracted.text
        except Exception as exc:
            log.warning("OCR failed for attachment %s: %s", row["id"], str(exc)[:120])
            text, failed = "", failed + 1
        with db.transaction() as conn:
            # ocr_used is set even when nothing came back: the attempt is the fact worth recording, otherwise
            # an unreadable scan is retried on every run for ever.
            db.execute(
                conn,
                "UPDATE attachment SET extracted_text = %s, ocr_used = true WHERE id = %s",
                (text or None, row["id"]),
            )
            if text:
                db.execute(
                    conn,
                    """UPDATE document SET extracted_text = %s
                        WHERE id = %s AND coalesce(length(extracted_text), 0) < 200""",
                    (text, row["document_id"]),
                )
        done += 1
        pages += row["page_count"] or 0
        chars += len(text)
    with db.transaction() as conn:
        left = db.fetch_one(
            conn,
            """SELECT count(*) AS n, coalesce(sum(a.page_count), 0) AS pages
                 FROM attachment a JOIN document d ON d.id = a.document_id
                WHERE a.storage_key IS NOT NULL AND a.ocr_used IS NOT TRUE
                  AND coalesce(a.page_count, 0) > 0
                  AND coalesce(length(a.extracted_text), 0) < 200
                  AND coalesce(length(d.extracted_text), 0) < 200""",
        )
    log.info("ocr: %d documents, %d pages, %d characters, %d failed", done, pages, chars, failed)
    return {"documents": done, "pages": pages, "characters": chars, "failed": failed,
            "remaining": left["n"], "remaining_pages": int(left["pages"])}


def requeue_missing_attachments(limit: int = 2000) -> int:
    """Queue a re-fetch for every document that has an attachment with no stored file.

    Clearing a bad file is not enough on its own: the document's fetch job is already marked done, so nothing
    would ever look at it again. This is what turns "we know that file is wrong" into "fetch it again", and it
    is the follow-up to any bulk reset -- such as discarding the 545 anti-bot pages that were stored as PDFs.
    """
    with db.transaction() as conn:
        docs = db.fetch_all(
            conn,
            """SELECT DISTINCT a.document_id AS id FROM attachment a
                WHERE a.storage_key IS NULL
                  AND NOT EXISTS (SELECT 1 FROM job j
                                   WHERE j.type = 'fetch_document' AND j.status IN ('pending', 'running')
                                     AND (j.payload->>'document_id')::int = a.document_id)
                ORDER BY a.document_id LIMIT %s""",
            (limit,),
        )
        for d in docs:
            enqueue(conn, "fetch_document", {"document_id": d["id"]})
    log.info("re-queued %d documents whose attachments are missing", len(docs))
    return len(docs)


def index_attachment_pages(limit: int = 500) -> dict[str, int]:
    """Write per-page text for stored PDFs to object storage, so a reader can search inside one.

    The page text goes to R2 rather than the database on purpose: 89,280 pages is roughly 270 MB, and Neon's
    free plan stops accepting writes at 500 MB -- it is already at 36%. R2 has 10 GB and is at 34%.

    Resumable and idempotent: an attachment is picked up only while `page_index_key` is null, and the key is
    written last, so a crash mid-run costs one file rather than the batch. Safe to run repeatedly.
    """
    from .parsers import pdfmap

    store = storage()
    try:
        with db.transaction() as conn:
            pending = db.fetch_all(
                conn,
                """SELECT id, storage_key, filename FROM attachment
                    WHERE storage_key IS NOT NULL AND page_index_key IS NULL
                    ORDER BY id LIMIT %s""",
                (limit,),
            )
    except Exception as exc:
        # This machine's connection to Neon drops intermittently (see docs/HANDOFF.md). Losing the batch to a
        # blip is fine -- every file already indexed is recorded, so the next run resumes -- but crashing the
        # whole command is not, because it sits in a scheduled script alongside other work.
        log.warning("page index could not reach the database: %s", str(exc).splitlines()[0][:140])
        return {"indexed": 0, "pages": 0, "skipped": 0, "blocked": 0, "remaining_in_batch": 0}
    done = pages_written = skipped = blocked = 0
    for att in pending:
        key = att["storage_key"]
        if not key.lower().endswith(".pdf") and not (att["filename"] or "").lower().endswith(".pdf"):
            # Not a PDF, so there are no pages to land on. Mark it rather than reconsider it every run.
            with db.transaction() as conn:
                db.execute(conn, "UPDATE attachment SET page_index_key = '' WHERE id = %s", (att["id"],))
            skipped += 1
            continue
        try:
            data = store.get(key)
            index = pdfmap.build_index(data)
        except Exception as exc:
            log.warning("page index failed for attachment %s (%s): %s", att["id"], key, str(exc)[:120])
            continue
        if _is_bot_wall(index.pages):
            # What we stored is the regulator's anti-bot interstitial, not the document: the fetch was blocked
            # and the block page was saved under a .pdf name. Indexing it would make a page of "please enable
            # JavaScript" searchable and look like success. Record it as unfetched so it is re-downloaded.
            with db.transaction() as conn:
                db.execute(
                    conn,
                    "UPDATE attachment SET storage_key = NULL, extracted_text = NULL, page_count = NULL WHERE id = %s",
                    (att["id"],),
                )
            blocked += 1
            continue
        payload = json.dumps({"pages": index.pages}, ensure_ascii=False).encode("utf-8")
        out_key = f"pageindex/{key}.json"
        try:
            store.put(out_key, payload, "application/json")
        except Exception as exc:
            log.warning("could not store page index for attachment %s: %s", att["id"], str(exc)[:120])
            continue
        with db.transaction() as conn:
            db.execute(conn, "UPDATE attachment SET page_index_key = %s WHERE id = %s", (out_key, att["id"]))
        done += 1
        pages_written += index.page_count
    log.info("page index: %d files, %d pages, %d skipped, %d bot-walls re-queued", done, pages_written, skipped, blocked)
    return {"indexed": done, "pages": pages_written, "skipped": skipped, "blocked": blocked, "remaining_in_batch": len(pending)}


# Retention only ever runs when space is genuinely short. Below the trigger it reports and stops, because
# deleting an official record that a regulator later removes from its own site is not recoverable, and there
# is no reason to pay that risk while there is room.
RETENTION_TRIGGER = 0.70
RETENTION_TARGET = 0.60
# Even under pressure, this many of the most recent documents per instrument are never touched.
RETENTION_KEEP_PER_INSTRUMENT = 200
# Never deletable, whatever the pressure: these are the texts the site is *for*, not traffic about them.
RETENTION_PROTECTED_TYPES = ("act", "rules", "regulations", "master_direction", "master_circular")


def retain_documents(*, apply: bool = False, force: bool = False) -> dict[str, Any]:
    """Drop the oldest ordinary circulars and notifications per instrument, once storage is genuinely tight.

    What is never deleted, in order of how much it would hurt:

      * base texts -- Acts, Rules, Regulations, Master Directions and Master Circulars. The site exists to
        serve these; a notification is a pointer to them.
      * anything an instrument names as its official text, which would blank that instrument's reading view.
      * anything tagged `is_amending`, because it is the evidence for an amendment already applied. Deleting
        it would leave a provision whose history cites a document nobody can open.
      * the most recent `RETENTION_KEEP_PER_INSTRUMENT` documents of every instrument, so no instrument is
        ever reduced to a thin recent slice.

    Dry by default and idle by default: below `RETENTION_TRIGGER` it deletes nothing at all and says so. Pass
    force=True to evaluate the rule regardless, which is how to see what it *would* do while there is room.
    """
    from .storage.usage import check as usage_check

    usages = usage_check(notify=False)
    pressure = max((u.fraction for u in usages), default=0.0)
    out: dict[str, Any] = {
        "pressure": round(pressure, 4),
        "trigger": RETENTION_TRIGGER,
        "armed": pressure >= RETENTION_TRIGGER,
        "applied": False,
        "documents": 0,
        "files": 0,
    }
    if pressure < RETENTION_TRIGGER and not force:
        log.info("retention idle: %.0f%% used, trigger is %.0f%%", pressure * 100, RETENTION_TRIGGER * 100)
        return out

    with db.transaction() as conn:
        victims = db.fetch_all(
            conn,
            """
            WITH ranked AS (
              SELECT d.id, d.date_issued, t.instrument_id,
                     row_number() OVER (PARTITION BY t.instrument_id
                                        ORDER BY d.date_issued DESC NULLS LAST, d.id DESC) AS recency
                FROM document d
                JOIN document_tag t ON t.document_id = d.id
               WHERE d.is_amending IS NOT TRUE
                 AND d.doc_type <> ALL(%s)
                 -- A document whose date we failed to parse sorts as the oldest thing we hold and would be
                 -- deleted first, though it may have been published last week. Age we cannot establish is
                 -- not age: leave it alone.
                 AND d.date_issued IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM instrument i WHERE i.official_url = d.source_url)
            )
            SELECT DISTINCT id, date_issued FROM ranked WHERE recency > %s
             ORDER BY date_issued NULLS FIRST, id
            """,
            (list(RETENTION_PROTECTED_TYPES), RETENTION_KEEP_PER_INSTRUMENT),
        )
    out["candidates"] = len(victims)
    out["oldest"] = str(victims[0]["date_issued"]) if victims else None
    out["newest"] = str(victims[-1]["date_issued"]) if victims else None
    if not apply or not victims:
        return out

    ids = [v["id"] for v in victims]
    out["files"] = _delete_stored_files(ids)
    with db.transaction() as conn:
        db.execute(conn, "DELETE FROM job WHERE (payload->>'document_id')::int = ANY(%s)", (ids,))
        out["documents"] = db.execute(conn, "DELETE FROM document WHERE id = ANY(%s)", (ids,))
    out["applied"] = True
    log.info("retention removed %s documents and %s files", out["documents"], out["files"])
    return out


def _delete_stored_files(document_ids: list[int]) -> int:
    """Remove the R2 objects belonging to these documents. Shared by retention and the year-cutoff prune."""
    if not document_ids:
        return 0
    store = storage()
    with db.transaction() as conn:
        keys = [
            a["storage_key"]
            for a in db.fetch_all(
                conn,
                "SELECT storage_key FROM attachment WHERE document_id = ANY(%s) AND storage_key IS NOT NULL",
                (document_ids,),
            )
        ]
    removed = 0
    for i in range(0, len(keys), 1000):
        chunk = keys[i : i + 1000]
        try:
            if store.remote:
                store._s3.delete_objects(
                    Bucket=settings.r2_bucket, Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True}
                )
            else:
                for k in chunk:
                    (settings.local_storage_dir / k).unlink(missing_ok=True)
            removed += len(chunk)
        except Exception as exc:
            log.warning("could not delete a batch of files: %s", exc)
    return removed


def prune_before_cutoff() -> dict[str, int]:
    """Delete already-stored documents that fall before MIN_DOCUMENT_YEAR (same keep-rules as discovery),
    including their files in storage and any pending jobs."""
    if not settings.min_document_year:
        raise RuntimeError("MIN_DOCUMENT_YEAR is not set")
    with db.transaction() as conn:
        docs = db.fetch_all(conn, "SELECT id, doc_type, title, date_issued FROM document WHERE date_issued < %s", (date(settings.min_document_year, 1, 1),))
    victims = [d["id"] for d in docs if is_before_cutoff(d["doc_type"], d["title"], d["date_issued"])]
    store = storage()
    files = 0
    if victims:
        with db.transaction() as conn:
            keys = [a["storage_key"] for a in db.fetch_all(
                conn, "SELECT storage_key FROM attachment WHERE document_id = ANY(%s) AND storage_key IS NOT NULL", (victims,)
            )]
        for i in range(0, len(keys), 1000):
            chunk = keys[i:i + 1000]
            try:
                if store.remote:
                    store._s3.delete_objects(Bucket=settings.r2_bucket, Delete={"Objects": [{"Key": k} for k in chunk], "Quiet": True})
                else:
                    for k in chunk:
                        (settings.local_storage_dir / k).unlink(missing_ok=True)
                files += len(chunk)
            except Exception as exc:
                log.warning("could not delete a batch of files: %s", exc)
        with db.transaction() as conn:
            db.execute(conn, "DELETE FROM job WHERE (payload->>'document_id')::int = ANY(%s)", (victims,))
            db.execute(conn, "DELETE FROM document WHERE id = ANY(%s)", (victims,))  # cascades to attachments, tags, effects
    log.info("pruned %d documents and %d files before %d", len(victims), files, settings.min_document_year)
    return {"documents": len(victims), "files": files, "kept_base_texts": len(docs) - len(victims)}


# ----------------------------------------------------------------------------- digest

def send_daily_digest(day: date | None = None) -> bool:
    day = day or datetime.now(timezone.utc).date()
    since = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc) - timedelta(days=1)
    with db.transaction() as conn:
        new_docs = db.fetch_all(
            conn,
            """SELECT d.id, d.title, d.number, d.date_issued, r.code AS regulator_code FROM document d
               JOIN regulator r ON r.id = d.regulator_id WHERE d.first_seen_at >= %s ORDER BY d.date_issued DESC NULLS LAST""",
            (since,),
        )
        merges = db.fetch_all(
            conn,
            """SELECT e.change_type, e.document_id, d.title AS document_title, p.number AS provision_number, i.title AS instrument_title
               FROM amendment_effect e JOIN provision p ON p.id = e.provision_id JOIN instrument i ON i.id = p.instrument_id
               JOIN document d ON d.id = e.document_id WHERE e.created_at >= %s AND e.new_version_id IS NOT NULL""",
            (since,),
        )
        cannot = db.fetch_all(
            conn,
            """SELECT e.document_id, e.ai_note, p.number AS provision_number, i.title AS instrument_title
               FROM amendment_effect e JOIN provision p ON p.id = e.provision_id JOIN instrument i ON i.id = p.instrument_id
               WHERE e.created_at >= %s AND e.change_type = 'cannot_apply'""",
            (since,),
        )
        diffs = db.fetch_all(
            conn,
            """SELECT p.number AS provision_number, i.title AS instrument_title
               FROM amendment_effect e JOIN provision p ON p.id = e.provision_id JOIN instrument i ON i.id = p.instrument_id
               WHERE e.verification_status = 'differs_from_official' AND e.created_at >= %s""",
            (since - timedelta(days=30),),
        )
        failures = db.fetch_all(conn, "SELECT adapter, error FROM source_run WHERE ok = false AND started_at >= %s", (since,))
    html_body = email_notify.build_digest_html(new_docs, merges, cannot, diffs, failures, settings.site_url, day)
    ok = email_notify.send_digest(f"Regulation Tracker digest - {day.isoformat()} ({len(new_docs)} new)", html_body)
    with db.transaction() as conn:
        db.execute(conn, "INSERT INTO notification_log (channel, ok, detail) VALUES ('email', %s, %s)", (ok, f"{len(new_docs)} new docs"))
    return ok


# ----------------------------------------------------------------------------- job runner

HANDLERS = {
    "fetch_document": lambda p: fetch_document(p["document_id"], republished=p.get("republished", False)),
    "tag_document": lambda p: tag_document(p["document_id"]),
    "merge_document": lambda p: merge_document(p["document_id"]),
    "selfcheck_instrument": lambda p: seed_or_selfcheck_instrument(p["slug"], document_id=p.get("document_id")),
    "digest": lambda p: send_daily_digest(),
}

MAX_ATTEMPTS = 3


STALE_MINUTES = 30


def requeue_stale_jobs() -> int:
    """A worker that dies (or is killed) leaves jobs marked 'running'. Put them back on the queue."""
    with db.transaction() as conn:
        return db.execute(
            conn,
            """UPDATE job SET status = 'queued', updated_at = now()
               WHERE status = 'running' AND updated_at < now() - (%s || ' minutes')::interval""",
            (STALE_MINUTES,),
        )


def process_jobs(limit: int = 200, *, adapters: list[str] | None = None, exclude_adapters: list[str] | None = None) -> int:
    """Run queued jobs oldest-first. Returns the number processed.

    `adapters` / `exclude_adapters` restrict the worker to documents from those sources, so browser-driven sites
    (which each need a Chromium) can run in one process while plain-HTTP sites run in several.
    """
    processed = 0
    where = ["status = 'queued'"]
    params: list = []
    if adapters or exclude_adapters:
        names = adapters or exclude_adapters
        op = "IN" if adapters else "NOT IN"
        placeholders = ", ".join(["%s"] * len(names))
        where.append(
            f"""(payload->>'document_id' IS NULL
                 OR EXISTS (SELECT 1 FROM document d WHERE d.id = (payload->>'document_id')::int
                            AND d.source_adapter {op} ({placeholders})))"""
        )
        params.extend(names)
    sql = f"""UPDATE job SET status = 'running', attempts = attempts + 1, updated_at = now()
              WHERE id = (SELECT id FROM job WHERE {' AND '.join(where)} ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
              RETURNING id, type, payload, attempts"""
    while processed < limit:
        with db.transaction() as conn:
            job = db.fetch_one(conn, sql, tuple(params))
        if not job:
            break
        processed += 1
        try:
            HANDLERS[job["type"]](job["payload"])
            with db.transaction() as conn:
                db.execute(conn, "UPDATE job SET status = 'done', updated_at = now() WHERE id = %s", (job["id"],))
        except Exception as exc:
            log.exception("job %s (%s) failed", job["id"], job["type"])
            status = "queued" if job["attempts"] < MAX_ATTEMPTS else "failed"
            with db.transaction() as conn:
                db.execute(
                    conn,
                    "UPDATE job SET status = %s, error = %s, updated_at = now() WHERE id = %s",
                    (status, f"{exc}"[:4000], job["id"]),
                )
                if status == "failed" and job["type"] in ("fetch_document", "tag_document", "merge_document"):
                    db.execute(conn, "UPDATE document SET tag_status = 'failed' WHERE id = %s", (job["payload"].get("document_id"),))
    return processed
