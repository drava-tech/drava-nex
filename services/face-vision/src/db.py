"""
db.py — direct Postgres access for the face pipeline (psycopg3 + pgvector).

The service owns no schema: the `visitor` table is created by the Drizzle
migrations in packages/db. Connections are autocommit (every statement here is
a single-row read or write) and self-heal with backoff so a Postgres restart
doesn't kill the pipeline.
"""

from __future__ import annotations
import logging
import time
from typing import Any, Optional, Sequence

import psycopg
from pgvector.psycopg import register_vector

from .config import Config

log = logging.getLogger(__name__)

_RETRY_DELAYS = (1.0, 2.0, 5.0, 10.0, 30.0)


class Db:
    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._conn: Optional[psycopg.Connection] = None

    def connect(self) -> None:
        conn = psycopg.connect(self._cfg.database_url, autocommit=True)
        register_vector(conn)
        self._conn = conn
        log.info("[db] Connected to Postgres.")

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    def _execute(
        self, sql: str, params: Sequence[Any], fetch: bool
    ) -> Optional[tuple[Any, ...]]:
        """Run one statement, reconnecting with backoff on connection errors."""
        last_error: Exception | None = None
        for attempt, delay in enumerate((0.0,) + _RETRY_DELAYS):
            if delay:
                log.warning("[db] Reconnecting in %.0fs (attempt %d)…", delay, attempt)
                time.sleep(delay)
            try:
                if self._conn is None or self._conn.closed:
                    self.connect()
                assert self._conn is not None
                with self._conn.cursor() as cur:
                    cur.execute(sql, params)
                    return cur.fetchone() if fetch else None
            except psycopg.OperationalError as e:
                last_error = e
                self.close()
        raise RuntimeError(f"[db] Postgres unreachable after retries: {last_error}")

    def query_one(self, sql: str, params: Sequence[Any]) -> Optional[tuple[Any, ...]]:
        return self._execute(sql, params, fetch=True)

    def execute(self, sql: str, params: Sequence[Any]) -> None:
        self._execute(sql, params, fetch=False)
