# Object Detection (`vision.object_detection`)

YOLOv8 product detection for the CMS platform. Lives under `services/vision`
(the canonical vision service) but runs as **its own process with its own
venv** — ultralytics/PyTorch and the face pipeline's insightface/onnxruntime-gpu
bundle conflicting CUDA + cuDNN runtimes and cannot share one interpreter.

> Moved here from `services/product-vision` (that directory no longer exists).
> The import root is now the `vision` package: run everything from `services/`.

Two parts:

1. **Inference server** (`server/`) — FastAPI + CUDA. The display page in the
   browser captures camera frames, sends them as JPEG over WebSocket to
   `/vision/ws`, and gets detection boxes back. **This is the only runtime
   detection path** — there is no host-side object camera worker, and the
   `vision` supervisor rejects `OBJECT` entries in `VISION_CAMERAS` for that
   reason.
2. **Training tooling** (`scripts/`, `training/`, `datasets/`) — capture, label,
   split, train, evaluate, and promote new product models.

## Inference server

### Run in Docker (production)

The model weight is **baked into the image** at build time, so the container is
self-contained — no volume mounts needed.

```bash
# From the repo root (requires an NVIDIA GPU; CPU fallback is disabled)
pnpm prod:build          # builds vision-inference along with the stack
pnpm vision-server:up    # starts it (compose profile: vision-server)
pnpm vision-server:logs

# Health
curl http://localhost/vision/readyz   # via nginx; 200 only once the model is warm on CUDA
```

The compose build context is `services/vision` with
`dockerfile: object_detection/Dockerfile.server`, because the server imports
`vision.object_detection.server.*` and needs the package parent on the path.

> **Fresh clone note:** `models/production/coster-v1.pt` is gitignored. Restore
> it before building the image and verify against `models/production/checksums.txt`.
> The compose service sets `VISION_SERVER_MODEL_SHA256`, so a wrong weight fails
> at startup.

### Run locally (development)

```powershell
cd services\vision\object_detection
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # set VISION_SERVER_MODEL_PATH etc.

cd ..\..                    # run from services/ so the `vision` package resolves
vision\object_detection\.venv\Scripts\python.exe -m vision.object_detection.server
# WS:   ws://localhost:8000/vision/ws
# HTTP: http://localhost:8000/vision/healthz | /vision/readyz | /vision/info
```

`object_detection\run-server.bat` does exactly the above and is what the
Scheduled Task on the Windows host runs.

### Protocol

- **Client → server (binary):** `[type:1B = 0x01][frameId:8B uint64 LE][JPEG bytes]`
- **Server → client (JSON):** `ready` on connect, then per frame
  `{type:"detections", frameId, timestamp, model, inference, source, detections:[{classId, label, confidence, box}]}`
  with boxes normalized 0–1. Errors: `{type:"error", code, message}`
  (`BAD_FRAME | FRAME_TOO_LARGE | RATE_LIMITED | BUSY | INFERENCE_TIMEOUT | INTERNAL`).

The browser side lives in `packages/vision-browser` (`ServerDetectionClient`,
`captureJpegFrame`, `StabilityFilter`) and `apps/cms/src/hooks/useServerDetection.ts`.
Debug overlay: open a display page with `?visionDebug=1`.

**Labels are the contract.** A YOLO class name must be a valid CMS *Detection
Label* — lowercase letters, digits and underscores only (`detectionLabelSchema`
in `packages/types`) — and must match a product's Detection Label exactly, or
`resolveDetectedProduct` rejects it. `engine.load()` validates every class name
at startup rather than letting the mismatch fail silently at 30 fps.

**Stability.** The server reports raw per-frame detections; it never decides a
takeover. The debounce lives in `packages/vision-browser/src/stability.ts`
(`stabilityFrames` hits to fire `PRODUCT_DETECTED`, `lostFrames` misses to fire
`PRODUCT_LOST`), so a single noisy frame cannot flip a screen. Confidence is
filtered twice: `VISION_SERVER_CONF_THRESHOLD` at inference, then
`DETECTION_MIN_CONFIDENCE` again in the API before a product is resolved.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `VISION_SERVER_MODEL_PATH` | `/app/models/production/coster-v1.pt` | Path to `.pt` weight |
| `VISION_SERVER_DEVICE` | `cuda:0` | Must be CUDA; startup fails otherwise |
| `VISION_SERVER_CONF_THRESHOLD` | `0.4` | Wired to `DETECTION_MIN_CONFIDENCE` in compose |
| `VISION_SERVER_MODEL_SHA256` | unset | Optional startup checksum verification |
| `VISION_SERVER_MAX_FRAME_BYTES` | `1048576` | Frame size cap |
| `VISION_SERVER_MIN_FRAME_INTERVAL_MS` | `100` | Rate limit (10 FPS ceiling) |
| `VISION_SERVER_MAX_CONNECTIONS` | `4` | Connection cap |
| `VISION_SERVER_INFERENCE_TIMEOUT_MS` | `2000` | Per-frame timeout |
| `VISION_SERVER_PORT` | `8000` | uvicorn port |

### Tests

The suite runs **without a GPU, without torch and without the production
weight** — `server/runtime.py` keeps torch behind a lazy import and `engine.py`
imports ultralytics/cv2/numpy only inside `load()`/`infer()`, so the protocol,
HTTP and WebSocket layers stay importable on any machine.

```powershell
cd services\vision\object_detection
python -m venv .venv-test
.venv-test\Scripts\pip install -r requirements-test.txt
cd ..\..                       # run from services/
vision\object_detection\.venv-test\Scripts\python.exe -m pytest vision/object_detection/tests -q
```

The full server venv (`requirements.txt`) is a superset and runs the same command.

## Training a new product

Uses `requirements-training.txt` (separate from the server deps) and a local
camera. Run every script from `services/` as a module:

```powershell
cd services\vision\object_detection
pip install -r requirements-training.txt
copy .env.example .env     # set VISION_CAMERA_BACKEND / index — used by the capture scripts
cd ..\..
```

1. **Capture** — `python -m vision.object_detection.scripts.capture_images --product my-product-v1 --target positive --count 200`
   **and** `--target background --count 100`. Background images are true
   negatives and are required, not optional (see below). Over-captured?
   `python -m vision.object_detection.scripts.trim_dataset --product my-product-v1 --dedup`
2. **Annotate** — [LabelImg](https://github.com/HumanSignal/labelImg) or Roboflow, YOLO format.
   Class name must match the CMS product's **Detection Label** (`[a-z0-9_]+`).
3. **Split** — `python -m vision.object_detection.scripts.split_dataset --product my-product-v1`
4. **Train** — `python -m vision.object_detection.scripts.train --data vision/object_detection/datasets/my-product-v1/data.yaml --epochs 100`
5. **Evaluate** — `python -m vision.object_detection.scripts.evaluate --data vision/object_detection/datasets/my-product-v1/data.yaml`
6. **Promote** — copy `runs/detect/train/weights/best.pt` to
   `models/production/my-product-v1.pt`, update `checksums.txt`, point
   `VISION_SERVER_MODEL_PATH` (and the compose SHA env) at it, rebuild the image.
7. **Live test** — `python -m vision.object_detection.scripts.live_test` (local camera, before deploying).

`scripts/parity_test.py` compares `.onnx` vs `.pt` outputs (needs `pip install onnxruntime`).

### Negatives — the coster-v1 lesson

The original `split_dataset.py` only read `raw/positive/`, so `raw/background/`
never reached the split and the deployed `coster-v1` model was trained with
**zero true negatives**. A single-class model with no concept of "not-coster"
false-positives on backgrounds and unrelated objects; raising the confidence
threshold only masks it.

`split_dataset.py` now:

- includes `raw/background/` in train/val/test,
- writes an **empty** `.txt` label for each negative (how YOLO encodes "nothing
  in this image" — a *missing* file makes ultralytics silently drop the image),
- stratifies per source so every split holds both positives and negatives,
- groups byte-identical duplicates so a re-saved image cannot leak from train
  into val/test, and
- refuses a stem that appears in both `positive/` and `background/`.

Covered by `tests/scripts/test_split_dataset.py`. **`coster-v1` still needs a
retrain** with negatives before its false-positive rate matters in production;
until then the mitigation is the raised threshold and `stabilityFrames` in
`packages/vision-browser/src/constants.ts`.

## Project structure

```
services/vision/object_detection/
├── server/                    FastAPI CUDA inference server (the runtime)
│   ├── app.py                 App factory + lifespan (loads/warms model before serving)
│   ├── engine.py              YOLO on CUDA: load, warm-up, checksum, class-name check, inference
│   ├── runtime.py             Lazy torch access — keeps the rest importable without a GPU
│   ├── ws.py                  /vision/ws — binary frames in, JSON detections out
│   ├── http.py                /vision/healthz, /readyz, /info
│   ├── protocol.py            Frame header unpack + response models
│   └── settings.py            VISION_SERVER_* env config
├── training/                  Camera backends + env config — training scripts only
├── scripts/                   capture / label / split / train / evaluate / export / live_test
├── datasets/                  Training data (one folder per product; contents gitignored)
├── models/production/         Promoted weights (gitignored) + checksums.txt
├── tests/                     pytest suite — GPU-free
├── requirements.txt           Pinned inference-server deps (torch cu121)
├── requirements-training.txt  Training tooling deps
├── requirements-test.txt      GPU-free test deps
├── Dockerfile.server          Server image (build context: services/vision)
└── run-server.bat             Native Windows host launcher
```

Face vision (the sibling service) is `services/vision/` proper — see
[../README.md](../README.md).
