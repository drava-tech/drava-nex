"""FastAPI + YOLO CUDA inference server — the runtime object-detection path.

Public surface (proxied by nginx, consumed by packages/vision-browser):
  ws   /vision/ws       binary JPEG frames in, JSON detections out
  get  /vision/healthz  liveness
  get  /vision/readyz   readiness (model loaded + warm on CUDA)
  get  /vision/info     model / device / metrics
"""
