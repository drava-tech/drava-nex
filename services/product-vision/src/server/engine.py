import hashlib
import time
import logging
from concurrent.futures import ThreadPoolExecutor
import asyncio
import cv2
import numpy as np
import torch
from ultralytics import YOLO
from server.settings import settings

logger = logging.getLogger("vision-server")

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

    def load(self):
        logger.info("Initializing InferenceEngine...")
        
        # Verify CUDA is available
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available. GPU is required for inference.")
        
        # Check model checksum if provided
        if settings.model_sha256:
            logger.info("Verifying model SHA-256 checksum...")
            sha = hashlib.sha256()
            with open(settings.model_path, "rb") as f:
                while chunk := f.read(8192):
                    sha.update(chunk)
            checksum = sha.hexdigest()
            if checksum.lower() != settings.model_sha256.lower():
                raise RuntimeError(
                    f"Model SHA-256 mismatch. Expected: {settings.model_sha256}, Got: {checksum}"
                )
            logger.info("Model SHA-256 checksum verified.")

        # Load YOLO model
        logger.info(f"Loading YOLO model from {settings.model_path} onto device {settings.device}")
        self.model = YOLO(settings.model_path)
        self.model.to(settings.device)

        # Verify class definitions
        if not self.model.names or 0 not in self.model.names or self.model.names[0] != "coster":
            raise RuntimeError(
                f"Model names verification failed. Class 0 must be 'coster'. Got: {self.model.names}"
            )

        # Warm up model
        logger.info("Warming up model with 3 dummy images...")
        dummy_img = np.zeros((640, 640, 3), dtype=np.uint8)
        for i in range(3):
            self.model.predict(
                dummy_img,
                imgsz=640,
                device=settings.device,
                half=False,
                verbose=False
            )
        self.warm = True
        logger.info("Model loaded and warmed up successfully.")

    def run_prediction(self, img_bgr):
        t0 = time.perf_counter()
        results = self.model.predict(
            img_bgr,
            conf=settings.conf_threshold,
            imgsz=640,
            device=settings.device,
            half=False,
            verbose=False
        )
        t1 = time.perf_counter()
        inference_time_ms = (t1 - t0) * 1000.0
        
        detections = []
        if results and len(results) > 0:
            res = results[0]
            boxes = res.boxes
            if boxes is not None:
                xyxyn = boxes.xyxyn.cpu().numpy()
                confs = boxes.conf.cpu().numpy()
                clss = boxes.cls.cpu().numpy().astype(int)
                
                for box, conf, cls in zip(xyxyn, confs, clss):
                    label = self.model.names.get(cls, "unknown")
                    x1, y1, x2, y2 = box
                    detections.append({
                        "classId": int(cls),
                        "label": label,
                        "confidence": float(conf),
                        "box": {
                            "x": float(x1),
                            "y": float(y1),
                            "width": float(x2 - x1),
                            "height": float(y2 - y1)
                        }
                    })
        
        h, w = img_bgr.shape[:2]
        return detections, inference_time_ms, {"width": w, "height": h}

    async def infer(self, jpeg_bytes: bytes):
        if not self.warm:
            raise RuntimeError("Model is not warmed up and ready.")

        loop = asyncio.get_running_loop()
        img_bgr = await loop.run_in_executor(
            self.executor,
            lambda: cv2.imdecode(np.frombuffer(jpeg_bytes, np.uint8), cv2.IMREAD_COLOR)
        )
        if img_bgr is None:
            raise ValueError("Invalid image bytes")

        detections, inference_time_ms, source_dims = await loop.run_in_executor(
            self.executor,
            self.run_prediction,
            img_bgr
        )

        self.frames_processed += 1
        self.total_inference_time_ms += inference_time_ms

        return detections, inference_time_ms, source_dims

    def close(self):
        self.executor.shutdown(wait=True)

engine = InferenceEngine()
