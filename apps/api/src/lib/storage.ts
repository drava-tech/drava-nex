import type { StorageConfig } from "@workspace/storage"

import { env } from "../env"

/**
 * The storage configuration, or null when R2_* is not set. Routes that need
 * storage answer 503 STORAGE_UNAVAILABLE instead of failing obscurely.
 */
export const storage: StorageConfig | null =
  env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET && env.R2_ENDPOINT
    ? {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
        endpoint: env.R2_ENDPOINT,
        region: env.R2_REGION,
        ...(env.R2_PUBLIC_BASE_URL ? { publicBaseUrl: env.R2_PUBLIC_BASE_URL } : {}),
      }
    : null
