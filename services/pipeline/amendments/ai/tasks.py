"""The two unattended AI tasks: tag a document to instruments/provisions, and merge an amendment into a provision.

Rules baked into the prompts:
- never paraphrase or summarise legal text;
- only apply the change the document states; if it cannot be applied unambiguously return cannot_apply;
- output must be strict JSON (enforced by output_config json_schema).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from .client import structured_call

log = logging.getLogger(__name__)

MAX_DOC_CHARS = 120_000   # ~30k tokens; larger documents are passed in full up to this bound, then truncated with a marker


def _bounded(text: str) -> str:
    if len(text) <= MAX_DOC_CHARS:
        return text
    return text[:MAX_DOC_CHARS] + "\n\n[... document continues; truncated for tagging ...]"


# ---------- Stage 1: which instruments does this document affect? ----------

INSTRUMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "is_amending": {"type": "boolean", "description": "True if the document changes the text of any listed instrument."},
        "effective_date": {"type": ["string", "null"], "description": "ISO date the change takes effect, if stated."},
        "instruments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string"},
                    "relation": {"type": "string", "enum": ["amends", "clarifies", "references", "supersedes"]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["slug", "relation", "confidence"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["is_amending", "effective_date", "instruments"],
    "additionalProperties": False,
}

INSTRUMENT_SYSTEM = """You classify official Indian regulatory documents (RBI notifications, A.P. (DIR Series) circulars, gazette notifications, Master Direction updates) against a fixed list of legal instruments maintained by a compliance tracker.

For the document you receive, decide:
- is_amending: true only if the document itself changes the text of one of the listed instruments (inserts, substitutes, omits or renumbers provisions, or is a new consolidated version of the instrument). Circulars that only issue operational directions, FAQs, press releases, or that merely refer to an instrument are not amending.
- instruments: every listed instrument the document touches, with relation:
  amends       - changes the instrument's text
  supersedes   - replaces the instrument entirely
  clarifies    - operational directions/clarifications under the instrument without changing its text
  references   - merely cites it
Use only slugs from the list. Return an empty array if none apply. Do not invent instruments."""


def tag_instruments(doc_meta: dict, doc_text: str, instruments: list[dict]) -> dict:
    listing = "\n".join(f"- {i['slug']}: {i['title']} ({i['kind']})" for i in instruments)
    user = (
        f"INSTRUMENT LIST\n{listing}\n\n"
        f"DOCUMENT METADATA\nType: {doc_meta.get('doc_type')}\nNumber: {doc_meta.get('number')}\n"
        f"Date: {doc_meta.get('date_issued')}\nTitle: {doc_meta.get('title')}\nSource: {doc_meta.get('source_url')}\n\n"
        f"DOCUMENT TEXT\n{_bounded(doc_text)}"
    )
    return structured_call(system=INSTRUMENT_SYSTEM, user=user, schema=INSTRUMENT_SCHEMA, max_tokens=4000, effort="medium")


# ---------- Stage 2: which provisions of one instrument, and how? ----------

EFFECTS_SCHEMA = {
    "type": "object",
    "properties": {
        "effects": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "provision_number": {"type": "string", "description": "Exact number from the provision index, or the new number for an insertion."},
                    "change_type": {"type": "string", "enum": ["insert", "substitute", "omit", "renumber"]},
                    "amending_text": {"type": "string", "description": "Verbatim excerpt of the document that effects this change (the instruction plus any new text)."},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["provision_number", "change_type", "amending_text", "confidence"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["effects"],
    "additionalProperties": False,
}

EFFECTS_SYSTEM = """You read an amending document and identify exactly which provisions of ONE legal instrument it changes.

You receive the instrument's provision index (number and heading/first words). For every change the document makes to this instrument, output one effect:
- provision_number: the number exactly as in the index (e.g. "15.1", "6", "Regulation 5"). For an insertion of a new provision, give the new number the document assigns (e.g. "15.3", "6A").
- change_type: insert | substitute | omit | renumber
- amending_text: copy verbatim the part of the document that makes this change, including the full new text where the document supplies it. Never paraphrase.
Only list changes to this instrument. If the document changes nothing in it, return an empty array."""


def tag_effects(doc_meta: dict, doc_text: str, instrument: dict, provisions: list[dict]) -> dict:
    index = "\n".join(
        f"- {p['number']}: {(p.get('heading') or p.get('first_words') or '')[:100]}" for p in provisions
    )
    user = (
        f"INSTRUMENT\n{instrument['slug']}: {instrument['title']}\n\nPROVISION INDEX\n{index}\n\n"
        f"DOCUMENT METADATA\nType: {doc_meta.get('doc_type')}\nNumber: {doc_meta.get('number')}\n"
        f"Date: {doc_meta.get('date_issued')}\nTitle: {doc_meta.get('title')}\n\n"
        f"DOCUMENT TEXT\n{_bounded(doc_text)}"
    )
    return structured_call(system=EFFECTS_SYSTEM, user=user, schema=EFFECTS_SCHEMA, max_tokens=16000, effort="high")


# ---------- Stage 3: apply one change to one provision ----------

MERGE_SCHEMA = {
    "type": "object",
    "properties": {
        "status": {"type": "string", "enum": ["applied", "cannot_apply"]},
        "new_text": {"type": ["string", "null"], "description": "Full text of the provision after the change. Null if cannot_apply or if the provision is omitted entirely."},
        "footnote": {"type": "string", "description": "e.g. 'Substituted by A.P. (DIR Series) Circular No. 22 dated February 16, 2026, w.e.f. February 16, 2026.'"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "note": {"type": "string", "description": "One or two sentences: what was changed, or why it could not be applied."},
    },
    "required": ["status", "new_text", "footnote", "confidence", "note"],
    "additionalProperties": False,
}

MERGE_SYSTEM = """You are a legislative drafting engine that consolidates amendments into the text of Indian regulations.

You receive: the CURRENT TEXT of one provision, and the AMENDING INSTRUCTION from an official document (with its number and date). Produce the provision's text AFTER applying that instruction.

Strict rules:
1. Apply only what the instruction says. Substitute exactly the words/sub-clauses it names; insert new text exactly where it says; when a provision is omitted, return new_text null and say so in the note.
2. Copy all wording verbatim from the current text and from the instruction. Never rephrase, modernise, reorder, correct, or summarise. Preserve numbering, punctuation and quotation marks as given.
3. Keep the provision number and heading at the start of new_text exactly as they appear in the current text.
4. If the instruction is ambiguous, refers to words that do not appear in the current text, or depends on other provisions you cannot see, return status cannot_apply with a precise note. Do not guess.
5. footnote: one sentence in the conventional style, naming the document and date and the effective date if stated."""


@dataclass
class MergeResult:
    status: str
    new_text: str | None
    footnote: str
    confidence: float
    note: str


def merge_provision(
    *, provision_number: str, current_text: str, change_type: str, amending_text: str, doc_meta: dict
) -> MergeResult:
    user = (
        f"PROVISION NUMBER: {provision_number}\nCHANGE TYPE: {change_type}\n\n"
        f"CURRENT TEXT\n{current_text if current_text else '[provision does not exist yet - this is an insertion]'}\n\n"
        f"AMENDING DOCUMENT\nNumber: {doc_meta.get('number')}\nDate: {doc_meta.get('date_issued')}\n"
        f"Title: {doc_meta.get('title')}\nEffective: {doc_meta.get('date_effective') or 'as stated in the instruction, else date of issue'}\n\n"
        f"AMENDING INSTRUCTION\n{amending_text}"
    )
    out = structured_call(system=MERGE_SYSTEM, user=user, schema=MERGE_SCHEMA, max_tokens=16000, effort="high")
    return MergeResult(
        status=out["status"],
        new_text=out.get("new_text"),
        footnote=out.get("footnote", ""),
        confidence=float(out.get("confidence", 0)),
        note=out.get("note", ""),
    )
