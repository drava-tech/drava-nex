"""
db_face_recognition.py — Postgres/pgvector access for face recognition:
connection handling + visitor matching/enrollment/cooldown, combined.

Standalone for now by design, same as camera_rtsp.py: takes explicit
constructor params (database_url, match_max_distance, cooldown_seconds)
instead of a Config object, so it doesn't require config.py to be touched to
exist and be tested. It combines what's currently split across two existing
files so the face-recognition data layer is one focused, independently
testable module:
  - db.py's Db class       — connection + self-healing reconnect w/ backoff
  - matcher.py's Matcher   — find_nearest / enroll / touch / set_image /
                              prune_cooldowns (pgvector cosine-distance
                              matching against the `visitor` table)

NOT YET USABLE AS-IS — needs one additive schema change first:
    One person, many embeddings. A single sighting's embedding quality varies
    a lot with angle/distance/lighting — the camera's current physical
    placement gives small, often off-angle faces, and that distance can't be
    fixed by repositioning, so the mitigation is storing several samples per
    person and matching against all of them (best result wins), so a person
    only needs to match ONE of their stored angles to be recognized. The
    current `visitor` table (packages/db/src/schema/visitors.ts) stores
    exactly one `embedding` column per row, which doesn't support that.

    The fix is a new, purely additive table — nothing about the existing
    `visitor` table needs to change (its `embedding` column + HNSW index stay
    exactly as they are, so nothing else that reads them breaks):

        visitor_embedding (
            id            SERIAL PRIMARY KEY,
            visitor_uuid  UUID NOT NULL REFERENCES visitor(uuid),
            embedding     VECTOR(512) NOT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        + an HNSW index on embedding (vector_cosine_ops), same as visitor's
        + a plain btree index on visitor_uuid

    That's a Drizzle schema addition + migration in packages/db — someone
    with ownership of that package should add it to the shared DB (not done
    here). This module already works today against a local Postgres set up
    for testing (see local_postgres_schema.sql, applied there directly via
    psql) — only the shared/production DB is still missing the table.

Once reviewed, wiring this in alongside/instead of db.py + matcher.py is a
naming/import change in pipeline.py, not a redesign.

Usage (standalone, once visitor_embedding exists):
    face_db = FaceRecognitionDb("postgresql://user:pass@host:5432/cms_db")
    face_db.connect()
    nearest = face_db.find_nearest(embedding)   # (uuid, distance) or None
    if nearest is None or nearest[1] > face_db.match_max_distance:
        uuid = face_db.enroll(embedding)
    else:
        face_db.add_embedding_sample(nearest[0], embedding)  # widen their profile
    face_db.close()
"""

from __future__ import annotations
import logging
import time
from typing import Any, Optional, Sequence

import numpy as np
import psycopg
from pgvector.psycopg import register_vector

log = logging.getLogger(__name__)

_RETRY_DELAYS = (1.0, 2.0, 5.0, 10.0, 30.0)


class FaceRecognitionDb:
    def __init__(
        self,
        database_url: str,
        match_max_distance: float = 0.5,
        cooldown_seconds: float = 30.0,
    ) -> None:
        self._database_url = database_url
        self.match_max_distance = match_max_distance
        self._cooldown_seconds = cooldown_seconds
        self._conn: Optional[psycopg.Connection] = None
        # uuid -> monotonic time of the last DB write for that visitor.
        self._last_write: dict[str, float] = {}

    # ─── connection ────────────────────────────────────────────────────────

    def connect(self) -> None:
        conn = psycopg.connect(self._database_url, autocommit=True)
        register_vector(conn)
        self._conn = conn
        log.info("[db_face_recognition] Connected to Postgres.")

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    def _execute(
        self, sql: str, params: Sequence[Any], fetch: bool, fetch_all: bool = False
    ) -> Any:
        """Run one statement, reconnecting with backoff on connection errors."""
        last_error: Exception | None = None
        for attempt, delay in enumerate((0.0,) + _RETRY_DELAYS):
            if delay:
                log.warning("[db_face_recognition] Reconnecting in %.0fs (attempt %d)…", delay, attempt)
                time.sleep(delay)
            try:
                if self._conn is None or self._conn.closed:
                    self.connect()
                assert self._conn is not None
                with self._conn.cursor() as cur:
                    cur.execute(sql, params)
                    if fetch_all:
                        return cur.fetchall()
                    return cur.fetchone() if fetch else None
            except psycopg.OperationalError as e:
                last_error = e
                self.close()
        raise RuntimeError(f"[db_face_recognition] Postgres unreachable after retries: {last_error}")

    def query_one(self, sql: str, params: Sequence[Any]) -> Optional[tuple[Any, ...]]:
        return self._execute(sql, params, fetch=True)

    def query_all(self, sql: str, params: Sequence[Any] = ()) -> list[tuple[Any, ...]]:
        return self._execute(sql, params, fetch=False, fetch_all=True)

    def execute(self, sql: str, params: Sequence[Any]) -> None:
        self._execute(sql, params, fetch=False)

    # ─── face matching / enrollment ────────────────────────────────────────

    def find_nearest(self, embedding: np.ndarray) -> Optional[tuple[str, float]]:
        """Return (visitor_uuid, cosine_distance) of the closest stored sample
        across ALL visitors' embeddings, or None if there are none yet.

        Requires the visitor_embedding table — see this module's docstring.
        """
        row = self.query_one(
            "SELECT visitor_uuid::text, embedding <=> %s AS distance "
            "FROM visitor_embedding ORDER BY embedding <=> %s LIMIT 1",
            (embedding, embedding),
        )
        if row is None:
            return None
        return str(row[0]), float(row[1])

    def touch(self, visitor_uuid: str) -> bool:
        """Bump last_seen, at most once per cooldown window. Returns True if written."""
        now = time.monotonic()
        last = self._last_write.get(visitor_uuid)
        if last is not None and now - last < self._cooldown_seconds:
            return False
        self.execute("UPDATE visitor SET last_seen = now() WHERE uuid = %s", (visitor_uuid,))
        self._last_write[visitor_uuid] = now
        return True

    def enroll(self, embedding: np.ndarray, quality_score: Optional[float] = None,
               image_bytes: Optional[bytes] = None) -> str:
        """Insert a new anonymous visitor row plus its first embedding sample,
        and return its uuid.

        name defaults to '', timestamps to now(). local_postgres_schema.sql
        drops email/role from the real Drizzle schema (unused here, by
        explicit instruction) — this module's own INSERT never referenced
        them anyway, so nothing else changes. visitor.embedding keeps
        getting this first sample too (existing column/index untouched, in
        case anything else still reads it) — call add_embedding_sample()
        afterwards with further angle-samples as they're captured for the
        same track; matching (find_nearest) considers all of them, not just
        this first one.

        The face crop JPEG is stored in the DB, not on disk: image_bytes goes
        onto both visitor_embedding.image_bytes (this first sample) and
        visitor.image_bytes (the representative crop the CMS serves)."""
        row = self.query_one(
            "INSERT INTO visitor (embedding, image_bytes) VALUES (%s, %s) RETURNING uuid::text",
            (embedding, image_bytes),
        )
        assert row is not None
        visitor_uuid = str(row[0])
        self.execute(
            "INSERT INTO visitor_embedding (visitor_uuid, embedding, quality_score, photo_number, image_bytes) "
            "VALUES (%s, %s, %s, 1, %s)",
            (visitor_uuid, embedding, quality_score, image_bytes),
        )
        self._last_write[visitor_uuid] = time.monotonic()
        return visitor_uuid

    def add_embedding_sample(
        self, visitor_uuid: str, embedding: np.ndarray,
        quality_score: Optional[float] = None, photo_number: Optional[int] = None,
        image_bytes: Optional[bytes] = None,
    ) -> None:
        """Add another angle-sample to an existing visitor's profile —
        widens what future sightings can match against, at any point after
        enrollment (not just during the initial sighting). photo_number
        defaults to the next sequential slot (current count + 1) if not
        given explicitly — pass it explicitly when REPLACING a specific
        existing photo slot (see replace_worst_sample()). image_bytes is the
        sample's face-crop JPEG, stored alongside its embedding in the DB."""
        if photo_number is None:
            photo_number = self.embedding_count(visitor_uuid) + 1
        self.execute(
            "INSERT INTO visitor_embedding (visitor_uuid, embedding, quality_score, photo_number, image_bytes) "
            "VALUES (%s, %s, %s, %s, %s)",
            (visitor_uuid, embedding, quality_score, photo_number, image_bytes),
        )

    def embedding_count(self, visitor_uuid: str) -> int:
        row = self.query_one(
            "SELECT COUNT(*) FROM visitor_embedding WHERE visitor_uuid = %s", (visitor_uuid,)
        )
        assert row is not None
        return int(row[0])

    def worst_sample(self, visitor_uuid: str) -> Optional[tuple[int, int, float]]:
        """(id, photo_number, quality_score) of this visitor's lowest-ranked
        stored sample — NULL quality_score (rows stored before this scoring
        existed) sorts as -1, so an unscored old row gets replaced before any
        real-scored one. None if they have no samples yet."""
        row = self.query_one(
            "SELECT id, photo_number, COALESCE(quality_score, -1) AS q FROM visitor_embedding "
            "WHERE visitor_uuid = %s ORDER BY q ASC LIMIT 1",
            (visitor_uuid,),
        )
        if row is None:
            return None
        return int(row[0]), int(row[1]), float(row[2])

    def replace_sample(self, embedding_id: int, embedding: np.ndarray, quality_score: float,
                       image_bytes: Optional[bytes] = None) -> None:
        """Overwrite an existing stored sample in place (same row, same
        photo_number) with a better one — used once a visitor is already at
        MAX_TOTAL_SAMPLES_PER_VISITOR and a newly captured sample outranks
        their current worst. Keeping the same photo_number means the caller
        just overwrites that numbered slot, no renumbering needed. image_bytes
        replaces the stored crop for that slot too, so it matches the new
        embedding."""
        self.execute(
            "UPDATE visitor_embedding SET embedding = %s, quality_score = %s, image_bytes = %s, "
            "created_at = now() WHERE id = %s",
            (embedding, quality_score, image_bytes, embedding_id),
        )

    def set_image(self, visitor_uuid: str, filename: str) -> None:
        """Set image_path — kept only as a lightweight non-null presence
        marker (drives the CMS `hasImage`). The crop bytes themselves live in
        visitor.image_bytes / visitor_embedding.image_bytes; see
        set_primary_image()."""
        self.execute("UPDATE visitor SET image_path = %s WHERE uuid = %s", (filename, visitor_uuid))

    def set_primary_image(self, visitor_uuid: str, image_bytes: bytes) -> None:
        """Set the visitor's representative face crop (JPEG bytes) — this is
        what GET /api/visitors/:uuid/image and the CMS thumbnail serve."""
        self.execute("UPDATE visitor SET image_bytes = %s WHERE uuid = %s", (image_bytes, visitor_uuid))

    def get_primary_image(self, visitor_uuid: str) -> Optional[bytes]:
        """The visitor's representative face-crop bytes, or None if unset."""
        row = self.query_one("SELECT image_bytes FROM visitor WHERE uuid = %s", (visitor_uuid,))
        if row is None or row[0] is None:
            return None
        return bytes(row[0])

    def set_name(self, visitor_uuid: str, name: str) -> None:
        self.execute("UPDATE visitor SET name = %s WHERE uuid = %s", (name, visitor_uuid))

    def prune_cooldowns(self, max_age_seconds: float = 3600.0) -> None:
        """Drop stale cooldown entries so the map doesn't grow forever."""
        cutoff = time.monotonic() - max_age_seconds
        stale = [u for u, t in self._last_write.items() if t < cutoff]
        for u in stale:
            del self._last_write[u]
