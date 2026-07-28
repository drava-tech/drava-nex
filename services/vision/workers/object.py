"""
object.py — pointer, not a placeholder.

There is intentionally NO per-camera object worker. Product detection does not
read a camera on this host: the CMS display page captures frames in the browser
and streams them to the YOLO inference server over /vision/ws.

    cd services
    python -m vision.object_detection.server     # or: pnpm vision-server:up

Adding a host-side OBJECT worker would create a second camera runtime competing
with the browser for the same device and double-firing PRODUCT_DETECTED. The
supervisor rejects OBJECT entries in VISION_CAMERAS for the same reason.

See services/vision/object_detection/README.md.
"""

raise SystemExit(
    "vision.workers.object does not exist. Object detection runs as a WebSocket "
    "inference server fed by the browser:\n"
    "    cd services && python -m vision.object_detection.server\n"
    "(or `pnpm vision-server:up` for the container). "
    "See services/vision/object_detection/README.md."
)
