# Vision Service

Headless GPU vision for the platform. Ships two detection modes, each running
as its own worker subprocess per camera (isolated so the face runtime and the
YOLO runtime never share a process — see `requirements.txt` vs
`requirements-object.txt`):

- **PEOPLE** (`workers/people.py` / `engines/face.py`) — face/visitor
  recognition at entrance cameras. Reads its camera → detects faces on the
  RTX 3090 (insightface `buffalo_l`: SCRFD + ArcFace 512-d) → matches against
  PostgreSQL + pgvector by cosine distance → bumps `last_seen` or enrolls a
  new anonymous visitor (blank name/email, role `guest`) with a cropped JPEG.
  Each detection also fires a fire-and-forget `VISITOR_DETECTED` event to the
  API so the CMS Visitors page updates live. Staff name visitors later in
  the CMS.
- **OBJECT** (`workers/object.py` / `engines/object.py`) — product detection
  on a mat/table (the trained Latticelane YOLO model). Reads its camera →
  tiled YOLO inference → mat-ROI filter (`mat_roi.py`, calibrated via
  `scripts/calibrate_mat.py`) → majority-vote stabilization
  (`object_pipeline.py`) → fires `INVENTORY_UPDATE` once the mat's contents
  hold steady. This carries the **full current mix of products**, not a
  single best guess — see `packages/types/src/products.ts`'s
  `inventoryUpdateEventSchema`, which is a separate contract from the
  single-item `PRODUCT_DETECTED` event used by the browser-camera pipeline
  in `services/product-vision` (untouched by this).

## Prerequisites

- **Postgres with pgvector** — the `visitor` table + `vector` extension come from
  the Drizzle migrations in `packages/db` (`pnpm --filter @platform/db db:migrate`).
- **NVIDIA GPU + CUDA 12.x / cuDNN 8.9** (matches `onnxruntime-gpu` 1.18.x; with
  cuDNN 9 use onnxruntime-gpu ≥ 1.19).
- **Intel RealSense SDK 2.0** for `realsense` cameras; any USB webcam works for
  dev via the `opencv` backend.
- `insightface` builds a Cython extension on install — MSVC Build Tools or a
  prebuilt wheel.
- **For OBJECT (product) cameras only**: a second, separate venv with
  `requirements-object.txt` (ultralytics/torch) — see below. Never installed
  into the same venv as `requirements.txt` (cuDNN version clash).

## Run (native Windows — primary deployment)

The supervisor spawns each camera's worker subprocess using its own
interpreter (`sys.executable`) — so every worker it spawns runs under
whichever venv you launched `python -m vision` from. Since PEOPLE needs
`requirements.txt` and OBJECT needs `requirements-object.txt` (and the two
must never share a venv — see the cuDNN clash note in `requirements.txt`),
running both modes means running **two separate `python -m vision`
processes**, each from its own venv, each with its own `.env`/`VISION_CAMERAS`
containing *only* the camera(s) that venv's dependencies support — a camera
whose mode's package isn't installed in that venv will crash-loop (backoff
restart) rather than being skipped, since the supervisor doesn't currently
detect that ahead of spawning. Point each process at a different `.env` (e.g.
`.env.people` / `.env.object`) or just filter `VISION_CAMERAS` per venv.

**Face (PEOPLE) setup:**
```powershell
cd services\vision
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # set VISION_DATABASE_URL, VISION_API_URL, BROADCAST_SECRET, VISION_CAMERAS
cd ..                       # run from services/ so the `vision` package resolves
python -m vision
```

**Object/product (OBJECT) setup** — separate venv:
```powershell
cd services\vision
python -m venv .venv-object
.venv-object\Scripts\activate
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
pip install -r requirements-object.txt
copy .env.example .env      # same .env as above — set VISION_OBJECT_* and an OBJECT entry in VISION_CAMERAS
python scripts/calibrate_mat.py   # once per physical camera/mat setup — click the mat's 4 corners
cd ..
python -m vision
```

`VISION_CAMERAS` is a JSON array — one entry per camera, `mode: "PEOPLE"` or
`"OBJECT"`. `buffalo_l` (~300 MB) auto-downloads into `./models` on first
start for face cameras; the OBJECT model (`models/latticelane-detector.pt`)
is already checked in. For unattended startup, register `python -m vision`
(with the right venv's python, working dir `services/`) in Task Scheduler
("At startup") or as an NSSM service.

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
- `python scripts/calibrate_mat.py` — click the mat's 4 corners to (re)calibrate
  `VISION_OBJECT_MAT_ROI_PATH`. Re-run any time the mat camera or mat physically
  moves. `--source path/to/image.jpg` calibrates from a saved frame instead of
  a live camera.

## Object detection (mat product detector)

Detects the trained Latticelane product set (Perpetual Calendar, A6 Raw Press
Lock Journal, Pen, Leather Roll Up Organizer, Card Holder) sitting on a
calibrated mat region, with the same tiled-inference + mat-ROI + majority-vote
approach validated in the sibling `Latticelane_products` project.

Unlike the face path's single-item `VISITOR_DETECTED`, an OBJECT camera emits
`INVENTORY_UPDATE` — the **full current mat contents** (every product
currently on the mat, with counts), not a single best guess. This is a
separate contract from the browser-camera single-product pipeline in
`services/product-vision` (see `packages/types/src/products.ts`:
`inventoryUpdateEventSchema` vs `productDetectedEventSchema`) — that pipeline
is untouched by this.

Flow: `workers/object.py` → `object_pipeline.py` (camera loop) →
`engines/object.py` (tiled YOLO) → `mat_roi.py` (on-mat filter) →
majority-vote stabilizer → `events.py`'s `emit_inventory()` →
`POST /api/internal/vision-event` → `apps/api/src/routes/internal.ts`'s
`INVENTORY_UPDATE` case → `apps/api/src/services/inventory.ts`'s
`resolveMatInventory()` (batch label→product lookup) →
`apps/api/src/ws/gateway.ts`'s `applyMatInventoryUpdate()` → the mapped
screen's `mat-inventory` experience template, plus a live `INVENTORY_UPDATE`
to CMS/UE listeners.

Class names are mapped to the CMS's `detectionLabel` slugs (lowercase/digits/
underscores) in `engines/object.py`'s `CLASS_NAME_TO_DETECTION_LABEL` — a
product's `detectionLabel` in the CMS product catalogue must match one of
these exactly for it to resolve.
