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

    # SMTP, which is the transport actually in use. Gmail by default, hence the host and port defaults.
    #
    # Chosen over Resend deliberately and not for cost -- both are free at this volume. Resend's shared
    # sender, onboarding@resend.dev, delivers only to the address that owns the Resend account, and a
    # verified domain is the only way past that. This project has no domain, so Resend could never mail a
    # reader. SMTP from an address we own can mail anybody, which is the difference between reader alerts
    # being unimplemented and being impossible.
    #
    # What that costs, written down so it is not rediscovered: no bounce or complaint webhooks, weaker
    # standing with corporate mail servers than a verified domain, and Google's long drift away from app
    # passwords towards OAuth. All three start to bite only when mail goes to people other than the owner.
    smtp_host: str = field(default_factory=lambda: _env("SMTP_HOST") or "smtp.gmail.com")
    smtp_port: int = field(default_factory=lambda: int(_env("SMTP_PORT") or "587"))
    smtp_user: str | None = field(default_factory=lambda: _env("SMTP_USER"))
    # Whitespace is stripped, which is not fussiness: Google shows an app password as four groups of four
    # ("abcd efgh ijkl mnop") and it is pasted that way more often than not. SMTP AUTH then fails with
    # "Username and Password not accepted", which reads like a wrong password rather than a formatting one.
    smtp_password: str | None = field(
        default_factory=lambda: "".join((_env("SMTP_PASSWORD") or "").split()) or None
    )

    resend_api_key: str | None = field(default_factory=lambda: _env("RESEND_API_KEY"))
    # Deliberately no default here any more: the right one depends on which transport sends, and only the
    # sender knows that. notify/email.py resolves it -- the authenticated SMTP user for SMTP, Resend's
    # shared sender for Resend.
    #
    # Setting this to something Gmail has not been told we own does not do what it looks like. Gmail
    # rewrites a From that is neither the authenticated account nor one of its verified "Send mail as"
    # aliases, so the mail arrives from the account anyway and the configuration reads as a lie. Leave it
    # unset unless an alias has actually been set up in Gmail.
    digest_from: str | None = field(default_factory=lambda: _env("DIGEST_FROM"))
    digest_to: list[str] = field(
        default_factory=lambda: [a.strip() for a in (_env("DIGEST_TO") or "").split(",") if a.strip()]
    )
    # Both optional, and both left off the message entirely when unset rather than pointed somewhere
    # plausible: a Reply-To nobody reads and an unsubscribe link that does nothing are worse than their
    # absence. They become worth setting once the digest sends from a domain of its own.
    digest_reply_to: str | None = field(default_factory=lambda: _env("DIGEST_REPLY_TO"))
    # A mailto: or https: target, per RFC 8058. Matters when the digest goes to anyone but its owner.
    digest_unsubscribe: str | None = field(default_factory=lambda: _env("DIGEST_UNSUBSCRIBE"))

    # Neon's own API, read only to see how much of the free compute allowance has been spent. Storage can be
    # measured from inside Postgres; compute cannot -- CU-hours are a billing metric the database does not
    # know about -- so watching it needs a key. Both unset means the compute watch reports nothing rather
    # than guessing; see storage/usage.py.
    neon_api_key: str | None = field(default_factory=lambda: _env("NEON_API_KEY"))
    neon_project_id: str | None = field(default_factory=lambda: _env("NEON_PROJECT_ID"))

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
