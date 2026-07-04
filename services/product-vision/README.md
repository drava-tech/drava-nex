# Product Vision Service

YOLOv8 product detection for the CMS platform, in two parts:

1. **Inference server** (`src/server/`) — FastAPI + CUDA. The display page in the
   browser captures camera frames, sends them as JPEG over WebSocket to
   `/vision/ws`, and gets detection boxes back. This is the only runtime
   detection path.
2. **Training tooling** (`scripts/`, `datasets/`) — capture, label, train,
   evaluate, and promote new product models.

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
curl http://localhost/vision/readyz   # via nginx; 200 when model is warm on CUDA
```

> **Fresh clone note:** `models/production/coster-v1.pt` is gitignored. Restore
> it before building the image and verify against `models/production/checksums.txt`.
> The compose service sets `VISION_SERVER_MODEL_SHA256`, so a wrong weight fails
> at startup.

### Run locally (development)

```bash
cd services/product-vision
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements-server.txt

set PYTHONPATH=src
set VISION_SERVER_MODEL_PATH=models/production/coster-v1.pt
python -m server
# WS:   ws://localhost:8000/vision/ws
# HTTP: http://localhost:8000/vision/healthz | /vision/readyz | /vision/info
```

### Protocol

- **Client → server (binary):** `[type:1B = 0x01][frameId:8B uint64 LE][JPEG bytes]`
- **Server → client (JSON):** `ready` on connect, then per frame
  `{type:"detections", frameId, model, inference, source, detections:[{classId, label, confidence, box}]}`
  with boxes normalized 0–1. Errors: `{type:"error", code, message}`
  (`BAD_FRAME | FRAME_TOO_LARGE | RATE_LIMITED | BUSY | INFERENCE_TIMEOUT | INTERNAL`).

The browser side lives in `packages/vision-browser` (`ServerDetectionClient`,
`captureJpegFrame`, `StabilityFilter`) and `apps/cms/src/hooks/useServerDetection.ts`.
Debug overlay: open a display page with `?visionDebug=1`.

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

```bash
cd services/product-vision
set PYTHONPATH=src
.venv\Scripts\python -m pytest tests/server
```

## Training a new product

> **Known issue (coster-v1):** `scripts/split_dataset.py` only reads `raw/positive/` —
> it never wires `raw/background/` into the train/val/test split, so the deployed
> model was trained with zero true-negative examples. Being single-class with no
> concept of "not-coster," it is prone to false positives on backgrounds/other
> objects. Fix `split_dataset.py` to include background images as empty-label
> negatives, then retrain, before the false-positive rate matters for production.
> Current mitigation (not a fix): confidence threshold raised to 0.85 and
> `stabilityFrames` to 4 in `packages/vision-browser/src/constants.ts`.

Uses `requirements.txt` (separate from the server deps) and a local camera.

```bash
pip install -r requirements.txt
copy .env.example .env     # set VISION_CAMERA_ID etc. — used by the capture scripts
```

1. **Capture** — `python scripts/capture_images.py --product my-product-v1 --target positive --count 200`
   (and `--target background --count 100`). Over-captured? `python scripts/trim_dataset.py --product my-product-v1 --dedup`
2. **Annotate** — [LabelImg](https://github.com/HumanSignal/labelImg) or Roboflow, YOLO format.
   Class name must match the CMS product's **Detection Label**.
3. **Split** — `python scripts/split_dataset.py --product my-product-v1`
4. **Train** — `python scripts/train.py --data datasets/my-product-v1/data.yaml --epochs 100`
5. **Evaluate** — `python scripts/evaluate.py --data datasets/my-product-v1/data.yaml`
6. **Promote** — `copy runs\detect\train\weights\best.pt models\production\my-product-v1.pt`,
   update `checksums.txt`, point `VISION_SERVER_MODEL_PATH` (and the compose SHA env) at it,
   rebuild the image.
7. **Live test** — `python scripts/live_test.py` (local camera, before deploying).

`scripts/parity_test.py` compares `.onnx` vs `.pt` outputs (needs `pip install onnxruntime`).

## Project structure

```
services/product-vision/
├── src/
│   ├── server/              FastAPI CUDA inference server (the runtime)
│   │   ├── app.py           App factory + lifespan (loads model before serving)
│   │   ├── engine.py        YOLO on CUDA: load, warm-up, checksum, inference
│   │   ├── ws.py            /vision/ws — binary frames in, JSON detections out
│   │   ├── http.py          /vision/healthz, /readyz, /info
│   │   ├── protocol.py      Frame header unpack + response models
│   │   └── settings.py      VISION_SERVER_* env config
│   ├── camera.py            Camera backends (RealSense / OpenCV) — training scripts only
│   └── config.py            Env config for the training scripts
├── scripts/                 capture / label / split / train / evaluate / export / live_test
├── datasets/                Training data (one folder per product)
├── models/production/       Promoted weights (gitignored) + checksums.txt
├── tests/server/            pytest suite for the server
├── requirements-server.txt  Pinned server deps (torch cu121)
├── requirements.txt         Training tooling deps
└── Dockerfile.server        Server image — bakes the production weight
```
