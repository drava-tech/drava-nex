"""
object.py — pointer, not a placeholder.

The YOLO object-detection engine lives at
``vision.object_detection.server.engine`` (services/vision/object_detection/).
It is not an engine in the sense engines/face.py is: it never opens a camera.
Frames arrive from the browser over /vision/ws, so the engine belongs to the
FastAPI inference server rather than to a per-camera worker.

Importing it from here would be actively wrong — ultralytics/torch must never
load in the face pipeline's process (conflicting CUDA/cuDNN stacks with
onnxruntime-gpu), which is precisely what this module refuses to do.
"""

raise ImportError(
    "There is no object engine in this process. The YOLO engine is "
    "vision.object_detection.server.engine and must run in its own process "
    "(torch vs. onnxruntime-gpu CUDA conflict). See "
    "services/vision/object_detection/README.md."
)
