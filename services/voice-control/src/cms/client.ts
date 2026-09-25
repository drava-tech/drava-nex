import { randomUUID } from "node:crypto";
import type { CmsRequest } from "../commands/resolve.js";

/**
 * Client for apps/api's voice-control API (/api/voice-control/*, see
 * apps/api/src/routes/voice-control.ts). This is the ONLY way voice control
 * touches anything: the CMS resolves names, drives Casambi/Tuya/Home
 * Assistant and updates screens. No device credentials or database access
 * live here.
 *
 * Auth is this service's own shared secret (x-travis-vc-key =
 * TRAVIS_VC_KEY, the same value set in the API's environment).
 * Every command carries an x-idempotency-key, reused on the single retry, so
 * a request that reached the CMS but lost its response is replayed rather
 * than actuated twice.
 */

export class CmsError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number | null,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

export interface CmsResult {
  message: string;
  /** Real names the API acted on. */
  targets?: string[];
}

interface Envelope {
  success?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

export interface CmsClientOptions {
  baseUrl: string;
  secret: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
}

export class CmsClient {
  private sessionId: string | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: CmsClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Tags one wake-to-reply exchange so its requests can be grouped in the API log. */
  setSessionId(id: string | null): void {
    this.sessionId = id;
  }

  async send(request: CmsRequest): Promise<CmsResult> {
    const data = await this.request("POST", `/${request.endpoint}`, request.body, randomUUID());
    return data as CmsResult;
  }

  private async request(method: string, path: string, body: unknown, idempotencyKey: string): Promise<unknown> {
    if (!this.options.secret) {
      throw new CmsError("Voice control isn't configured: TRAVIS_VC_KEY is not set.", "NOT_CONFIGURED", null);
    }
    const url = `${this.options.baseUrl}/api/voice-control${path}`;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-travis-vc-key": this.options.secret,
      "x-idempotency-key": idempotencyKey,
    };
    if (this.sessionId) headers["x-session-id"] = this.sessionId;
    const init = { method, headers, body: JSON.stringify(body) };

    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.options.timeoutMs) });
    } catch {
      // One retry on a network-level failure; same idempotency key, so the
      // CMS replays the first result if that attempt actually landed.
      await new Promise((r) => setTimeout(r, this.options.retryDelayMs ?? 300));
      try {
        res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.options.timeoutMs) });
      } catch (err) {
        throw new CmsError(`I couldn't reach the CMS.`, "UNREACHABLE", null, { cause: err });
      }
    }

    let envelope: Envelope = {};
    try {
      envelope = (await res.json()) as Envelope;
    } catch {
      // Non-JSON body (proxy error page etc.) — fall through to the status check.
    }
    if (!res.ok || !envelope.success) {
      throw new CmsError(
        envelope.error?.message ?? `The CMS request failed (${res.status}).`,
        envelope.error?.code ?? "HTTP_ERROR",
        res.status
      );
    }
    return envelope.data;
  }
}
