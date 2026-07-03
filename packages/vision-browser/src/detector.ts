import * as ort from "onnxruntime-web";
import { preprocessFrame, MODEL_INPUT_SIZE } from "./preprocess.js";
import type { Detection } from "./types.js";

const INPUT_NAME = "images";
const OUTPUT_NAME = "output0";

/**
 * Wraps an ONNX-exported YOLO model (see the model-conversion step in the
 * plan — exported WITHOUT nms=True) for single-frame inference in the browser.
 * Mirrors services/product-vision/src/detector.py: tracks the single
 * highest-confidence detection across all anchors, no NMS needed, since only
 * the best score is ever kept (matching detector.py:82-83 exactly).
 *
 * Raw output shape is [1, 5, 8400]: 4 box params (unused — the wire contract
 * this feeds only carries label/confidence, never a bbox) + 1 class score,
 * channel-major (must index as channel*numAnchors + anchor, not anchor-major).
 * Scores are already sigmoid-activated by the model — no extra activation step.
 */
export class Detector {
  private session: ort.InferenceSession | null = null;

  constructor(
    private modelUrl: string,
    private label: string,
    private confidenceThreshold: number
  ) {}

  async load(): Promise<void> {
    // SIMD + multithreaded WASM binaries are copied to
    // apps/cms/public/display/ort/ (from node_modules/onnxruntime-web/dist) —
    // nested under /display/ so the auth middleware's pass-through for that
    // prefix covers them too (the model file follows the same convention).
    // Multithreading additionally needs cross-origin isolation (COOP/COEP
    // headers, added in next.config.mjs for /display/* routes) — without
    // those headers the browser silently falls back to single-threaded.
    ort.env.wasm.wasmPaths = "/display/ort/";
    ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;

    this.session = await ort.InferenceSession.create(this.modelUrl, {
      executionProviders: ["wasm"],
    });
  }

  async detect(image: ImageBitmap): Promise<Detection | null> {
    if (!this.session) {
      throw new Error("[detector] Model is not loaded. Call load() first.");
    }

    const inputData = preprocessFrame(image);
    const inputTensor = new ort.Tensor("float32", inputData, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);
    const outputs = await this.session.run({ [INPUT_NAME]: inputTensor });
    const output = outputs[OUTPUT_NAME];
    if (!output) {
      throw new Error(`[detector] Model output missing '${OUTPUT_NAME}'`);
    }

    const data = output.data as Float32Array;
    const numAnchors = output.dims[2]!;
    const scoreChannelOffset = 4 * numAnchors; // channel index 4 = the (single) class score

    let bestScore = 0;
    for (let i = 0; i < numAnchors; i++) {
      const score = data[scoreChannelOffset + i]!;
      if (score > bestScore) bestScore = score;
    }

    // Temporary debug signal while tuning against the native service's
    // detections — shows the raw best score every inference, pass or fail,
    // so a near-miss (score just under threshold) is distinguishable from a
    // pipeline bug (score stuck near 0 regardless of what's in frame).
    console.debug(`[detector] best score: ${bestScore.toFixed(3)} (threshold ${this.confidenceThreshold})`);

    if (bestScore < this.confidenceThreshold) return null;
    return { label: this.label, confidence: bestScore };
  }
}
