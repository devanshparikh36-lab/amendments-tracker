"""Adapter registry. Add a regulator by adding an Adapter subclass here and instruments in instruments.py."""
from __future__ import annotations

from datetime import date

from .base import Adapter
from .rbi_apdir import RbiApDirCirculars
from .rbi_fema_notifications import RbiFemaNotifications
from .rbi_master_directions import RbiMasterDirections
from . import rbi_master_directions, rbi_fema_act

registry: dict[str, Adapter] = {
    a.name: a
    for a in (
        RbiFemaNotifications(),
        RbiApDirCirculars(),
        RbiMasterDirections(),
    )
}

_OFFICIAL_TEXT_SOURCES = {
    "rbi_master_directions": rbi_master_directions.official_text,
    "rbi_fema_act": rbi_fema_act.official_text,
}


def official_text_for(instrument: dict, cfg: dict) -> tuple[str, date | None, str]:
    """Regulator's consolidated text for an instrument: (text, updated_as_on, source_url)."""
    fn = _OFFICIAL_TEXT_SOURCES.get(cfg.get("adapter", ""))
    if fn is None:
        raise RuntimeError(f"no official-text source configured for adapter {cfg.get('adapter')}")
    return fn(instrument, cfg)
