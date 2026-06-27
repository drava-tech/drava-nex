import { getProductByDetectionLabel } from "@platform/db";
import { productDetectedEventSchema } from "@platform/types";

/**
 * Camera-detection resolver (foundation for future vision integration).
 *
 * Responsibility: validate a detection event, enforce a minimum confidence, and
 * resolve the machine-friendly label to an ACTIVE product. It deliberately does
 * NOT change any display — that wiring is added once the display architecture
 * supports it safely. A camera service will call this and then decide what to do
 * with the returned productId.
 */

export type DetectionReason = "INVALID_EVENT" | "LOW_CONFIDENCE" | "NO_MATCH";

export interface DetectionResolution {
  matched: boolean;
  productId?: string;
  name?: string;
  confidence?: number;
  reason?: DetectionReason;
}

export interface DetectionInput {
  cameraId: string;
  detectionLabel: string;
  confidence: number;
  detectedAt?: string;
}

function minConfidence(): number {
  const raw = Number(process.env["DETECTION_MIN_CONFIDENCE"]);
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.7;
}

export async function resolveDetectedProduct(
  input: DetectionInput
): Promise<DetectionResolution> {
  const parsed = productDetectedEventSchema.safeParse({
    type: "PRODUCT_DETECTED",
    cameraId: input.cameraId,
    label: input.detectionLabel,
    confidence: input.confidence,
    detectedAt: input.detectedAt ?? new Date().toISOString(),
  });
  if (!parsed.success) return { matched: false, reason: "INVALID_EVENT" };

  if (parsed.data.confidence < minConfidence()) {
    return { matched: false, confidence: parsed.data.confidence, reason: "LOW_CONFIDENCE" };
  }

  const product = await getProductByDetectionLabel(parsed.data.label);
  if (!product) return { matched: false, confidence: parsed.data.confidence, reason: "NO_MATCH" };

  return {
    matched: true,
    productId: product.productId,
    name: product.name,
    confidence: parsed.data.confidence,
  };
}
