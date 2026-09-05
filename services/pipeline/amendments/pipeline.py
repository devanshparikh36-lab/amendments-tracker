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
from .adapters.base import DiscoveredDocument
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

MASTER_DIRECTION_TYPES = {"master_direction"}


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


def _seed_config(slug: str) -> dict | None:
    for inst in PHASE1_INSTRUMENTS:
        if inst["slug"] == slug:
            return inst["seed"]
    return None


# ----------------------------------------------------------------------------- discovery

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


def _ensure_md_instrument(conn: psycopg.Connection, reg_id: int, d: DiscoveredDocument) -> None:
    """Every FEMA Master Direction on RBI's listing becomes a tracked instrument automatically."""
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
    # original (non-amending) regulations / rules are base texts: keep them whatever their year
    if doc_type in ("notification", "gsr", "rules", "regulations") and not re.search(r"\bAmendment\b|\bamend", title or "", re.I):
        return False
    return True


def _upsert_discovered(conn: psycopg.Connection, reg_id: int, adapter: str, d: DiscoveredDocument) -> bool:
    if is_before_cutoff(d.doc_type, d.title, d.date_issued):
        return False
    if d.doc_type in MASTER_DIRECTION_TYPES:
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

        if doc["doc_type"] in MASTER_DIRECTION_TYPES:
            # A Master Direction is the regulator's own consolidated text: it seeds / self-checks the instrument.
            inst = db.fetch_one(conn, "SELECT id, slug FROM instrument WHERE official_url = %s", (doc["source_url"],))
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
    if cfg is None and inst["kind"] == "master_direction":
        cfg = {"adapter": "rbi_master_directions", "style": "master_direction"}
    if cfg is None and inst["kind"] in ("regulations", "rules") and inst.get("official_url"):
        cfg = {"adapter": "document_text", "style": "regulations"}
    if cfg is None:
        raise RuntimeError(f"no seed source configured for {slug}")
    official = official_text_for(inst, cfg)          # (text | list[ParsedProvision], updated_as_on, source_url)
    text, updated_as_on, source_url = official
    if isinstance(text, list):
        # Source already supplies the text section by section (e.g. the Income Tax portal's section API).
        parsed = [p for p in text if p.text.strip()]
    else:
        parsed = [p for p in split_provisions(text, style=cfg.get("style", "auto")) if p.text.strip()]
    if len(parsed) < 3:
        raise RuntimeError(f"official text for {slug} parsed into only {len(parsed)} provisions; refusing to overwrite")

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
            full_text = p.text + ("\n\n" + "\n".join(p.footnotes) if p.footnotes else "")
            current = db.fetch_one(
                conn,
                "SELECT id, text, source_kind FROM provision_version WHERE provision_id = %s AND effective_to IS NULL ORDER BY id DESC LIMIT 1",
                (row["id"],),
            )
            if current is None:
                db.execute(
                    conn,
                    """INSERT INTO provision_version (provision_id, text, effective_from, source_kind, created_by_document_id)
                       VALUES (%s, %s, %s, 'official', %s)""",
                    (row["id"], full_text, updated_as_on, document_id),
                )
                stats["inserted"] += 1
                continue
            if _norm(current["text"]) == _norm(full_text):
                stats["unchanged"] += 1
                if current["source_kind"] == "machine_merged":
                    db.execute(
                        conn,
                        "UPDATE amendment_effect SET verification_status = 'matches_official' WHERE new_version_id = %s",
                        (current["id"],),
                    )
                continue
            # Text differs: official wins.
            db.execute(conn, "UPDATE provision_version SET effective_to = %s WHERE id = %s", (updated_as_on, current["id"]))
            db.execute(
                conn,
                """INSERT INTO provision_version (provision_id, text, effective_from, source_kind, created_by_document_id, footnote)
                   VALUES (%s, %s, %s, 'official', %s, %s)""",
                (row["id"], full_text, updated_as_on, document_id, f"Official consolidated text as on {updated_as_on}"),
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
            "UPDATE instrument SET official_updated_as_on = %s, seeded_at = COALESCE(seeded_at, now()), official_url = COALESCE(%s, official_url) WHERE id = %s",
            (updated_as_on, source_url, inst["id"]),
        )
    log.info("seed/selfcheck %s: %s", slug, stats)
    return stats


def _slugify(number: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", number).strip("-").lower()


# ----------------------------------------------------------------------------- section map

def load_section_map() -> dict[str, int]:
    """Load CBDT's official Income-tax Act 1961 <-> 2025 provision mapping."""
    from .adapters import cbdt

    rows = cbdt.section_map()
    inserted = 0
    with db.transaction() as conn:
        db.execute(conn, "DELETE FROM section_map WHERE map_key = 'income-tax'")
        for i, r in enumerate(rows):
            old_num, _, old_title = (r["old_title"] or "").partition(" : ")
            new_num, _, new_title = (r["new_title"] or "").partition(" : ")
            entity = (r.get("entity_type") or "").strip().lower() or ("form" if old_num.upper().startswith("FORM") else "section")
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
                    old_num.strip() or None,
                    old_title.strip() or None,
                    new_num.strip() or None,
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


def process_jobs(limit: int = 200) -> int:
    """Run queued jobs oldest-first. Returns the number processed."""
    processed = 0
    while processed < limit:
        with db.transaction() as conn:
            job = db.fetch_one(
                conn,
                """UPDATE job SET status = 'running', attempts = attempts + 1, updated_at = now()
                   WHERE id = (SELECT id FROM job WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
                   RETURNING id, type, payload, attempts""",
            )
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
