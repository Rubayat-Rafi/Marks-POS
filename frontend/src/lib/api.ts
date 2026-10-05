/**
 * Thin API client.
 *
 * Every money movement and order carries an idempotency key, error shapes are
 * unwrapped consistently, and the session rides in an httpOnly cookie
 * (build guide / 11).
 */

/**
 * Split-domain deployment: the SPA (https://marks.chromopay.com) talks
 * straight to the API (https://auto.chromopay.com). Baked in at build time
 * from frontend/.env.production (VITE_API_URL). Same-origin proxying via
 * .htaccess [P] is not available on this host (it 503s), so the cookie is a
 * cross-site Secure=None cookie and CORS allows the frontend origin.
 */
const BASE =
  `${import.meta.env.VITE_API_URL ?? ""}/api/v1`.replace(/\/+$/, "") || "/api/v1";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    public readonly requestId?: string,
  ) {
    super(message);
  }

  get isPermissionDenied() {
    return this.status === 403;
  }
  get isConflict() {
    return this.status === 409;
  }
}

/**
 * The session lives in an httpOnly cookie set by the API, so page script
 * never sees the token and an injected script cannot steal it. Every request
 * carries X-Requested-With, which the API requires on cookie-authenticated
 * writes to block cross-site request forgery.
 */
const SECURITY_HEADERS = { "X-Requested-With": "fetch" };

/** Called when the API says the session is gone; the auth context clears the user. */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  /** Public pages (approval link, checkout, booking): a 401 is not a sign-out. */
  anonymous?: boolean;
  signal?: AbortSignal;
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS },
    credentials: "include",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = payload?.error ?? {};
    // A revoked or expired session sends the user back to sign-in rather than
    // leaving the app in a half-authorised state.
    if (response.status === 401 && !options.anonymous) onSessionExpired?.();
    throw new ApiClientError(
      response.status,
      error.code ?? "unknown",
      error.message ??
        (response.status === 429 ? "Too many requests. Wait a minute and try again." : "Something went wrong."),
      error.fields,
      payload?.requestId,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>(path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "PUT", body }),
  delete: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { ...opts, method: "DELETE" }),
};

/**
 * Upload an image as a raw body.
 *
 * Deliberately not JSON: base64 inflates a phone photo by a third, and the
 * server sniffs the real format from the bytes anyway.
 */
export async function uploadImage(
  path: string,
  file: File,
): Promise<{ key: string; url: string; contentType: string; size: number }> {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "image/jpeg", ...SECURITY_HEADERS },
    credentials: "include",
    body: file,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload?.error ?? {};
    throw new ApiClientError(
      response.status,
      error.code ?? "upload_failed",
      error.message ?? "That photo could not be uploaded.",
      error.fields,
      payload?.requestId,
    );
  }
  return payload;
}

/**
 * A stable key for one intended money movement.
 *
 * Generated once when the operator opens the payment form, not per click, so a
 * double submit or a retry resolves to the same attempt (build guide / 09).
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
