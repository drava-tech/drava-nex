import asyncio
import hashlib
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from vision.object_detection.server.runtime import cuda_available
from vision.object_detection.server.settings import settings

logger = logging.getLogger("vision-server")

# The CMS product's Detection Label field (packages/types detectionLabelSchema)
# accepts lowercase letters, digits and underscores only. A YOLO class name that
# doesn't match can never resolve to a product — resolveDetectedProduct rejects
# it as INVALID_EVENT — so the mismatch is caught at load time, not silently at
# 30 fps in production.
_CMS_DETECTION_LABEL = re.compile(r"^[a-z0-9_]+$")


class ModelNotFoundError(RuntimeError):
    """The configured weight file does not exist on disk."""


class ModelChecksumError(RuntimeError):
    """The weight file on disk does not match VISION_SERVER_MODEL_SHA256."""


class InferenceEngine:
    def __init__(self):
        self.model = None
        self.warm = False
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.active_connections = 0
        self.frames_processed = 0
        self.frames_dropped_busy = 0
        self.frames_dropped_limit = 0
        self.total_inference_time_ms = 0.0

    # ── startup ────────────────────────────────────────────────────────────────

    def verify_model_file(self) -> None:
        """Existence + optional SHA-256 check, before any GPU work is attempted.

        Split out of load() so it is testable without torch/ultralytics.
        """
        path = Path(settings.model_path)
        if not path.is_file():
            raise ModelNotFoundError(
                f"Model weight not found at {settings.model_path}. "
                "The weight is gitignored — restore it and verify against "
                "models/production/checksums.txt, or point "
                "VISION_SERVER_MODEL_PATH at an existing .pt file."
            )

        if not settings.model_sha256:
            return

        logger.info("Verifying model SHA-256 checksum...")
        sha = hashlib.sha256()
        with path.open("rb") as f:
            while chunk := f.read(1024 * 1024):
                sha.update(chunk)
        checksum = sha.hexdigest()
        if checksum.lower() != settings.model_sha256.lower():
            raise ModelChecksumError(
                f"Model SHA-256 mismatch for {settings.model_path}. "
                f"Expected: {settings.model_sha256}, Got: {checksum}"
            )
        logger.info("Model SHA-256 checksum verified.")

    @staticmethod
    def verify_class_names(names: dict) -> None:
        """Every YOLO class name must be a legal CMS detectionLabel."""
        if not names:
            raise RuntimeError("Model exposes no class names — cannot map detections to products.")
        bad = [n for n in names.values() if not _CMS_DETECTION_LABEL.match(str(n))]
        if bad:
            raise RuntimeError(
                f"Model class names are not valid CMS detection labels: {bad}. "
                "Detection labels must be lowercase letters, digits and underscores only "
                "(see packages/types detectionLabelSchema) and must match a product's "
                "Detection Label exactly. Retrain or rename the classes."
            )

    def load(self):
        """Load + warm the model. Raises unless a real CUDA device is present."""
        logger.info("Initializing InferenceEngine...")

        # CUDA-only in production: no silent CPU fallback. Also covers "torch is
        # not installed at all", which runtime.cuda_available() reports as False.
        if not cuda_available():
            raise RuntimeError("CUDA is not available. GPU is required for inference.")

        self.verify_model_file()

        from ultralytics import YOLO  # lazy: keeps this module importable without torch

        logger.info(
            "Loading YOLO model from %s onto device %s", settings.model_path, settings.device
        )
        self.model = YOLO(settings.model_path)
        self.model.to(settings.device)

        self.verify_class_names(self.model.names or {})
        logger.info("Model classes: %s", self.model.names)

        # Warm up so /vision/readyz only flips to ready once the first real
        # inference cost (cuDNN autotune, kernel JIT) has already been paid.
        import numpy as np

        logger.info("Warming up model with 3 dummy images...")
        dummy_img = np.zeros((640, 640, 3), dtype=np.uint8)
        for _ in range(3):
            self.model.predict(
                dummy_img,
                imgsz=640,
                device=settings.device,
                half=False,
                verbose=False,
            )
        self.warm = True
        logger.info("Model loaded and warmed up successfully.")

    # ── inference ──────────────────────────────────────────────────────────────

    def run_prediction(self, img_bgr):
        t0 = time.perf_counter()
        results = self.model.predict(
            img_bgr,
            conf=settings.conf_threshold,
            imgsz=640,
            device=settings.device,
            half=False,
            verbose=False,
        )
        t1 = time.perf_counter()
        inference_time_ms = (t1 - t0) * 1000.0

        detections = []
        if results and len(results) > 0:
            boxes = results[0].boxes
            if boxes is not None:
                xyxyn = boxes.xyxyn.cpu().numpy()
                confs = boxes.conf.cpu().numpy()
                clss = boxes.cls.cpu().numpy().astype(int)

                for box, conf, cls in zip(xyxyn, confs, clss):
                    label = self.model.names.get(int(cls), "unknown")
                    x1, y1, x2, y2 = box
                    detections.append({
                        "classId": int(cls),
                        "label": label,
                        "confidence": float(conf),
                        "box": {
                            "x": float(x1),
                            "y": float(y1),
                            "width": float(x2 - x1),
                            "height": float(y2 - y1),
                        },
                    })

        h, w = img_bgr.shape[:2]
        return detections, inference_time_ms, {"width": w, "height": h}

    async def infer(self, jpeg_bytes: bytes):
        if not self.warm:
            raise RuntimeError("Model is not warmed up and ready.")

        import cv2
        import numpy as np

        loop = asyncio.get_running_loop()
        img_bgr = await loop.run_in_executor(
            self.executor,
            lambda: cv2.imdecode(np.frombuffer(jpeg_bytes, np.uint8), cv2.IMREAD_COLOR),
        )
        if img_bgr is None:
            raise ValueError("Invalid image bytes")

        detections, inference_time_ms, source_dims = await loop.run_in_executor(
            self.executor,
            self.run_prediction,
            img_bgr,
        )

        self.frames_processed += 1
        self.total_inference_time_ms += inference_time_ms

        return detections, inference_time_ms, source_dims

    def close(self):
        self.executor.shutdown(wait=True)


engine = InferenceEngine()
