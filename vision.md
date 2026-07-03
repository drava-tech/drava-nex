# Migration Plan — Browser YOLO Inference → Server-Side GPU (RTX 3090) Inference

## Context

The repo is mid-migration: product detection recently moved from a native Python camera service (`services/product-vision`, cameras claimed via usbipd-win passthrough into Docker) to an all-browser pipeline (`getUserMedia → Web Worker → ONNX Runtime Web WASM → StabilityFilter → WS events`), committed locally as `c65cc1e` (2 commits ahead of origin, unpushed). This plan migrates the **authoritative inference** to a Python FastAPI service running Ultralytics YOLO `coster-v1.pt` on PyTorch CUDA FP32 on the NVIDIA RTX 3090 (confirmed present on this host: driver 596.36, 24 GB; Docker 29.5.3 / Compose v5.1.4). The browser keeps camera capture, local display, frame compression, box drawing, stabilization, and the existing `PRODUCT_DETECTED`/`PRODUCT_LOST` contracts to the Hono gateway — which keeps auth, product resolution, PostgreSQL, and business events unchanged. Browser ONNX stays behind a feature flag as rollback.

**User decisions already made (via Q&A):** LAN-only unauthenticated vision WS for phase 1 (documented token upgrade path) · keep `HOLD_PRODUCT=true` but **add a CMS reset button** to clear a held product (replacing the manual script) · keep confidence **0.4** wired to the same variable as `DETECTION_MIN_CONFIDENCE` · bounding-box overlay gated by `?visionDebug=1`.

---

## 1. Executive recommendation

Reuse `services/product-vision/` as the home of a new FastAPI server package (`src/server/`), containerized with a new `Dockerfile.server` + pinned `requirements-server.txt` (torch 2.5.1+cu121), exposed as compose service `vision-inference` under a new `vision-server` profile with Docker Compose GPU reservation, routed through nginx at `/vision/ws` (lazy-DNS resolver pattern so nginx boots when the profile is down). Browser gains a parallel hook `useServerDetection.ts` sharing camera acquisition, `StabilityFilter`, and gateway contracts with the existing `useCameraDetection.ts`, switched by `NEXT_PUBLIC_VISION_INFERENCE_MODE=browser|server`. **Zero changes to detection business logic in `apps/api`** — the only API change is a small admin "reset detection" route + gateway export for the new CMS button. Frames go browser → nginx → FastAPI directly; the Hono gateway never sees JPEG bytes.

## 2. Repository areas inspected

- Browser: `apps/cms/src/hooks/useCameraDetection.ts`, `apps/cms/src/workers/detection.worker.ts`, `packages/vision-browser/` (all src + package.json), `apps/cms/public/display/` (models + ~80 MB ORT wasm), `apps/cms/src/app/display/_components/*` (LiveScreenPlayer, CameraStatusOverlay, CameraPreviewOverlay, ProductShowcaseRenderer, ContentPickerOverlay), `apps/cms/src/hooks/useScreenWebSocket.ts`, `apps/cms/next.config.mjs`, `apps/cms/package.json`, `apps/cms/src/middleware.ts`, `apps/cms/src/lib/display/client-urls.ts`, `apps/cms/src/app/(dashboard)/screens/`.
- API: `apps/api/src/index.ts`, `apps/api/src/ws/gateway.ts`, `apps/api/src/services/detection.ts`, `apps/api/src/routes/{products,screens,api-keys,devices,setup}.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/lib/{auth,camera-map,load-env}.ts`, `apps/api/Dockerfile`, `apps/api/test/*`.
- DB/types: `packages/db/src/schema/{products,api-keys,auth,devices}.ts`, `packages/db/src/queries/{products,api-keys}.ts`, `packages/types/src/{index,products}.ts`, `packages/db/test/products.integration.test.ts`.
- Python: `services/product-vision/` entire tree (src, scripts, models, datasets, Dockerfile, README, env files, requirements).
- Infra: `infra/docker/docker-compose.yml`, `infra/docker/docker-compose.local.yml`, `infra/nginx/{default.conf,nginx.conf}`, `infra/scripts/reset-detection.js`, root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, root `.env`/`.env.example`/`.env.production`, `.doc/*`.
- Global searches performed for every term in the audit checklist (useCameraDetection, WebGPU, onnxruntime-web, InferenceSession, coster-v1, PRODUCT_DETECTED/LOST, STREAM_PUBLISH/SUBSCRIBE, detection_label, DETECTION_MIN_CONFIDENCE, getUserMedia, createImageBitmap, FastAPI, uvicorn, ultralytics, torch, CUDA, OpenCV, RealSense, nvidia/GPU compose config, nginx upgrade headers, 192.168.1.250).

## 3. Existing detection architecture discovered

Two generations coexist:

1. **Legacy native service** — `services/product-vision/src/main.py`: OpenCV/RealSense camera → `detector.py` (Ultralytics `YOLO(model).predict(conf=…)`, no device selection, CPU) → `stability.py` (IDLE↔DETECTED) → `websocket_client.py` emits `PRODUCT_DETECTED`/`PRODUCT_LOST`/`CAMERA_*` + MJPEG preview frames to the Hono gateway. Wired in compose under `profiles: [vision]` (two containers, `/dev/video0|1` via usbipd-win, model mounted `ro`). No FastAPI/uvicorn anywhere in the repo; the service is a WS *client*.
2. **Browser detection (committed `c65cc1e`, current)** — `apps/cms/src/hooks/useCameraDetection.ts` + `apps/cms/src/workers/detection.worker.ts` + `packages/vision-browser/` runs the same model in the browser. Its docstring: "Fully replaces the native product-vision service."

The Hono gateway (`apps/api/src/ws/gateway.ts`) is the business hub either way: `PRODUCT_DETECTED` → camera→screen map (`CAMERA_SCREEN_MAP` env) → `resolveDetectedProduct` (confidence gate + `getProductByDetectionLabel`) → screen takeover with a `product-showcase` `CONTENT_UPDATE`.

## 4. Existing browser inference flow

`apps/cms/src/hooks/useCameraDetection.ts` (197 lines):
`SCREEN_TO_CAMERA` hardcoded (`main-screen→camera-01`, `screen-2→camera-02`) → `CAMERA_REGISTER` + 5 s heartbeats → `enumerateDevices()` label-hint pick (`Lenovo`/`RealSense`) → `getUserMedia` → hidden off-screen `<video>` (fixed, left:-9999px) → worker `new Worker(new URL("../workers/detection.worker.ts", import.meta.url))` → `load {modelUrl:"/display/models/coster-v1.onnx", label:"coster", confidenceThreshold:0.4}` → on `loaded`, `setInterval(captureAndDetect, 200)` → `createImageBitmap(video)` transferred to worker, **one-in-flight via `inflight` flag** → worker result → `StabilityFilter` (5 hits → `PRODUCT_DETECTED`, 10 misses → `PRODUCT_LOST`, suppressed by `HOLD_PRODUCT=true`) → `sendRaw()` from `useScreenWebSocket` (same `/ws/` gateway socket as content sync).

`packages/vision-browser/src/detector.ts`: `InferenceSession.create(modelUrl, { executionProviders: ["wasm"] })` — **WASM only; WebGPU is not used anywhere in app code** (the `.jsep.wasm` WebGPU-capable binary sits unused in `public/display/ort/`). Input `images` `[1,3,640,640]`, output `output0` `[1,5,8400]`; postprocess is an **argmax over the class channel — no NMS, no box decode**; wire contract carries only `label`+`confidence`. `preprocess.ts`: 640 letterbox, gray pad `rgb(114,114,114)`, RGB /255 NCHW via OffscreenCanvas. **No bounding-box drawing exists anywhere in the repo.**

Config constants are hardcoded in the hook (interval 200 ms, conf 0.4, stability 5/10, `HOLD_PRODUCT=true`) — duplicated with `packages/vision-browser` defaults and the Python service envs.

## 5. Existing Python vision flow

- `src/config.py` — frozen dataclass from env (`VISION_MODEL_PATH`, `VISION_CAMERA_ID`, `CMS_WEBSOCKET_URL` required; threshold default 0.80; live `.env` uses 0.40, `wss://192.168.1.250/ws/`, mkcert CA path).
- `src/camera.py` — OpenCV + RealSense backends. `src/detector.py` — single best `Detection(label, confidence, bbox-pixels)`; **no `device=` / CUDA anywhere in the repo**. `src/stability.py` — same state machine as the TS port. `src/websocket_client.py` — backoff 2 s→60 s; binary preview frames `struct.pack("<BQ", 1, ms) + jpeg` (MJPEG via `STREAM_PUBLISH`).
- `scripts/` — capture/trim/split/train/evaluate/export/live_test/label/pseudo_label/test_camera.
- `models/production/coster-v1.pt` (6.2 MB) + `coster-v1.onnx` (12.3 MB, byte-identical to the browser copy), `models/yolov8n.pt` base. Dataset `datasets/coster-v1` ~75 MB: split 51/10/12, `raw/positive` 146, **`raw/background` 100 images not included in the split** (metrics likely optimistic).
- `requirements.txt` — **all unpinned** (ultralytics, opencv-python, pyrealsense2, websockets, requests, python-dotenv, numpy). `Dockerfile`: python:3.11-slim + `libgl1 libglib2.0-0`, `CMD python src/main.py`, no EXPOSE.

## 6. Existing Hono and WebSocket flow

- `apps/api/src/index.ts`: Hono on `@hono/node-server` port 4000; `httpServer.on('upgrade')` → URLs starting `/ws` → `ws` `WebSocketServer({noServer:true})` from `createGateway()`.
- `apps/api/src/ws/gateway.ts` (631 lines): in-memory registries (screens/CMS/UE, `contentCache`, `viewStateCache`, `screenTakeover`, camera status/heartbeat, stream publisher/subscriber/cache). **No auth on upgrade or on screen/camera/product/stream messages; only `UE_REGISTER` verifies an API key** (`verifyApiKey` + `scopeSatisfies(scopes,'events:subscribe')`). Server pings every 30 s; camera heartbeat timeout 15 s → `service_offline`.
- `PRODUCT_DETECTED` (L477–536): `getCameraScreen(cameraId)` (env `CAMERA_SCREEN_MAP`, `apps/api/src/lib/camera-map.ts`) → status `detecting` → `resolveDetectedProduct` → on match: `WsContent{templateKey:'product-showcase', templateContent:{'product-showcase':{productId}}}`, `screenTakeover.set(screenId,label)`, `CONTENT_UPDATE` to screen sockets, `SCREEN_UPDATED` to CMS, `PRODUCT_DETECTED` to UE. `PRODUCT_LOST` (L538–574): only if takeover label matches → restore `getScreenContent(screenId)`.
- **Binary relay protocol already exists** (live-stream feature): publisher declares `STREAM_PUBLISH {streamId, format:'h264'|'mjpeg'}`, then sends binary `[frameType:1B uint8][timestamp:8B uint64 LE][payload]` (0=config JSON, 1=keyframe cached for late joiners, 2=delta); gateway reads only byte 0 and fans out verbatim to `STREAM_SUBSCRIBE`rs. Consumer: `packages/ui/src/templates/live-stream/use-live-stream.ts`.
- Contracts live in **`packages/types`** (`WsClientMessage`/`WsServerMessage`/`WsCmsMessage`/`WsUeEvent`, `productDetectedEventSchema`/`productLostEventSchema`, `detectionLabelSchema` `/^[a-z0-9_]+$/`, `CameraStatus`).
- `apps/api/src/services/detection.ts`: zod-validate → `confidence < minConfidence()` (env `DETECTION_MIN_CONFIDENCE`, code default 0.7, **live env 0.4**) → `LOW_CONFIDENCE`; → `getProductByDetectionLabel` → `NO_MATCH` | match. No server-side stabilization.
- Auth overall: Better Auth (cookie/bearer sessions) for humans; custom `api_key` table (`ek_…` plaintext once, SHA-256 hash, jsonb scopes, wildcards) for machines via `x-api-key`/`requireApiClient`. **No JWT/jose anywhere.** `/display/*` routes are public (middleware bypass); screens register with bare `{type:"REGISTER", screenId}`.

## 7. Existing product-mapping flow

`label "coster"` → `packages/types` `detectionLabelSchema` validation → `packages/db/src/queries/products.ts::getProductByDetectionLabel(label)` (`status='ACTIVE' AND deleted_at IS NULL`, limit 1) → `product` row. Schema: `packages/db/src/schema/products.ts` — `detection_label text` nullable with **partial unique index** (where not deleted and not null). Public REST lookup also exists: `GET /api/products/by-detection-label/:detectionLabel`. Model classes: single class `classId 0 = "coster"` (`datasets/coster-v1/data.yaml`, `nc: 1`). No model/version/class mapping tables exist — label string is the join key.

## 8. Existing Docker and Nginx architecture

- `infra/docker/docker-compose.yml`: `postgres:16-alpine` (host 5432, healthcheck), `mosquitto`, `api` (expose 4000), `cms` (expose 3000, `NEXT_PUBLIC_*` build args `/api`,`/ws`), `product-vision` + `product-vision-gated` (`profiles:[vision]`, `/dev/video*`, model `ro` mount, `CMS_WEBSOCKET_URL=ws://api:4000/ws/`, no healthcheck), `nginx:alpine` (80/443, mkcert certs). Networks: `internal` (**`internal: true` — no internet at runtime**) + `public`. All services `restart: unless-stopped`. **No GPU configuration anywhere.**
- `infra/nginx/default.conf`: static upstreams `api:4000`/`cms:3000`; 443 TLS `server_name 192.168.1.250`; locations `^~ /api/media` (buffering off) → api, `/api/` → api, `/health` → api, `= /ws` + `/ws/` → api with `proxy_http_version 1.1; Upgrade $http_upgrade; Connection "upgrade"` (hardcoded, no map) + 3600 s timeouts, `/_next/static/` → cms, `/` catch-all → cms. Port 80 → 301 https; unknown Host → 444.
- Host: Windows 11 + Docker Desktop + WSL2, this machine **is** 192.168.1.250. Root scripts: `prod:build/up/down`, `vision:up/down/logs`, `vision:reset` (`infra/scripts/reset-detection.js` — manual `PRODUCT_LOST` sender).

## 9. Problems and risks found

1. **Rollback point unpushed** — browser detection exists only as local commit `c65cc1e` (branch 2 ahead of origin).
2. **usbipd camera conflict (hard operational blocker)** — legacy vision containers claim webcams via usbipd-win; a camera attached to WSL is invisible to Windows browsers' `getUserMedia`. Browser/server modes require the cameras attached to Windows.
3. **Threshold drift** — code default 0.7 vs live env 0.4 vs browser 0.4 (comment in hook claims alignment, inaccurate vs code default). A detection at 0.4–0.7 would be silently dropped as `LOW_CONFIDENCE` if envs diverge.
4. **`HOLD_PRODUCT=true` hardcoded** — `PRODUCT_LOST` never emitted; only the manual script unsticks a takeover (→ user chose: keep behavior + add CMS reset button).
5. **`internal: true` network** — no runtime internet: pip installs impossible after build; ultralytics first-run downloads must be disabled.
6. **nginx + profiled service** — a static `upstream vision…` block would make nginx **fail to boot** whenever the vision profile is down, taking the whole stack offline. Must use the Docker-DNS resolver + variable pattern.
7. **No WS gateway tests**; no Python tests at all; unpinned Python deps.
8. **Preview double-publisher bug (pre-existing)** — `LiveScreenPlayer` runs `useCameraDetection` even for `?preview=1` CMS embeds → two `CAMERA_REGISTER`/detectors per camera.
9. **No NMS in browser path** vs full ultralytics NMS server-side; `.onnx` vs `.pt`; WASM fp32 vs CUDA numerics → parity near the 0.4 boundary must be measured, not assumed.
10. **Dataset quality** — 100 background negatives excluded from splits; single-session frames in random split → optimistic metrics (parallel ML track, not blocking infra).
11. ~92 MB ORT wasm + onnx in `apps/cms/public/display/` stay until cleanup (they are the rollback).
12. Committed real secrets in `.env`/`.env.production` (pre-existing; out of scope but flagged).
13. WS gateway broadly unauthenticated (pre-existing posture; phase-1 vision WS matches it per user decision).
14. Stale docs: `.doc/infrastructure.md` (screens app), `CameraPreviewOverlay.tsx` comment claims browser can't `getUserMedia`.

## 10. Proposed final architecture

```
Browser (/display/[screenId], mode=server)
 ├─ getUserMedia (same label-hint device pick)         [reused]
 ├─ hidden <video> + optional ?visionDebug=1 overlay
 ├─ capture 640px JPEG q0.75 @ ≤5 FPS, 1 in flight
 ├─ binary WS ──► nginx /vision/ws ──► vision-inference:8000 (FastAPI)
 │                                       └─ Ultralytics YOLO coster-v1.pt
 │                                          PyTorch CUDA FP32, cuda:0, RTX 3090
 │                ◄── detections JSON (normalized boxes, timing) ──┘
 ├─ StabilityFilter (@platform/vision-browser)          [reused]
 └─ PRODUCT_DETECTED / (LOST held) ──► existing /ws Hono gateway  [unchanged]
                                          └─ resolveDetectedProduct → product-showcase takeover
CMS admin: "Reset detection" button ──► POST /api/screens/:screenId/reset-detection ──► gateway.resetScreenTakeover()
```

Hono never sees JPEG bytes. FastAPI never touches PostgreSQL, auth, or business events.

## 11. Exact end-to-end runtime flow

1. Display page loads (public route). `NEXT_PUBLIC_VISION_INFERENCE_MODE=server` selects `useServerDetection`; browser-inference hook stays mounted but `enabled:false`.
2. Hook sends `CAMERA_REGISTER` + 5 s `CAMERA_HEARTBEAT` on the existing gateway socket (unchanged).
3. Hook opens `wss://192.168.1.250/vision/ws` (via `resolveBrowserWsUrl('/vision/ws')`); server sends `ready` (only when model warm) with limits echo.
4. Every 200 ms, if not in flight: draw current video frame to a reused `OffscreenCanvas` at max-side 640 (uniform downscale, aspect preserved — no client letterbox), `convertToBlob({type:'image/jpeg', quality:0.75})` (~60–120 KB), prepend 9-byte header `[0x01][frameId uint64 LE]`, send binary.
5. FastAPI: enforce size/rate/one-in-flight → `cv2.imdecode` → `model.predict(bgr, conf=0.4, imgsz=640, device='cuda:0', half=False, verbose=False)` in a 1-worker executor → build response from `boxes.xyxyn/cls/conf` + `model.names`.
6. Browser: match `frameId` → clear in-flight → record RTT → update debug overlay boxes → reduce to best detection (or null) → `StabilityFilter.update()`.
7. 5 consecutive hits → one `PRODUCT_DETECTED {cameraId,label,confidence,detectedAt}` via `sendRaw` → gateway resolves → showcase takeover (all unchanged). Losses: held (`HOLD_PRODUCT=true`); operator clears via CMS reset button → gateway restores `getScreenContent`.
8. Disconnect: vision WS reconnects with backoff (1 s→10 s); `CAMERA_STATUS service_offline` while down; gateway socket reconnect unchanged (3 s).

## 12. Authentication flow

**Phase 1 (decided): LAN-only, no auth on `/vision/ws`** — consistent with the existing posture (`/display` public; gateway accepts `REGISTER`/`CAMERA_*`/`PRODUCT_DETECTED` unauthenticated; a token on the JPEG hop would protect the least sensitive link). Mitigations: nginx is the only entry (443, LAN IP), vision container on the `internal` network with no host port, connection cap 4, 1 MB frame cap, 10 FPS rate limit, optional `allow 192.168.1.0/24; deny all;` in the `/vision/` locations.

**Documented upgrade path (future, not phase 1):** `POST /api/vision/token` on Hono (new `apps/api/src/routes/vision.ts`) returns `base64url({cameraId,exp:now+15m}) + "." + base64url(HMAC-SHA256(BROADCAST_SECRET, payload))`; FastAPI validates with the same secret via `VISION_TOKEN_SECRET` compose env; browser appends `?token=`, refetches on reconnect; FastAPI closes 1008 on invalid/expired. No second user DB; the `api_key` table stays reserved for UE/automation. Project/display scoping = the `cameraId` claim; expiry = 15 min; production hardening = enable token validation flag + real certs.

## 13. WebSocket frame protocol

Endpoint: `wss://<host>/vision/ws` → nginx → `vision-inference:8000/vision/ws`.

**Client → server (binary only), reusing the repo's established 9-byte header convention** (same as `websocket_client.py` / `use-live-stream.ts`):
```
[ type   : 1 byte  = 0x01 (JPEG frame) ]
[ frameId: 8 bytes uint64 LE (client-monotonic counter) ]
[ payload: JPEG bytes ]
```
Client keeps `frameId → sentAtMs` for RTT. Unknown type → JSON `error BAD_FRAME`.

**Server → client: text JSON.** On accept (only when warm):
```json
{ "type":"ready",
  "model": {"id":"coster","version":"1.0.0","file":"coster-v1.pt"},
  "limits": {"maxFrameBytes":1048576,"minFrameIntervalMs":100} }
```
Errors: `{"type":"error","frameId"?,"code","message"}`, codes `NOT_READY | FRAME_TOO_LARGE | RATE_LIMITED | BUSY | BAD_FRAME | INFERENCE_TIMEOUT | INTERNAL`.

**Server-side enforcement (per connection):** one-in-flight busy flag (frame while busy → dropped + `BUSY`, never queued); max frame 1 MB (close 1009 if >2×); min interval 100 ms (10 FPS ceiling; client targets 5); global connection cap 4 (excess closed 1013); inference timeout 2000 ms (`INFERENCE_TIMEOUT`, connection kept); not-warm → `NOT_READY` + close 1013. Close codes: 1000 normal, 1008 reserved for future auth, 1009 too big, 1011 internal, 1013 not-ready/capacity (client backs off). Client-side one-in-flight mirrors the existing `inflight` pattern; stale frames are skipped, never buffered. Disconnect cleanup releases the busy slot; server never persists any frame.

## 14. Detection response protocol

Per processed frame (matches the requested contract):
```json
{ "type": "detections", "frameId": 145, "timestamp": "2026-07-03T10:15:20.000Z",
  "model": { "id": "coster", "version": "1.0.0", "file": "coster-v1.pt" },
  "inference": { "provider": "cuda", "device": "NVIDIA GeForce RTX 3090", "processingTimeMs": 20.5 },
  "source": { "width": 640, "height": 360 },
  "detections": [ { "classId": 0, "label": "coster", "confidence": 0.91,
                    "box": { "x": 0.31, "y": 0.22, "width": 0.27, "height": 0.39 } } ] }
```
`box` = top-left origin, normalized 0..1 **relative to the uploaded frame** (from ultralytics `boxes.xyxyn`, which is already normalized to source dims — server-side letterboxing is internal to `predict` and invisible to the client). `label` from `model.names[classId]`; `device` from `torch.cuda.get_device_name(0)`.

**Overlay drawing math** (documented in the overlay component): the uploaded frame is a uniform downscale of the full video, so normalized coords map 1:1 onto the video content — no client letterbox correction. For `object-fit: contain`: `scale=min(elemW/videoW, elemH/videoH)`, `contentW=videoW*scale`, `offX=(elemW−contentW)/2`; pixel box `= {offX + x*contentW, offY + y*contentH, w*contentW, h*contentH}`. For `cover`: `scale=max(…)`, offsets go negative — same formula. Mirroring: debug video rendered unmirrored (no flip math); if mirrored later, `x' = 1 − x − width`. DPR: `canvas.width = cssW * devicePixelRatio`, `ctx.scale(dpr,dpr)`, draw in CSS px. Resize/fullscreen: `ResizeObserver` on the container re-computes; canvas overlays the video absolutely.

## 15. Detection stabilization design

**Stays in the browser** — reuse `StabilityFilter` from `packages/vision-browser/src/stability.ts` unchanged (IDLE →[5 consecutive hits]→ DETECTED →[10 misses]→ IDLE; equivalent to ABSENT/CANDIDATE/PRESENT with the candidate counting internal). Rationale: it already exists in the exact shape both hooks need, keeps the gateway event cadence byte-identical between modes, and keeps FastAPI stateless per frame (raw detections stream to the overlay; stable events are a client concern). Raw per-frame detections drive only the debug overlay; `PRODUCT_DETECTED` fires **once** per appearance via the filter; `PRODUCT_LOST` is suppressed (`HOLD_PRODUCT=true`, now in shared constants) — disappearance is handled by the new **CMS reset button** (gateway `resetScreenTakeover`), replacing `infra/scripts/reset-detection.js` for operators. No event spam at 200 ms cadence.

## 16. GPU and model-loading design

`services/product-vision/src/server/engine.py` (`InferenceEngine`):
- `load()`: assert `torch.cuda.is_available()` else raise `RuntimeError` (**startup fails; no CPU fallback ever** — `device` setting must start with `cuda`); `YOLO(VISION_SERVER_MODEL_PATH)`; `.to("cuda:0")`; log `torch.cuda.get_device_name(0)`; verify `model.names[0] == "coster"` and matches `detectionLabelSchema` shape; optional SHA-256 checksum verify against `VISION_SERVER_MODEL_SHA256` (recorded in Phase 1); warm-up: 3× `predict(np.zeros((640,640,3),uint8), imgsz=640, half=False)`; set `warm=True`. Loaded **once** in the FastAPI lifespan before uvicorn accepts traffic — CUDA failure → startup exception → container exit → `restart: unless-stopped` + failing healthcheck make it visible.
- `infer(jpeg: bytes)`: `cv2.imdecode` → `predict(conf=threshold, imgsz=640, device='cuda:0', half=False, verbose=False)` → detections + `processingTimeMs` (`perf_counter` around predict) + source w/h. All inference serialized through a `ThreadPoolExecutor(max_workers=1)` via `run_in_executor` (single GPU, event loop stays free). FP32 only; TensorRT/FP16/ONNX-CUDA are future stages behind this same seam.
- Readiness `GET /vision/readyz` → 200 with `{"status":"ready","modelLoaded":true,"cudaAvailable":true,"gpuName":"NVIDIA GeForce RTX 3090","inferenceDevice":"cuda:0"}` else 503. Liveness `GET /vision/healthz`. `GET /vision/info` adds versions + counters.
- Validation commands: `docker exec vision-inference nvidia-smi` and `docker exec vision-inference python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"`.

**Pinned deps — new `services/product-vision/requirements-server.txt`** (separate from the legacy unpinned `requirements.txt`; runtime image contains no training code or dataset):
```
--extra-index-url https://download.pytorch.org/whl/cu121
torch==2.5.1+cu121
torchvision==0.20.1+cu121
ultralytics==8.3.49
opencv-python==4.10.0.84
numpy==1.26.4
fastapi==0.115.6
uvicorn[standard]==0.32.1
```
cu121 wheels support Ampere/sm_86 and run under WSL2 with the installed Windows driver (596.36 is backward-compatible). Full `opencv-python` (not headless) because ultralytics hard-depends on it — headless would produce two cv2 dists; the repo's proven `libgl1 libglib2.0-0` apt pattern covers it.

**Base image: `python:3.11-slim` + pip cu121 wheels** (not `nvidia/cuda:*`, not `pytorch/pytorch`): torch wheels bundle the CUDA runtime as `nvidia-*` pip packages; the container only needs the driver injected by the GPU reservation. Final image ≈6.5 GB (torch-dominated); nvidia/cuda base would add ~1.9 GB duplicated CUDA, pytorch/pytorch ships conda (~7 GB+). `ENV YOLO_AUTOINSTALL=false YOLO_CONFIG_DIR=/tmp/ultralytics` prevents runtime downloads (mandatory on the no-internet network). Non-root: `USER` app user with `/tmp` config dir (model mount is `ro`). Clean shutdown: uvicorn SIGTERM → lifespan teardown closes the executor.

## 17. Docker deployment design

New service in `infra/docker/docker-compose.yml` (new profile so the legacy `vision` profile is untouched):
```yaml
  vision-inference:
    profiles: [vision-server]
    build: { context: ../../services/product-vision, dockerfile: Dockerfile.server }
    container_name: vision-inference
    restart: unless-stopped
    environment:
      - VISION_SERVER_MODEL_PATH=/app/models/production/coster-v1.pt
      - VISION_SERVER_DEVICE=cuda:0
      - VISION_SERVER_CONF_THRESHOLD=${DETECTION_MIN_CONFIDENCE:-0.4}
    expose: ["8000"]
    volumes:
      - ../../services/product-vision/models:/app/models:ro
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/vision/readyz',timeout=3).status==200 else 1)"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 120s
    networks: [internal]
```
- GPU syntax: `deploy.resources.reservations.devices` with `driver: nvidia` is what Compose v2 honors on Docker Desktop/WSL2 (Compose v5.1.4 also accepts the `gpus:` shorthand; the `deploy` form is the portable choice). Healthcheck via python one-liner (slim has no curl). No `devices:`/`group_add` — no camera. `start_period: 120s` covers model load + CUDA context + warm-up.
- `Dockerfile.server` (new, `services/product-vision/Dockerfile.server`): python:3.11-slim → apt `libgl1 libglib2.0-0` → `pip install -r requirements-server.txt` → copy **only** `src/server/` (never `camera.py`/`main.py`/pyrealsense2, no datasets) → non-root user → `EXPOSE 8000` → `CMD ["python","-m","server"]`.
- Root `package.json`: add `vision-server:up|down|logs` scripts mirroring `vision:up` with `--profile vision-server`.
- `cms` service: add build args `NEXT_PUBLIC_VISION_INFERENCE_MODE` (default `browser`) and `NEXT_PUBLIC_VISION_WS_URL=/vision/ws` (mirroring the existing `NEXT_PUBLIC_WS_URL` pattern in `apps/cms/Dockerfile:26-33`).
- **Coexistence:** `product-vision`/`product-vision-gated` stay defined but must not run concurrently with browser/server modes (duplicate publishers per cameraId + they hold the physical cameras via usbipd). Operational prerequisite for browser/server modes: `usbipd detach` both cameras so Windows browsers can `getUserMedia` them. Legacy services deleted only in cleanup.

## 18. Nginx routing design

Add to the 443 server block in `infra/nginx/default.conf`. **Must not** use a static `upstream` block — nginx resolves those at boot and would crash-loop whenever the `vision-server` profile is down. Use Docker's embedded DNS lazily:
```nginx
    location = /vision/ws {
        resolver 127.0.0.11 valid=10s;
        set $vision_upstream http://vision-inference:8000;
        proxy_pass $vision_upstream;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
    location /vision/ {   # healthz, readyz, info
        resolver 127.0.0.11 valid=10s;
        set $vision_upstream http://vision-inference:8000;
        proxy_pass $vision_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
```
WSS is inherited from the existing TLS termination (mkcert certs) — the browser connects `wss://192.168.1.250/vision/ws`; nginx→container is plain ws on the internal network. Existing `/api`, `/ws`, `/_next/static`, `/` routes untouched. Optional hardening: `allow 192.168.1.0/24; deny all;` in both blocks.

## 19. Product-mapping compatibility

**First migration: zero DB change.** Server returns `label:"coster"` from `model.names[0]`; browser emits the same `PRODUCT_DETECTED` contract; `resolveDetectedProduct` → `getProductByDetectionLabel("coster")` → existing Coster product (row must be `ACTIVE`; verified in Phase 0). `detectionLabelSchema` already constrains labels.

**Future upgrade (design only, not phase 1):** tables `vision_model` (`id, name, version, file, sha256`) + `vision_model_class` (`modelId, classId, label, productId FK`) in `packages/db/src/schema/`; resolution becomes `modelId+modelVersion+classId → productId` with `detection_label` as fallback; response already carries `model{id,version}` + `classId`, so the wire contract needs no change when this lands.

## 20. Existing files to reuse unchanged

- `packages/vision-browser/src/stability.ts` — StabilityFilter (both modes).
- `packages/vision-browser/src/{detector,preprocess}.ts` + `apps/cms/src/workers/detection.worker.ts` + `apps/cms/public/display/**` — browser mode / rollback path, untouched.
- `apps/cms/src/hooks/useScreenWebSocket.ts` (`sendRaw`), `apps/cms/src/lib/display/client-urls.ts` (`resolveBrowserWsUrl`), `apps/cms/src/app/display/_components/CameraStatusOverlay.tsx`.
- `apps/api/src/services/detection.ts`, `packages/db/**`, `packages/types/**` — contracts and resolution unchanged.
- `services/product-vision/src/{main,config,camera,detector,stability,websocket_client}.py`, `Dockerfile`, `requirements.txt` — legacy path stays runnable as tertiary rollback.
- `services/product-vision/models/production/coster-v1.pt` — the model, mounted read-only.
- `infra/scripts/reset-detection.js` — kept as emergency CLI alongside the new button.

## 21. Existing files to modify

| File | Current behavior | Change | Risk / testing |
|---|---|---|---|
| `apps/cms/src/hooks/useCameraDetection.ts` | Always active for mapped screens; constants inline | Add `enabled?: boolean` early-return; import shared constants from `packages/vision-browser/src/constants.ts` and camera map from new `apps/cms/src/lib/display/camera-config.ts` | Low; browser-mode manual smoke + typecheck |
| `apps/cms/src/app/display/_components/LiveScreenPlayer.tsx` | Calls `useCameraDetection` unconditionally (even previews) | Read `NEXT_PUBLIC_VISION_INFERENCE_MODE`; call both hooks with `enabled` (`mode==='browser' && !preview` / `mode==='server' && !preview`); render `DetectionDebugOverlay` when server mode + `?visionDebug=1` | Medium (display-critical); test both modes + preview embed; fixes pre-existing double-publisher bug — flag in PR |
| `apps/cms/Dockerfile` | Build args `NEXT_PUBLIC_{API,WS,WS_GATEWAY,SCREENS}_URL` | Add `NEXT_PUBLIC_VISION_INFERENCE_MODE` (default `browser`), `NEXT_PUBLIC_VISION_WS_URL` (default `/vision/ws`) | Low; image build |
| `infra/docker/docker-compose.yml` | No GPU service; cms args fixed | Add `vision-inference` service (§17); add the two args to `cms.build.args` | Medium; `pnpm prod:build`, container GPU validation |
| `infra/nginx/default.conf` | No `/vision` routes | Add the two `/vision` locations (§18, resolver pattern) | Medium; verify nginx boots with profile down (`nginx -t`, restart), `curl /vision/readyz`, wscat upgrade |
| `apps/api/src/ws/gateway.ts` | Takeover restore logic inline in `PRODUCT_LOST` case | Extract/export `resetScreenTakeover(screenId): Promise<boolean>` (delete takeover, `getScreenContent`, broadcast `CONTENT_UPDATE`+`SCREEN_UPDATED`+UE mirror); `PRODUCT_LOST` case calls it | Low-medium; new unit test + manual button test |
| `apps/api/src/routes/screens.ts` | Screen CRUD/config routes | Add `POST /:screenId/reset-detection` (`requireAdmin`) → `resetScreenTakeover` | Low; vitest route test |
| `apps/cms/src/app/(dashboard)/screens/_components/screen-control-view.tsx` | Per-screen admin controls | Add "Reset detection" button → the new route (visible when screen has a mapped camera) | Low; manual test |
| Root `package.json` | `vision:*` scripts | Add `vision-server:up|down|logs` | Trivial |
| Root `.env.example` | Documents current vars | Document `VISION_SERVER_*`, `NEXT_PUBLIC_VISION_*` | Trivial |

## 22. New files required

| Path | Why / responsibility | Interacts with |
|---|---|---|
| `services/product-vision/src/server/__init__.py`, `__main__.py` | Package + `python -m server` entry (uvicorn factory, host 0.0.0.0:8000) | app.py |
| `services/product-vision/src/server/settings.py` | Env-driven settings (`VISION_SERVER_*`), validates device startswith `cuda`, threshold ∈[0,1]; independent of legacy `config.py` (which requires camera/WS-client vars) | engine, ws, http |
| `services/product-vision/src/server/engine.py` | CUDA engine: load-once, warm-up, no-CPU-fallback, single-worker executor, normalized-box inference, timing, model/GPU info, checksum verify | ultralytics, torch, settings |
| `services/product-vision/src/server/protocol.py` | Pydantic response models + 9-byte binary header pack/unpack (`struct.unpack_from("<BQ", …)`) — Python mirror of `server-transport.ts` | ws.py, tests |
| `services/product-vision/src/server/ws.py` | `/vision/ws` handler: readiness gate, limits, one-in-flight, timeout, structured errors, close codes, disconnect cleanup | engine, protocol, settings |
| `services/product-vision/src/server/http.py` | `/vision/healthz`, `/vision/readyz` (503 until CUDA+warm), `/vision/info` (+counters) | engine |
| `services/product-vision/src/server/app.py` | `create_app()` FastAPI factory; lifespan loads+warms engine **before** serving | all above |
| `services/product-vision/requirements-server.txt` | Pinned runtime deps (§16), separate from unpinned training reqs | Dockerfile.server |
| `services/product-vision/Dockerfile.server` | Slim GPU-runtime image; copies only `src/server/`; non-root; YOLO_AUTOINSTALL=false | compose |
| `services/product-vision/tests/server/{test_protocol,test_ws,test_engine}.py` | pytest; WS tests via `fastapi.testclient` with fake engine (CI needs no GPU) | server package |
| `services/product-vision/scripts/parity_test.py` | Browser-ONNX-equivalent (argmax, no NMS) vs `.pt`-CUDA on fixed images; per-image confidence delta, decision agreement, negatives confusion, latency | models/, datasets/ |
| `packages/vision-browser/src/constants.ts` | Single home for capture defaults (640/0.75/200 ms), stability (0.4/5/10), `HOLD_PRODUCT` — kills duplication | both hooks |
| `packages/vision-browser/src/capture.ts` | `captureJpegFrame(video,{maxSide,quality}) → {blob,width,height}` via reused OffscreenCanvas + `convertToBlob`, `toBlob` fallback | useServerDetection |
| `packages/vision-browser/src/server-transport.ts` | `ServerDetectionClient`: WS connect/reconnect (1 s→10 s backoff), 9-byte header framing (`DataView.setBigUint64(1,id,true)`), `ready/detections/error` parsing, in-flight + RTT stats; exports the response TS types | useServerDetection; contract mirror of protocol.py |
| `apps/cms/src/lib/display/camera-config.ts` | `SCREEN_TO_CAMERA`, `CAMERA_LABEL_HINTS`, `DETECTION_LABEL` moved out of the hook (shared by both modes) | both hooks |
| `apps/cms/src/hooks/useServerDetection.ts` | Server-mode hook: same lifecycle (CAMERA_REGISTER/heartbeat/getUserMedia/hidden video) but capture→transport instead of worker; reduces detections to best → same StabilityFilter → same `sendRaw` events; CAMERA_STATUS mapping (`waiting` on ready, `service_offline` on vision-WS loss, `camera_unavailable` on getUserMedia failure); returns `{stream, lastResult, stats, status}` for the overlay; `enabled` option | vision-browser modules, useScreenWebSocket |
| `apps/cms/src/app/display/_components/DetectionDebugOverlay.tsx` | `?visionDebug=1` panel: second `<video>` on the same MediaStream + absolutely-positioned canvas boxes (math §14) + stats line (WS status, processingTimeMs, RTT, FPS, confidence) | useServerDetection |

## 23. Files that may later be removed (cleanup phase only, after acceptance)

- `apps/cms/public/display/ort/` (~80 MB wasm) and `apps/cms/public/display/models/coster-v1.onnx` (12 MB).
- `apps/cms/src/workers/detection.worker.ts`; `packages/vision-browser/src/{detector,preprocess}.ts` (keep stability/constants/capture/server-transport); `onnxruntime-web` dep from `apps/cms/package.json` + `packages/vision-browser/package.json`.
- COOP/COEP headers block in `apps/cms/next.config.mjs` (only needed for threaded WASM).
- Compose services `product-vision`, `product-vision-gated` + legacy `vision` profile scripts; possibly `services/product-vision/src/{camera,main,websocket_client}.py` and `pyrealsense2` (keep scripts/ for training).
- `infra/scripts/reset-detection.js` once the CMS button is trusted.

## 24. Environment variables required

| Var | Where | Default | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_VISION_INFERENCE_MODE` | cms build arg (Dockerfile + compose) | `browser` | Feature flag `browser\|server` |
| `NEXT_PUBLIC_VISION_WS_URL` | cms build arg | `/vision/ws` | Vision WS path (resolved same-origin) |
| `VISION_SERVER_MODEL_PATH` | vision-inference env | required | `/app/models/production/coster-v1.pt` |
| `VISION_SERVER_DEVICE` | vision-inference env | `cuda:0` | Must be CUDA; startup fails otherwise |
| `VISION_SERVER_CONF_THRESHOLD` | vision-inference env | `0.4` | **Wired to `${DETECTION_MIN_CONFIDENCE:-0.4}` in compose** so it can never diverge from the Hono gate |
| `VISION_SERVER_MODEL_ID` / `_MODEL_VERSION` | vision-inference env | `coster` / `1.0.0` | Echoed in responses |
| `VISION_SERVER_MODEL_SHA256` | vision-inference env | optional | Startup checksum verify |
| `VISION_SERVER_MAX_FRAME_BYTES` | vision-inference env | `1048576` | Frame cap |
| `VISION_SERVER_MIN_FRAME_INTERVAL_MS` | vision-inference env | `100` | FPS ceiling |
| `VISION_SERVER_MAX_CONNECTIONS` | vision-inference env | `4` | Connection cap |
| `VISION_SERVER_INFERENCE_TIMEOUT_MS` | vision-inference env | `2000` | Per-frame timeout |
| `VISION_SERVER_PORT` | vision-inference env | `8000` | uvicorn |
| `DETECTION_MIN_CONFIDENCE` | existing (api + now vision) | live `0.4` | Single authoritative gate, unchanged |

Client capture defaults (640 / 0.75 / 200 ms / stability 5/10 / HOLD_PRODUCT) live in `packages/vision-browser/src/constants.ts` as code defaults — deliberately not env (no deploy-time reason to vary; env sprawl is the current disease).

## 25. Testing strategy

- **Python (pytest, new)** — `cd services/product-vision && python -m pytest tests/server`: protocol pack/unpack round-trip; WS handler with fake engine (ready gating, BUSY on second in-flight frame, FRAME_TOO_LARGE, RATE_LIMITED, BAD_FRAME on garbage/invalid-JPEG, INFERENCE_TIMEOUT via slow fake, disconnect cleanup, close codes); engine unit tests (device validation raises on non-CUDA config; label verification) — GPU-marked tests (`-m gpu`) run only on this host.
- **API (vitest, existing + new)** — `pnpm --filter @platform/api test`: existing `detection.test.ts`/`schemas.test.ts` must pass untouched; new tests for `resetScreenTakeover` and the reset route.
- **Browser** — `pnpm --filter @platform/vision-browser build && pnpm --filter @platform/cms typecheck`; manual: both modes on `/display/main-screen`, `?preview=1` no longer registers a camera, overlay via `?visionDebug=1`, reconnect drill (kill vision container mid-run → `service_offline` → restart → auto-recover).
- **GPU/container** — `docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi` (host passthrough sanity before building 6.5 GB images); `docker exec vision-inference nvidia-smi`; `docker exec vision-inference python -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"`; negative test: run without GPU reservation → container must exit non-zero (proves no CPU fallback).
- **Integration** — `curl -k https://192.168.1.250/vision/readyz`; `npx wscat -c wss://192.168.1.250/vision/ws --no-check` receives `ready`; nginx boots with the profile down; oversized-frame and invalid-JPEG rejection through the full nginx path; 30–60 min soak with `nvidia-smi dmon` + `docker stats`.
- **No-frame-persistence validation** — §27.

## 26. Accuracy and parity validation

CUDA does **not** improve model accuracy; it provides a controlled runtime (consistent model file/preprocessing/NMS, predictable latency, centralized monitoring, no per-device browser variance). Accuracy remains a dataset/training concern — the audit shows 100 background negatives excluded from the split and likely same-session leakage between train/val → treat dataset v2 as a **parallel ML track** (Phase 9), not an infra blocker.

`services/product-vision/scripts/parity_test.py`: for each of the 12 images in `datasets/coster-v1/images/test` + the 100 `raw/background` negatives, run (a) `.onnx` via onnxruntime replicating the browser's exact argmax-no-NMS logic and (b) `.pt` through the server engine path on CUDA. Report per-image max-confidence delta, decision agreement at 0.4, box IoU where both produce boxes (browser path has no boxes — IoU compares server output vs labels instead), false positives on negatives, and per-image latency. **Gate: ≥95 % decision agreement at threshold 0.4 on positives, no new false positives on negatives; document any systematic confidence offset before cutover.** Note asymmetries up front: `.onnx`-argmax vs `.pt`-NMS, WASM vs CUDA numerics — the 0.4 boundary is the sensitive spot.

## 27. Privacy and frame-retention verification

Preserved behavior: frames exist only in memory. Server: JPEG bytes → `cv2.imdecode` → ndarray → inference → response; no disk writes, no PostgreSQL writes, no frame/base64 bytes in logs (log only sizes, ids, timings, codes); references dropped per-frame (no caching — unlike the live-stream relay's keyframe cache, the vision service caches nothing). Verification: code review of `ws.py`/`engine.py` for any `write`/persistence; run 10 min of traffic then `docker exec vision-inference find / -newer /tmp/marker -type f` shows no image artifacts; log scan for base64/JPEG magic bytes. Container model mount is `ro`; no volume is writable except tmpfs-style `/tmp`. Snapshot/recording features remain out of scope.

## 28. Logging and observability plan

- **Vision service**: structured single-line logs (uvicorn access logs off for WS; app logger with `frameId`, byte size, `processingTimeMs`, queue-drop counters, close codes; never image data). In-process rolling metrics exposed at `GET /vision/info`: frames processed/dropped by cause, avg/p95 `processingTimeMs`, uptime, `torch.cuda.memory_allocated/reserved`, GPU name. Periodic (60 s) stats log line. No Prometheus/broker in phase 1 (explicitly excluded).
- **Browser overlay** (`?visionDebug=1`): WS status, model status, per-frame processing ms, RTT, effective FPS, last confidence.
- **Measurements collected for acceptance** (§31): model startup time and warm-up time (startup logs), first/avg/p95 inference (overlay + `/vision/info`), WS RTT (frameId timing), effective FPS, GPU utilization/memory (`nvidia-smi dmon`), dropped frames, reconnect count.
- **Gateway/CMS**: unchanged; `CAMERA_STATUS` lifecycle already surfaces `service_offline` on the status pill.

## 29. Rollback strategy

Three nested levels, all preserved during migration:
1. **Flag flip (minutes)**: rebuild cms with `NEXT_PUBLIC_VISION_INFERENCE_MODE=browser` (one compose arg) — browser ONNX path is fully intact (model + wasm still shipped in `public/display/`). Vision container can stay up or be stopped (`pnpm vision-server:down`); nginx tolerates its absence by design.
2. **Git rollback**: tag `vision-browser-onnx-baseline` at `c65cc1e` (pushed in Phase 1) — the last all-browser state.
3. **Legacy native service**: `pnpm vision:up` + `usbipd attach` cameras back to WSL (documented, not expected).
Cleanup (Phase 9) is deliberately deferred until server mode has ≥1 week of stable operation, because deleting the browser path deletes rollback level 1.

## 30. Detailed implementation phases

**Phase 0 — Audit** ✅ complete (this document; sections 2–9 are the deliverables: flow, contracts, auth, Docker/nginx constraints, duplicates, blockers). Remaining Phase 0 action: verify in the running DB that the Coster product is `ACTIVE` with `detection_label='coster'` (`GET /api/products/by-detection-label/coster`), and check whether legacy vision containers are currently running (`docker ps`).

**Phase 1 — Preserve & rollback**: push the 2 unpushed commits; tag `vision-browser-onnx-baseline`; record SHA-256 of `coster-v1.pt`/`coster-v1.onnx` (store beside models as `checksums.txt` and use for `VISION_SERVER_MODEL_SHA256`); back up `datasets/coster-v1` + models to `E:/EC/cms-platform-data/backups/`; snapshot versions (`pip freeze` from `.venv`, `pnpm list`); export Coster product row (mapping record); verify browser mode works end-to-end once. *Accept:* tag on origin; checksums recorded; coster → showcase works.

**Phase 2 — Standalone CUDA service**: new `src/server/` package (settings/engine/protocol/http/app/__main__), `requirements-server.txt`, `Dockerfile.server`, pytest suite; verify `model.names == {0:'coster'}`; iterate in a local venv first (cu121 Windows wheels work), then `docker build` + `docker run --gpus all` standalone; single-image sanity via a temporary `POST /vision/detect` test route or pytest gpu-marked test on `datasets/coster-v1/images/test`. *Accept:* readyz 200 with correct GPU diagnostic JSON; startup fails without CUDA; fixed images produce expected detections.

**Phase 3 — FastAPI WebSocket inference**: `ws.py` + `protocol.py` finalized (binary input, JSON responses, one-in-flight, size/FPS limits, timeout+cancellation, disconnect cleanup, structured errors, close codes). *Accept:* full pytest WS suite green; wscat manual session: ready → frame → detections; abuse cases rejected with correct codes.

**Phase 4 — Browser server-inference adapter**: `constants.ts`, `capture.ts`, `server-transport.ts`, `camera-config.ts`, `useServerDetection.ts`; modify `useCameraDetection.ts` (enabled + shared constants), `LiveScreenPlayer.tsx` (mode switch, preview gating), `apps/cms/Dockerfile` args; `DetectionDebugOverlay.tsx`. Dev-mode test against `ws://localhost:8000/vision/ws` before nginx exists. *Accept:* server mode detects; browser mode unchanged; no ONNX/WASM loaded in server mode (verify in devtools network tab); one frame in flight; overlay boxes track the object with correct object-fit math.

**Phase 5 — CMS event integration**: stabilization reuse verified (identical `PRODUCT_DETECTED` payload vs browser mode — capture both and diff); `HOLD_PRODUCT` kept true from shared constants; **reset button**: `gateway.ts` export `resetScreenTakeover`, route `POST /api/screens/:screenId/reset-detection` (`requireAdmin`), button in `screen-control-view.tsx`; confidence stays centralized (`DETECTION_MIN_CONFIDENCE` → both consumers). *Accept:* "coster" resolves to Coster product; PRODUCT_DETECTED exactly once per appearance; reset button restores the screen's normal content; api vitest green.

**Phase 6 — Docker & nginx integration**: compose `vision-inference` service (GPU reservation, ro model mount, healthcheck, restart), cms build args in compose, root scripts, nginx `/vision` locations (resolver pattern), `.env.example` docs. *Accept:* `pnpm prod:build && pnpm prod:up && pnpm vision-server:up` healthy; `docker exec` GPU commands pass; `curl -k https://192.168.1.250/vision/readyz` 200; wscat over WSS through nginx; nginx boots with the profile down; existing `/`, `/api`, `/ws` routes unaffected; LAN display device connects.

**Phase 7 — Tests & observability**: complete the test matrix (§25) incl. oversized-frame, invalid-JPEG, reconnect drills, no-frame-persistence check (§27); `/vision/info` metrics + periodic stats log; overlay latency display verified against `nvidia-smi`. *Accept:* all suites green; metrics list (§28) collectable.

**Phase 8 — Controlled rollout**: `usbipd detach` cameras (prerequisite); enable server mode for one display (rebuild cms `NEXT_PUBLIC_VISION_INFERENCE_MODE=server` — flag is build-time global, so "one display" = staged deploy window with the second screen's camera unplugged, or a temporary per-screen override read from the query string if desired); run parity script (§26); 30–60 min soak on both screens; monitor GPU/latency/drops; approval → server mode default in compose. *Accept:* full checklist §31.

**Phase 9 — Future improvements (backlog, not this migration)**: dataset v2 with background negatives + session-independent val/test; versioned model registry + `vision_model`/`vision_model_class` tables (§19); ONNX-Runtime-CUDA and TensorRT FP32 benchmarks, FP16 only after parity; bounded multi-camera scheduling (per-connection fairness on the single executor); auth token hardening (§12); removal list §23; fix stale docs/comments (`.doc/infrastructure.md`, `CameraPreviewOverlay.tsx`); address committed secrets.

## 31. Acceptance checklist

- [ ] vision-inference container starts; `coster-v1.pt` loads once; readyz reports `{status:"ready", modelLoaded:true, cudaAvailable:true, gpuName:"NVIDIA GeForce RTX 3090", inferenceDevice:"cuda:0"}`
- [ ] Startup/readiness fails without CUDA (no silent CPU fallback — negative test performed)
- [ ] Browser camera opens; local video smooth; no ONNX/WASM/worker loaded in server mode
- [ ] Frames sent at ≤5 FPS, exactly one in flight, no queue growth (server BUSY counter ≈ 0 in steady state)
- [ ] Detections returned; overlay boxes align under contain/cover/resize/fullscreen/DPR; label+confidence+latency shown
- [ ] "coster" resolves to the Coster product; PRODUCT_DETECTED exactly once per appearance; hold behavior + reset button restores content (PRODUCT_LOST-once criterion superseded by the hold+button decision)
- [ ] Vision WS reconnect works (kill container → `service_offline` → restart → auto-recover); FastAPI restart recovery < 2 min (start_period)
- [ ] No frames persisted anywhere (filesystem + log audit)
- [ ] RTX 3090 utilization visible during inference (`nvidia-smi`)
- [ ] Existing CMS features (content sync, live-stream, screens admin, auth) unaffected; api vitest green
- [ ] 30–60 min soak stable
- [ ] Measurements recorded: model startup time, warm-up time, first inference, avg + p95 inference, WS RTT, effective FPS, GPU util + memory, dropped frames, reconnect count

## 32. Exact recommended implementation order

1. Phase 0 remainder (DB product check, `docker ps`) → 2. Phase 1 (push + tag + checksums + backups) → 3. Phase 2 (server package in venv → pytest → Dockerfile.server → standalone GPU container validation) → 4. Phase 3 (WS protocol + tests) → 5. Phase 4 (vision-browser modules → hooks → overlay, dev-mode against localhost:8000) → 6. Phase 5 (reset button + event parity diff) → 7. Phase 6 (compose + nginx) → 8. Phase 7 (test matrix + observability) → 9. Phase 8 (usbipd detach → staged rollout → parity → soak → default) → 10. Phase 9 backlog. Rationale: GPU risk is retired first (Phase 2 is the only genuinely unknown hardware path); browser work proceeds against a locally-run service without touching production infra; infra wiring lands only once both ends are proven.

## 33. Blockers, risks and decisions requiring approval

Blockers: (a) unpushed rollback commits; (b) usbipd camera attachment state must be confirmed/detached before browser or server mode can see cameras; (c) Docker Desktop WSL2 GPU passthrough must pass the `nvidia-smi` container test (host GPU + driver already confirmed). Risks: parity at the 0.4 boundary (§26), no-internet runtime network (§16 mitigations), nginx resolver deviation from house style (§18), preview-gating behavior change (§21), single shared 3090 with training/UE workloads (operational note). Decisions: see Approval Gate.

## 34. Approval Gate

**A. Decisions already clear from the repository**
- Reuse `services/product-vision/` for the server (models/scripts/datasets already there); keep Hono/`packages/types` contracts byte-identical; stabilization stays in the browser via existing `StabilityFilter`; frames bypass the Hono gateway (nginx → FastAPI direct); reuse the repo's 9-byte binary header convention; python:3.11-slim + cu121 pip wheels base; compose `deploy.resources.reservations.devices` GPU syntax; nginx resolver pattern for the profiled upstream; feature flag via `NEXT_PUBLIC_*` build-arg pattern; zero DB changes for phase 1.

**B. Decisions confirmed by you (via Q&A this session)**
- Phase-1 auth: LAN-only unauthenticated `/vision/ws` (token upgrade path documented, §12).
- `HOLD_PRODUCT=true` retained; disappearance handled by a new CMS **reset button** (gateway export + admin route + screens-admin button) instead of auto `PRODUCT_LOST`.
- Confidence threshold 0.4, single-sourced from `DETECTION_MIN_CONFIDENCE`.
- Bounding-box overlay behind `?visionDebug=1` on the display page.

**C. Blockers to resolve before implementation**
1. Push `c65cc1e` (+ parent) and tag — the entire rollback story depends on it.
2. Confirm camera/usbipd state: legacy vision containers must be stopped and cameras attached to Windows for `getUserMedia`.
3. Run the one-shot GPU-in-Docker sanity test (`docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi`) before building the 6.5 GB image.
4. Verify the Coster product row is `ACTIVE` with `detection_label='coster'` in the running DB.

**D. First implementation phase after approval**
Phase 1 (preserve & rollback: push, tag, checksums, backups) immediately followed by Phase 2 (standalone CUDA detection service — `src/server/` package, pinned deps, `Dockerfile.server`, GPU validation). Phase 2 is where the only real hardware unknown (WSL2 GPU passthrough into the container) is retired, so it should start the same working session.

implement this plan or create the small...small works and make it perfect.  
