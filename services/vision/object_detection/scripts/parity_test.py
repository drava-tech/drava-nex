"""
parity_test.py — compare .onnx vs .pt outputs on the test split.

Needs onnxruntime on top of the training deps: pip install onnxruntime

Usage:
    cd services
    python -m vision.object_detection.scripts.parity_test
"""

import os
import glob
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

# Anchored to the package, not the shell's cwd — the scripts are run from
# services/ as modules, so relative paths would resolve against the wrong root.
_ROOT = Path(__file__).resolve().parent.parent


def main():
    pt_model_path = os.environ.get(
        "VISION_SERVER_MODEL_PATH", str(_ROOT / "models" / "production" / "coster-v1.pt")
    )
    onnx_model_path = str(_ROOT / "models" / "production" / "coster-v1.onnx")

    test_images_dir = str(_ROOT / "datasets" / "coster-v1" / "images" / "test")
    image_paths = glob.glob(os.path.join(test_images_dir, "*.jpg"))
    
    if not image_paths:
        print(f"No test images found in {test_images_dir}")
        return
        
    print(f"Found {len(image_paths)} test images.")
    
    # 1. Load YOLO PyTorch model
    print(f"Loading PT model: {pt_model_path}")
    pt_model = YOLO(pt_model_path)
    device = "cuda:0"
    try:
        import torch
        if torch.cuda.is_available():
            pt_model.to(device)
            print("Using CUDA device for PyTorch model.")
        else:
            device = "cpu"
            print("CUDA not available. Using CPU for PyTorch model.")
    except ImportError:
        device = "cpu"
        print("Torch not installed. Using CPU for PyTorch model.")
        
    # 2. Load ONNX model
    print(f"Loading ONNX model: {onnx_model_path}")
    try:
        import onnxruntime as ort
        ort_sess = ort.InferenceSession(onnx_model_path, providers=["CPUExecutionProvider"])
    except ImportError:
        print("onnxruntime is not installed. Please install it using `pip install onnxruntime` to run ONNX parity tests.")
        ort_sess = None

    print("\n--- Running Parity Tests ---")
    print(f"{'Image':<20} | {'PT Conf':<10} | {'ONNX Conf':<10} | {'Delta':<10} | {'Agreement':<10}")
    print("-" * 65)
    
    threshold = 0.4
    agreements = 0
    deltas = []
    
    for img_path in image_paths:
        img_name = os.path.basename(img_path)
        img = cv2.imread(img_path)
        if img is None:
            continue
            
        # A. PT Inference
        pt_res = pt_model.predict(img, conf=0.01, imgsz=640, device=device, verbose=False)[0]
        pt_conf = 0.0
        if pt_res.boxes is not None and len(pt_res.boxes) > 0:
            clss = pt_res.boxes.cls.cpu().numpy()
            confs = pt_res.boxes.conf.cpu().numpy()
            coster_indices = np.where(clss == 0)[0]
            if len(coster_indices) > 0:
                pt_conf = float(np.max(confs[coster_indices]))

        # B. ONNX Inference (replicating browser-mode offscreen canvas preprocessing & argmax-no-NMS)
        onnx_conf = 0.0
        if ort_sess is not None:
            h, w = img.shape[:2]
            scale = min(640 / w, 640 / h)
            nw = int(w * scale)
            nh = int(h * scale)
            resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
            
            # Symmetrical gray padding
            input_img = np.full((640, 640, 3), 114, dtype=np.uint8)
            pad_x = (640 - nw) // 2
            pad_y = (640 - nh) // 2
            input_img[pad_y : pad_y + nh, pad_x : pad_x + nw] = resized
            
            # BGR -> RGB
            input_img = cv2.cvtColor(input_img, cv2.COLOR_BGR2RGB)
            
            blob = input_img.astype(np.float32) / 255.0
            blob = np.transpose(blob, (2, 0, 1))
            blob = np.expand_dims(blob, axis=0)
            
            inputs = {ort_sess.get_inputs()[0].name: blob}
            outputs = ort_sess.run(None, inputs)
            
            output = outputs[0][0]
            confs = output[4, :]
            onnx_conf = float(np.max(confs))

        delta = abs(pt_conf - onnx_conf) if ort_sess else 0.0
        deltas.append(delta)
        
        pt_detect = pt_conf >= threshold
        onnx_detect = onnx_conf >= threshold if ort_sess else pt_detect
        
        agree = pt_detect == onnx_detect
        if agree:
            agreements += 1
            
        agree_str = "YES" if agree else "NO"
        onnx_conf_str = f"{onnx_conf:.4f}" if ort_sess else "N/A"
        delta_str = f"{delta:.4f}" if ort_sess else "N/A"
        
        print(f"{img_name:<20} | {pt_conf:<10.4f} | {onnx_conf_str:<10} | {delta_str:<10} | {agree_str:<10}")

    if ort_sess and deltas:
        print("-" * 65)
        print(f"Average confidence delta: {np.mean(deltas):.4f}")
        print(f"Max confidence delta: {np.max(deltas):.4f}")
        print(f"Decision agreement at {threshold}: {agreements / len(image_paths) * 100:.1f}%")

if __name__ == "__main__":
    main()
