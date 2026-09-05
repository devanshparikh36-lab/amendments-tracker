"""Adapter registry. Add a regulator by adding an Adapter subclass here and instruments in instruments.py."""
from __future__ import annotations

from datetime import date

from .base import Adapter
from .rbi_apdir import RbiApDirCirculars
from .rbi_fema_notifications import RbiFemaNotifications
from .rbi_master_directions import RbiMasterDirections
from . import rbi_master_directions, rbi_fema_act, cbdt, sebi
from .cbdt import CbdtCirculars, CbdtNotifications
from .sebi import SebiCirculars, SebiMasterCirculars, SebiRegulations

registry: dict[str, Adapter] = {
    a.name: a
    for a in (
        RbiFemaNotifications(),
        RbiApDirCirculars(),
        RbiMasterDirections(),
        CbdtNotifications(),
        CbdtCirculars(),
        SebiRegulations(),
        SebiMasterCirculars(),
        SebiCirculars(),
    )
}

def _document_text(instrument: dict, cfg: dict) -> tuple[str, date | None, str]:
    """Instruments whose official text is a stored document (an original FEM Regulations / Rules notification)."""
    from .. import db  # local import: adapters are otherwise DB-free

    with db.transaction() as conn:
        doc = db.fetch_one(
            conn,
            "SELECT id, source_url, date_issued, date_effective, extracted_text FROM document WHERE source_url = %s",
            (instrument["official_url"],),
        )
        if doc and not doc["extracted_text"]:
            prim = db.fetch_one(
                conn,
                "SELECT extracted_text FROM attachment WHERE document_id = %s AND extracted_text IS NOT NULL ORDER BY is_primary DESC, id LIMIT 1",
                (doc["id"],),
            )
            if prim:
                doc["extracted_text"] = prim["extracted_text"]
    if not doc or not doc["extracted_text"]:
        raise RuntimeError(f"no stored text for {instrument['official_url']}")
    return doc["extracted_text"], doc["date_effective"] or doc["date_issued"], doc["source_url"]


_OFFICIAL_TEXT_SOURCES = {
    "rbi_master_directions": rbi_master_directions.official_text,
    "rbi_fema_act": rbi_fema_act.official_text,
    "cbdt_act": cbdt.official_text,
    "sebi": sebi.official_text,
    "document_text": _document_text,
}


def official_text_for(instrument: dict, cfg: dict) -> tuple[str, date | None, str]:
    """Regulator's consolidated text for an instrument: (text, updated_as_on, source_url)."""
    fn = _OFFICIAL_TEXT_SOURCES.get(cfg.get("adapter", ""))
    if fn is None:
        raise RuntimeError(f"no official-text source configured for adapter {cfg.get('adapter')}")
    return fn(instrument, cfg)
