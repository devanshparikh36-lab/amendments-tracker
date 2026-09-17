"""Runtime configuration for the pipeline worker. All values come from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load .env from the service directory (services/pipeline/.env) if present, then repo root.
_HERE = Path(__file__).resolve().parent.parent
load_dotenv(_HERE / ".env")
load_dotenv(_HERE.parent.parent / ".env")


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    return value if value not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL") or "")

    # Object storage (Cloudflare R2 / any S3). If R2_BUCKET is unset, files are kept on local disk.
    r2_endpoint: str | None = field(default_factory=lambda: _env("R2_ENDPOINT"))
    r2_bucket: str | None = field(default_factory=lambda: _env("R2_BUCKET"))
    r2_access_key_id: str | None = field(default_factory=lambda: _env("R2_ACCESS_KEY_ID"))
    r2_secret_access_key: str | None = field(default_factory=lambda: _env("R2_SECRET_ACCESS_KEY"))
    r2_public_base_url: str | None = field(default_factory=lambda: _env("R2_PUBLIC_BASE_URL"))
    local_storage_dir: Path = field(
        default_factory=lambda: Path(_env("LOCAL_STORAGE_DIR") or (_HERE / "storage_dev"))
    )

    # Claude API. Credentials resolve via ANTHROPIC_API_KEY or an `ant auth login` profile.
    claude_model: str = field(default_factory=lambda: _env("CLAUDE_MODEL") or "claude-opus-5")
    ai_enabled: bool = field(default_factory=lambda: (_env("AI_ENABLED") or "true").lower() == "true")

    # Notifications
    teams_webhook_url: str | None = field(default_factory=lambda: _env("TEAMS_WEBHOOK_URL"))
    resend_api_key: str | None = field(default_factory=lambda: _env("RESEND_API_KEY"))
    # onboarding@resend.dev is Resend's own shared sender: it needs no domain verification and delivers to the
    # Resend account's own address, which is all this digest needs. example.com is a reserved documentation
    # domain and was silently unsendable, so DIGEST_FROM had to be set before any mail could go out at all.
    # onboarding@resend.dev is Resend's shared sender, which needs no domain to be verified -- but it will
    # only deliver to the address that owns the Resend account. Set DIGEST_FROM to an address on a verified
    # domain to mail anyone else.
    digest_from: str = field(default_factory=lambda: _env("DIGEST_FROM") or "As Amended <onboarding@resend.dev>")
    digest_to: list[str] = field(
        default_factory=lambda: [a.strip() for a in (_env("DIGEST_TO") or "").split(",") if a.strip()]
    )

    # Public site URL used in alerts
    site_url: str = field(default_factory=lambda: (_env("SITE_URL") or "http://localhost:3000").rstrip("/"))

    # Documents issued before this year are not tracked (amendments and circulars only; original regulation texts
    # and Master Directions are always kept because later amendments attach to them). Empty = no cutoff.
    min_document_year: int | None = field(
        default_factory=lambda: int(_env("MIN_DOCUMENT_YEAR")) if _env("MIN_DOCUMENT_YEAR") else None
    )

    # Scraper politeness
    user_agent: str = field(
        default_factory=lambda: _env("SCRAPER_USER_AGENT")
        or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) KCM-RegulationTracker/1.0"
    )
    request_delay_seconds: float = field(default_factory=lambda: float(_env("REQUEST_DELAY_SECONDS") or "1.0"))
    request_timeout_seconds: float = field(default_factory=lambda: float(_env("REQUEST_TIMEOUT_SECONDS") or "60"))

    @property
    def storage_is_remote(self) -> bool:
        return bool(self.r2_bucket and self.r2_endpoint and self.r2_access_key_id and self.r2_secret_access_key)


settings = Settings()
