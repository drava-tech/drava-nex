# Face Vision Service

Entrance visitor recognition: reads the Intel RealSense colour stream, detects
faces on the RTX 3090 (insightface `buffalo_l`: SCRFD detector + ArcFace 512-d
embeddings), matches them against PostgreSQL + pgvector by cosine distance and
either bumps an existing visitor's `last_seen` or enrolls a new anonymous
visitor (blank name/email, role `guest`) with a cropped face JPEG. Staff assign
names later in the CMS **Visitors** page.

## Prerequisites

- **Postgres with pgvector** — the `visitor` table and `vector` extension come
  from the Drizzle migrations in `packages/db` (`pnpm --filter @platform/db db:migrate`).
  The DB server must have pgvector installed first (image `pgvector/pgvector:pg16`,
  or `apt install postgresql-16-pgvector`); `CREATE EXTENSION` needs superuser once.
- **NVIDIA GPU + CUDA 12.x / cuDNN 8.9** on the host (matches `onnxruntime-gpu` 1.18.x
  pinned in `requirements.txt`; with cuDNN 9 use onnxruntime-gpu ≥ 1.19).
- **Intel RealSense SDK 2.0** for the `realsense` backend
  (https://github.com/IntelRealSense/librealsense/releases). Any USB webcam
  works for development via the `opencv` backend.
- `insightface` compiles a Cython extension on install — have MSVC Build Tools
  available, or install a prebuilt wheel.

## Run (native Windows — the primary deployment)

```powershell
cd services\face-vision
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # set FACE_DATABASE_URL etc.
python -m src
```

The `buffalo_l` pack (~300 MB) auto-downloads into `./models` on first start.

This service is intentionally **not** part of the Docker compose stack on
Windows: Docker Desktop cannot pass the RealSense USB device into a container.
For a future Linux host, `Dockerfile.server` + the `face-vision` compose
profile exist. For unattended startup on Windows, register `python -m src`
(with the venv's python) in Task Scheduler ("At startup") or as an NSSM service.

## Camera placement

Aim the camera outward across the room toward the entrance, not straight
down — steep top-down angles distort facial proportions and shadow the eyes.
Small background faces are ignored (`FACE_MIN_BBOX_PX`); a person only triggers
identification once they are close enough to fill a meaningful part of the frame.
The RealSense unit must be dedicated to this service (it cannot be shared with
the product-vision capture client).

## Scripts

- `python scripts/test_camera.py` — grab a frame from the configured backend.
- `python scripts/enroll_test.py a.jpg b.jpg …` — pairwise cosine distances to
  tune `FACE_MATCH_MAX_DISTANCE` (no DB writes).
- `python scripts/purge_images.py [--dry-run]` — delete face JPEGs older than
  `FACE_IMAGE_RETENTION_DAYS`, keeping the embedding rows (anonymization).
  Schedule daily via Task Scheduler.

## How matching works

pgvector's `<=>` operator returns cosine distance (1 − cosine similarity) over
the HNSW-indexed `visitor.embedding` column. A track is identified once from
its best (sharpest/largest) face view; distance ≤ `FACE_MATCH_MAX_DISTANCE`
(default 0.5) is a match, anything above enrolls a new visitor. The default is
deliberately strict: a false merge pollutes an identity file, while a false
new-enroll is just a duplicate row that staff can spot in the CMS. Per-visitor
`last_seen` writes are debounced by `FACE_COOLDOWN_SECONDS`, and a simple IoU
tracker keeps concurrent people in a group separated so each is matched or
enrolled individually.
