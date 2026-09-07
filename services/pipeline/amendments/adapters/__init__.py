"""Adapter registry. Add a regulator by adding an Adapter subclass here and instruments in instruments.py."""
from __future__ import annotations

from datetime import date

import logging

from .base import Adapter, SeedResult
from .cbic_gst import CbicGstCirculars, CbicGstNotifications
from .rbi_apdir import RbiApDirCirculars
from .rbi_fema_notifications import RbiFemaNotifications
from .rbi_master_directions import RbiMasterDirections
from . import cbdt, cbic_gst, rbi_fema_act, rbi_master_directions, sebi
from .cbdt import CbdtCirculars, CbdtNotifications
from .sebi import SebiCirculars, SebiMasterCirculars, SebiRegulations
from . import rbi_master_directions, rbi_fema_act, cbdt, mca
from .cbdt import CbdtCirculars, CbdtNotifications
from .mca import McaCirculars, McaNotifications

log = logging.getLogger(__name__)

registry: dict[str, Adapter] = {
    a.name: a
    for a in (
        RbiFemaNotifications(),
        RbiApDirCirculars(),
        RbiMasterDirections(),
        CbdtNotifications(),
        CbdtCirculars(),
        CbicGstNotifications(),
        CbicGstCirculars(),
        SebiRegulations(),
        SebiMasterCirculars(),
        SebiCirculars(),
        McaNotifications(),
        McaCirculars(),
    )
}

def _document_text(instrument: dict, cfg: dict) -> SeedResult:
    """Instruments whose official text is a stored document (an original FEM Regulations / Rules notification).

    The gazette PDF we already stored for that document comes back too, so the site can offer the official file
    and fall back to it when the text does not parse into usable provisions.
    """
    from .. import db  # local import: adapters are otherwise DB-free
    from ..storage.files import storage

    with db.transaction() as conn:
        doc = db.fetch_one(
            conn,
            "SELECT id, source_url, date_issued, date_effective, extracted_text FROM document WHERE source_url = %s",
            (instrument["official_url"],),
        )
        attachment = None
        if doc:
            attachment = db.fetch_one(
                conn,
                """SELECT extracted_text, storage_key, source_url FROM attachment
                   WHERE document_id = %s AND storage_key IS NOT NULL ORDER BY is_primary DESC, id LIMIT 1""",
                (doc["id"],),
            )
            if not doc["extracted_text"] and attachment and attachment["extracted_text"]:
                doc["extracted_text"] = attachment["extracted_text"]
    if not doc or not doc["extracted_text"]:
        raise RuntimeError(f"no stored text for {instrument['official_url']}")
    pdf_bytes = None
    if attachment and str(attachment["storage_key"]).lower().endswith(".pdf"):
        try:
            pdf_bytes = storage().get(attachment["storage_key"])
        except Exception as exc:
            log.warning("%s: stored PDF unavailable: %s", instrument.get("slug"), str(exc)[:100])
    return SeedResult(
        text=doc["extracted_text"],
        updated_as_on=doc["date_effective"] or doc["date_issued"],
        source_url=doc["source_url"],
        pdf_bytes=pdf_bytes,
        pdf_url=(attachment or {}).get("source_url"),
    )


_OFFICIAL_TEXT_SOURCES = {
    "rbi_master_directions": rbi_master_directions.official_text,
    "rbi_fema_act": rbi_fema_act.official_text,
    "cbdt_act": cbdt.official_text,
    "cbic_gst": cbic_gst.official_text,
    "sebi": sebi.official_text,
    "mca": mca.official_text,
    "document_text": _document_text,
}


def official_text_for(instrument: dict, cfg: dict) -> tuple[str, date | None, str]:
    """Regulator's consolidated text for an instrument: (text, updated_as_on, source_url)."""
    fn = _OFFICIAL_TEXT_SOURCES.get(cfg.get("adapter", ""))
    if fn is None:
        raise RuntimeError(f"no official-text source configured for adapter {cfg.get('adapter')}")
    return fn(instrument, cfg)
