# Vision Service

Headless GPU vision for the platform. **This iteration ships face detection
only** (people at entrance cameras); object/product detection is stubbed and
added later without restructuring (see `workers/object.py`, `engines/object.py`).

A **supervisor** owns the camera fleet and runs **one worker subprocess per
camera** (isolated so the face runtime and the future YOLO runtime never share a
process). Each people-worker: reads its camera → detects faces on the RTX 3090
(insightface `buffalo_l`: SCRFD + ArcFace 512-d) → matches against
PostgreSQL + pgvector by cosine distance → bumps `last_seen` or enrolls a new
anonymous visitor (blank name/email, role `guest`) with a cropped JPEG. Each
detection also fires a fire-and-forget `VISITOR_DETECTED` event to the API so
the CMS Visitors page updates live. Staff name visitors later in the CMS.

## Prerequisites

- **Postgres with pgvector** — the `visitor` table + `vector` extension come from
  the Drizzle migrations in `packages/db` (`pnpm --filter @platform/db db:migrate`).
- **NVIDIA GPU + CUDA 12.x / cuDNN 8.9** (matches `onnxruntime-gpu` 1.18.x; with
  cuDNN 9 use onnxruntime-gpu ≥ 1.19).
- **Intel RealSense SDK 2.0** for `realsense` cameras; any USB webcam works for
  dev via the `opencv` backend.
- `insightface` builds a Cython extension on install — MSVC Build Tools or a
  prebuilt wheel.

## Run (native Windows — primary deployment)

```powershell
cd services\vision
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # set VISION_DATABASE_URL, VISION_API_URL, BROADCAST_SECRET, VISION_CAMERAS
cd ..                       # run from services/ so the `vision` package resolves
python -m vision
```

`VISION_CAMERAS` is a JSON array — one entry per camera. `buffalo_l` (~300 MB)
auto-downloads into `./models` on first start. For unattended startup, register
`python -m vision` (with the venv python, working dir `services/`) in Task
Scheduler ("At startup") or as an NSSM service.

Not part of the Docker stack on Windows: Docker Desktop can't pass USB/RealSense
cameras into a container. `Dockerfile.server` exists for a future Linux host.

## Camera placement

Aim each camera outward across the room toward the entrance, not straight down.
Small background faces are ignored (`VISION_MIN_BBOX_PX`); a person triggers
identification only once close enough to fill a meaningful part of the frame.

## Scripts

- `python scripts/test_camera.py` — grab a frame from the configured backend.
- `python scripts/enroll_test.py a.jpg b.jpg …` — pairwise cosine distances to
  tune `VISION_MATCH_MAX_DISTANCE` (no DB writes).
- `python scripts/purge_images.py [--dry-run]` — delete face JPEGs older than
  `VISION_IMAGE_RETENTION_DAYS`, keeping embeddings (anonymization). Schedule daily.

## Adding object detection later

Fill `workers/object.py` + `engines/object.py`; add `requirements-object.txt`
(ultralytics/torch, cuDNN 9, separate venv/process); implement the
`PRODUCT_DETECTED` case in `apps/api/src/routes/internal.ts`; add an `OBJECT`
entry to `VISION_CAMERAS`. No directory moves, no API/type changes.
