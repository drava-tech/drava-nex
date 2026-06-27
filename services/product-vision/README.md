# Product Vision Service

Python service that detects physical products using a trained YOLOv8 model and
sends detection events to the CMS API gateway over WebSocket.

## Prerequisites

1. **Python 3.10+**
2. **Intel RealSense SDK 2.0** (for the RealSense camera backend)
   - Download: https://github.com/IntelRealSense/librealsense/releases/latest
   - Install the Windows installer, then `pip install pyrealsense2` will work.
   - Or set `VISION_CAMERA_BACKEND=opencv` to use a regular USB webcam instead.

## Setup

```bash
cd services/product-vision

# 1. Create virtual environment
python -m venv .venv

# 2. Activate it (Windows)
.venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy and fill in environment variables
copy .env.example .env
# Edit .env — set CMS_WEBSOCKET_URL and VISION_CAMERA_ID at minimum

# 5. Test your camera
python scripts/test_camera.py
```

---

## Training a new product (end-to-end)

### Step 1 — Capture training images

Point the camera at your product from many angles, distances, and lighting conditions.
The capture script enforces a strict budget (via `budget.json`), rejects blurry images, and avoids duplicates.

```bash
# Capture positive images (product in frame)
python scripts/capture_images.py --product smart-glasses-v1 --target positive --count 200

# Capture background images (no product, varied backgrounds)
python scripts/capture_images.py --product smart-glasses-v1 --target background --count 100
```

Images are saved to `datasets/smart-glasses-v1/raw/positive/` and `raw/background/`.
If you over-capture, use the trim script to enforce budget and diversity:
```bash
python scripts/trim_dataset.py --product smart-glasses-v1 --positive 200 --dedup
```

### Step 2 — Annotate images

Draw bounding boxes around your product in each positive image.

**Free tools:**
- **[LabelImg](https://github.com/HumanSignal/labelImg)** — desktop app, saves YOLO format directly
  ```bash
  pip install labelImg
  labelImg datasets/smart-glasses-v1/raw/positive
  # Select "YOLO" format in the toolbar. Labels auto-save as .txt alongside each image.
  ```
- **[Roboflow](https://roboflow.com)** — browser-based, free tier, export as YOLO v8.

Ensure your class name is `smart_glasses` (matches `data.yaml` and the CMS Detection Label).

### Step 3 — Split dataset

```bash
python scripts/split_dataset.py --product smart-glasses-v1
```

Splits 70% train / 15% val / 15% test into `datasets/smart-glasses-v1/images/` and `labels/`.

### Step 4 — Train

```bash
# Full run (recommended: GPU with 4GB+ VRAM)
python scripts/train.py --data datasets/smart-glasses-v1/data.yaml --epochs 100

# Quick sanity check (CPU, ~1 min)
python scripts/train.py --data datasets/smart-glasses-v1/data.yaml --epochs 1
```

Training output is in `runs/detect/train/`. Best model: `runs/detect/train/weights/best.pt`.

### Step 5 — Evaluate

Validate the model on the unseen test split:
```bash
python scripts/evaluate.py --data datasets/smart-glasses-v1/data.yaml
```
Check `mAP50` metrics and the confusion matrix in `runs/detect/val/`.

### Step 6 — Promote & Export the model

Promote the best model to production:
```bash
copy runs\detect\train\weights\best.pt models\production\smart-glasses-v1.pt
```

(Optional) Export to ONNX for edge devices:
```bash
python scripts/export.py --format onnx
```

Update `VISION_MODEL_PATH` in `.env` to point to the promoted file.

### Step 7 — Live Test & Run

Test the model live with your camera before connecting to the CMS:
```bash
python scripts/live_test.py
```

Finally, run the service:
```bash
python src/main.py
```

The service connects to `CMS_WEBSOCKET_URL`, opens the camera, and starts sending
`PRODUCT_DETECTED` / `PRODUCT_LOST` events when your product appears or disappears.

---

## Adding a new product

1. Create a new dataset folder: `datasets/my-product-v1/`
2. Copy `data.yaml` and update `path` and `names`
3. Repeat Steps 1–5 above with `--product my-product-v1`
4. In the CMS, set the product's **Detection Label** to the class name in your `data.yaml`

---

## Project structure

```
services/product-vision/
├── src/
│   ├── main.py              Entry point
│   ├── camera.py            Camera backend (RealSense / OpenCV)
│   ├── detector.py          YOLOv8 inference
│   ├── stability.py         Debounce filter
│   ├── websocket_client.py  CMS gateway client
│   └── config.py            Environment config
├── scripts/
│   ├── capture_images.py    Collect raw data (budget, blur & dedup gating)
│   ├── trim_dataset.py      Enforce image budgets & deduplicate
│   ├── split_dataset.py     70/15/15 dataset split
│   ├── train.py             YOLOv8 training
│   ├── evaluate.py          Compute metrics (mAP50, PR curves)
│   ├── live_test.py         Test detection on live camera feed
│   ├── export.py            Export model to ONNX/engine
│   └── test_camera.py       Camera hardware sanity check
├── datasets/
│   └── smart-glasses-v1/   (add more products here)
├── models/
│   ├── candidates/          Intermediate checkpoints (gitignored)
│   └── production/          Promoted best model (gitignored)
├── runs/                    Training outputs (gitignored)
├── requirements.txt
├── .env.example
└── Dockerfile
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `VISION_MODEL_PATH` | — | Path to `.pt` model file (required) |
| `VISION_CONFIDENCE_THRESHOLD` | `0.80` | Min detection confidence |
| `VISION_CAMERA_ID` | — | Camera ID sent in events (required) |
| `CMS_WEBSOCKET_URL` | — | WS URL of the CMS API (required) |
| `VISION_CAMERA_BACKEND` | `realsense` | `realsense` or `opencv` |
| `VISION_RS_WIDTH` | `1280` | RealSense stream width |
| `VISION_RS_HEIGHT` | `720` | RealSense stream height |
| `VISION_RS_FPS` | `30` | RealSense FPS |
| `VISION_OPENCV_DEVICE_INDEX` | `0` | OpenCV device index |
| `VISION_STABILITY_FRAMES` | `5` | Frames to confirm detection |
| `VISION_LOST_FRAMES` | `10` | Frames to confirm product lost |
