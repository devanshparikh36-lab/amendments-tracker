"""Thin psycopg3 helpers. The schema lives in packages/db/migrations/*.sql."""
from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from .config import settings

log = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parents[3] / "packages" / "db" / "migrations"


def connect() -> psycopg.Connection[dict[str, Any]]:
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg.connect(settings.database_url, row_factory=dict_row, autocommit=False)


@contextlib.contextmanager
def transaction() -> Iterator[psycopg.Connection[dict[str, Any]]]:
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetch_one(conn: psycopg.Connection, sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def fetch_all(conn: psycopg.Connection, sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def execute(conn: psycopg.Connection, sql: str, params: tuple | dict = ()) -> int:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.rowcount


def execute_script(conn: psycopg.Connection, sql: str) -> None:
    """Run SQL exactly as written, with no placeholder parsing at all.

    `execute` passes a params tuple, and psycopg then treats every `%` in the statement as the start of a
    placeholder. For a migration that is wrong twice: it takes no parameters, and its comments are prose.
    The first migration to contain a per-cent sign failed to apply with "incomplete placeholder: '%'" --
    nothing to do with its SQL, which was a single ALTER TABLE. Six migrations happened not to use the
    character, so this waited a year to appear.

    Passing None rather than a tuple tells psycopg there is nothing to interpolate, so the text is sent
    verbatim. Only for static SQL from disk; anything with a value in it still belongs in `execute`.
    """
    with conn.cursor() as cur:
        cur.execute(sql, None)


def migrate() -> list[str]:
    """Apply every SQL file in packages/db/migrations in name order, tracking them in schema_migrations."""
    applied: list[str] = []
    with transaction() as conn:
        execute(
            conn,
            "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
        )
        done = {r["name"] for r in fetch_all(conn, "SELECT name FROM schema_migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in done:
                continue
            log.info("applying migration %s", path.name)
            execute_script(conn, path.read_text(encoding="utf-8"))
            execute(conn, "INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
            applied.append(path.name)
    return applied


def regulator_id(conn: psycopg.Connection, code: str) -> int:
    row = fetch_one(conn, "SELECT id FROM regulator WHERE code = %s", (code,))
    if not row:
        raise LookupError(f"unknown regulator {code}")
    return row["id"]
