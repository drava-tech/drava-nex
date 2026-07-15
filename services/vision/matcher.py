"""
matcher.py — pgvector nearest-neighbor matching, enrollment and cooldown.

pgvector's <=> operator is cosine distance (1 - cosine similarity); ArcFace
embeddings are unit-norm, so distance <= Config.match_max_distance means
"same person". The HNSW index on visitor.embedding keeps the query fast at
any table size.
"""

from __future__ import annotations
import logging
import time
from typing import Optional

import numpy as np

from .config import Config
from .db import Db

log = logging.getLogger(__name__)


class Matcher:
    def __init__(self, cfg: Config, db: Db) -> None:
        self._cfg = cfg
        self._db = db
        # uuid -> monotonic time of the last DB write for that visitor.
        self._last_write: dict[str, float] = {}

    def find_nearest(self, embedding: np.ndarray) -> Optional[tuple[str, float]]:
        """Return (uuid, cosine_distance) of the closest visitor, or None if empty."""
        row = self._db.query_one(
            "SELECT uuid::text, embedding <=> %s AS distance "
            "FROM visitor ORDER BY embedding <=> %s LIMIT 1",
            (embedding, embedding),
        )
        if row is None:
            return None
        return str(row[0]), float(row[1])

    def touch(self, visitor_uuid: str) -> bool:
        """Bump last_seen, at most once per cooldown window. Returns True if written."""
        now = time.monotonic()
        last = self._last_write.get(visitor_uuid)
        if last is not None and now - last < self._cfg.cooldown_seconds:
            return False
        self._db.execute(
            "UPDATE visitor SET last_seen = now() WHERE uuid = %s", (visitor_uuid,)
        )
        self._last_write[visitor_uuid] = now
        return True

    def enroll(self, embedding: np.ndarray) -> str:
        """Insert a new anonymous visitor row and return its uuid.

        name/email default to '', role to 'guest', timestamps to now() (all
        column defaults from the Drizzle schema). The face JPEG is saved by the
        caller afterwards (the uuid names the file) via set_image().
        """
        row = self._db.query_one(
            "INSERT INTO visitor (embedding) VALUES (%s) RETURNING uuid::text",
            (embedding,),
        )
        assert row is not None
        visitor_uuid = str(row[0])
        self._last_write[visitor_uuid] = time.monotonic()
        return visitor_uuid

    def set_image(self, visitor_uuid: str, filename: str) -> None:
        self._db.execute(
            "UPDATE visitor SET image_path = %s WHERE uuid = %s",
            (filename, visitor_uuid),
        )

    def prune_cooldowns(self, max_age_seconds: float = 3600.0) -> None:
        """Drop stale cooldown entries so the map doesn't grow forever."""
        cutoff = time.monotonic() - max_age_seconds
        stale = [u for u, t in self._last_write.items() if t < cutoff]
        for u in stale:
            del self._last_write[u]
