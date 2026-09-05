"""Post Adaptive Cards to a Microsoft Teams incoming webhook."""
from __future__ import annotations

import logging

import httpx

from ..config import settings

log = logging.getLogger(__name__)


def _card(title: str, facts: list[tuple[str, str]], url: str | None, body: str | None = None) -> dict:
    items: list[dict] = [{"type": "TextBlock", "text": title, "weight": "Bolder", "size": "Medium", "wrap": True}]
    if body:
        items.append({"type": "TextBlock", "text": body, "wrap": True, "spacing": "Small"})
    if facts:
        items.append({"type": "FactSet", "facts": [{"title": k, "value": v} for k, v in facts if v]})
    card: dict = {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": items,
    }
    if url:
        card["actions"] = [{"type": "Action.OpenUrl", "title": "Open in tracker", "url": url}]
    return {
        "type": "message",
        "attachments": [{"contentType": "application/vnd.microsoft.card.adaptive", "content": card}],
    }


def send_teams(title: str, facts: list[tuple[str, str]], url: str | None = None, body: str | None = None) -> bool:
    if not settings.teams_webhook_url:
        log.info("TEAMS_WEBHOOK_URL not set; skipping Teams alert: %s", title)
        return False
    try:
        resp = httpx.post(settings.teams_webhook_url, json=_card(title, facts, url, body), timeout=30)
        resp.raise_for_status()
        return True
    except Exception as exc:
        log.error("Teams webhook failed: %s", exc)
        return False


def notify_new_document(doc: dict, tags: list[str], site_url: str) -> bool:
    facts = [
        ("Regulator", doc.get("regulator_code", "")),
        ("Type", doc.get("doc_type", "")),
        ("Number", doc.get("number") or ""),
        ("Date", str(doc.get("date_issued") or "")),
        ("Affects", ", ".join(tags) if tags else "not an amendment / untagged"),
        ("Source", doc.get("source_url", "")),
    ]
    return send_teams(f"New: {doc['title']}", facts, f"{site_url}/documents/{doc['id']}")


def notify_discrepancy(instrument_title: str, provision_number: str, site_url: str, provision_path: str) -> bool:
    return send_teams(
        f"Official text differs from machine merge: {instrument_title} {provision_number}",
        [("Instrument", instrument_title), ("Provision", provision_number)],
        f"{site_url}{provision_path}",
        "The regulator republished consolidated text that does not match the machine-consolidated version. Official text now wins.",
    )


def notify_adapter_failure(adapter: str, error: str, site_url: str) -> bool:
    return send_teams(f"Adapter failed: {adapter}", [("Error", error[:500])], f"{site_url}/status")
