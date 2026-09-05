"""File storage for PDFs and attachments: Cloudflare R2 (S3 API) in production, local disk in development."""
from __future__ import annotations

import logging
import mimetypes
import re
from pathlib import Path

from ..config import settings

log = logging.getLogger(__name__)

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_name(name: str) -> str:
    name = _SAFE.sub("_", name).strip("_")
    return name[:180] or "file"


def build_key(adapter: str, document_key: str, filename: str) -> str:
    return f"{adapter}/{safe_name(document_key)}/{safe_name(filename)}"


def guess_mime(filename: str, header_mime: str | None) -> str:
    if header_mime and "octet-stream" not in header_mime:
        return header_mime.split(";")[0].strip()
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


class Storage:
    def __init__(self) -> None:
        self.remote = settings.storage_is_remote
        if self.remote:
            import boto3  # imported lazily so dev environments do not need credentials

            self._s3 = boto3.client(
                "s3",
                endpoint_url=settings.r2_endpoint,
                aws_access_key_id=settings.r2_access_key_id,
                aws_secret_access_key=settings.r2_secret_access_key,
                region_name="auto",
            )
        else:
            settings.local_storage_dir.mkdir(parents=True, exist_ok=True)

    def put(self, key: str, data: bytes, mime: str) -> str:
        if self.remote:
            self._s3.put_object(Bucket=settings.r2_bucket, Key=key, Body=data, ContentType=mime)
        else:
            path = settings.local_storage_dir / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        return key

    def get(self, key: str) -> bytes:
        if self.remote:
            obj = self._s3.get_object(Bucket=settings.r2_bucket, Key=key)
            return obj["Body"].read()
        return (settings.local_storage_dir / key).read_bytes()

    def exists(self, key: str) -> bool:
        if self.remote:
            try:
                self._s3.head_object(Bucket=settings.r2_bucket, Key=key)
                return True
            except Exception:
                return False
        return (settings.local_storage_dir / key).exists()

    def public_url(self, key: str) -> str:
        if self.remote and settings.r2_public_base_url:
            return f"{settings.r2_public_base_url.rstrip('/')}/{key}"
        return f"{settings.site_url}/api/files/{key}"


_storage: Storage | None = None


def storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = Storage()
    return _storage
