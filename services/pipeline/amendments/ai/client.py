"""Claude API access for the unattended tagging and merging steps.

Uses structured outputs (output_config.format json_schema) so every response is machine-parseable.
Credentials resolve from ANTHROPIC_API_KEY or an `ant auth login` profile.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import anthropic

from ..config import settings

log = logging.getLogger(__name__)

_client: anthropic.Anthropic | None = None

# Server-side refusal fallback (opt-in by default per Anthropic guidance for Opus 5 / Fable 5.1 code).
FALLBACK_BETA = "server-side-fallback-2026-06-01"
FALLBACK_MODELS = [{"model": "claude-opus-4-8"}]


class AIRefused(Exception):
    pass


def client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(max_retries=3)
    return _client


def structured_call(
    *,
    system: str,
    user: str,
    schema: dict[str, Any],
    max_tokens: int = 16000,
    effort: str = "high",
    cache_system: bool = True,
) -> dict[str, Any]:
    """One Claude call that must return JSON matching `schema`."""
    if not settings.ai_enabled:
        raise RuntimeError("AI_ENABLED is false")

    system_blocks: list[dict[str, Any]] = [{"type": "text", "text": system}]
    if cache_system:
        system_blocks[0]["cache_control"] = {"type": "ephemeral"}

    kwargs: dict[str, Any] = dict(
        model=settings.claude_model,
        max_tokens=max_tokens,
        system=system_blocks,
        messages=[{"role": "user", "content": user}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    )

    c = client()
    try:
        with c.beta.messages.stream(betas=[FALLBACK_BETA], fallbacks=FALLBACK_MODELS, **kwargs) as stream:
            response = stream.get_final_message()
    except TypeError:
        # SDK without the fallbacks parameter: plain call.
        with c.messages.stream(**kwargs) as stream:
            response = stream.get_final_message()

    if response.stop_reason == "refusal":
        details = getattr(response, "stop_details", None)
        raise AIRefused(f"model refused: {getattr(details, 'category', None)} {getattr(details, 'explanation', '')}")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("response truncated at max_tokens")

    text = next((b.text for b in response.content if b.type == "text"), None)
    if text is None:
        raise RuntimeError("no text block in response")
    usage = response.usage
    log.info(
        "claude %s in=%s cached=%s out=%s",
        response.model,
        usage.input_tokens,
        getattr(usage, "cache_read_input_tokens", 0),
        usage.output_tokens,
    )
    return json.loads(text)
