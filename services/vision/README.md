# Vision Service

The canonical home for all platform vision. Two independent services live here:

| | Face vision (this directory) | Object detection (`object_detection/`) |
|---|---|---|
| What | Visitor recognition at entrance cameras | Product detection → screen takeover |
| Runtime | Supervisor + one worker subprocess per camera | FastAPI WebSocket inference server |
| Frames from | Cameras attached to this host | The **browser** (CMS display page → `/vision/ws`) |
| GPU stack | insightface + onnxruntime-gpu | ultralytics + PyTorch |
| Start | `python -m vision` | `python -m vision.object_detection.server` |
| Deps | `requirements.txt` | `object_detection/requirements.txt` |

**They must never share a process or a venv.** onnxruntime-gpu and torch each
bundle their own CUDA + cuDNN; loading both in one interpreter is the conflict
this split exists to avoid. Separate venvs, separate processes, separate
container images (`Dockerfile.server` vs `object_detection/Dockerfile.server`),
one shared build context.

Object detection has **no camera worker here** — its frames come from the
browser, so an `OBJECT` entry in `VISION_CAMERAS` is rejected with a pointer to
the inference server. See [object_detection/README.md](object_detection/README.md).

## Face vision

A **supervisor** owns the camera fleet and runs **one worker subprocess per
camera**. Each people-worker: reads its camera → detects faces on the RTX 3090
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

## Object detection

Lives in [`object_detection/`](object_detection/README.md) — moved here from the
former `services/product-vision`. It is a WebSocket inference server, not a
camera worker: the CMS display page captures frames in the browser and posts
them to `/vision/ws`.

```powershell
cd services\vision\object_detection
python -m venv .venv                    # SEPARATE venv — never install into ..\.venv
.venv\Scripts\pip install -r requirements.txt
cd ..\..
vision\object_detection\.venv\Scripts\python.exe -m vision.object_detection.server
```

`workers/object.py` and `engines/object.py` are intentionally not implemented and
raise with a pointer to the above: a host-side OBJECT worker would be a second
camera runtime competing with the browser for the device and double-firing
`PRODUCT_DETECTED`. The supervisor rejects `OBJECT` entries in `VISION_CAMERAS`
for the same reason.

Both `PRODUCT_DETECTED` and `PRODUCT_LOST` are handled end to end by the API
(`apps/api/src/routes/internal.ts` → `gateway.applyProductDetection` /
`clearProductDetection`), so `events.emit_product()` here would work if a
headless emitter is ever added — it just isn't the production path today.
