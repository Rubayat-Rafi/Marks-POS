import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));

// dotenv resolution order (later wins):
//   1. backend/.env                 (folder next to package.json)
//   2. $PWD/.env                    (current working directory)
dotenv.config({ path: path.resolve(here, "../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env at the repository root.`,
    );
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

/**
 * Which database the app is actually pointed at, without the password.
 *
 * A wrong database name in DATABASE_URL connects perfectly well and then fails
 * every query, which is indistinguishable from "tables missing" unless the
 * target is visible. Logged at boot and echoed by /api/health.
 */
function databaseTarget(): { host: string; port: string; database: string; user: string } {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return {
      host: url.hostname,
      port: url.port || "3306",
      database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "(none)",
      user: decodeURIComponent(url.username) || "(none)",
    };
  } catch {
    return { host: "(unparsable)", port: "", database: "(unparsable)", user: "(unparsable)" };
  }
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * A guessable signing secret lets anyone mint a session for any shop. In
 * production the API refuses to start on a short or example secret rather
 * than running quietly insecure.
 */
function jwtSecret(): string {
  const raw = process.env.JWT_SECRET;
  const secret = raw?.trim().replace(/^["']|["']$/g, "");
  if (!secret) {
    throw new Error(
      "Missing required environment variable JWT_SECRET. Set it in the Hostinger Node.js app Environment variables (or in backend/.env next to package.json).",
    );
  }
  if (isProduction && (secret.length < 32 || /change-me|dev-only/i.test(secret))) {
    throw new Error(
      `JWT_SECRET is too weak for production (got ${secret.length} chars). Set a random string of at least 32 characters in the Hostinger Node.js app Environment variables.`,
    );
  }
  return secret;
}

function cookieSameSite(): "lax" | "strict" | "none" {
  const value = (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase();
  if (value !== "lax" && value !== "strict" && value !== "none") {
    throw new Error(`COOKIE_SAMESITE must be lax, strict or none (got "${value}").`);
  }
  if (value === "none" && !bool("COOKIE_SECURE", isProduction)) {
    throw new Error(
      "COOKIE_SAMESITE=none requires COOKIE_SECURE=true; browsers drop a SameSite=None cookie that is not Secure.",
    );
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction,
  // cPanel's Passenger assigns the port and passes it as PORT; it must win, or
  // the app listens where nothing is proxying to it and the domain 503s.
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  /** Non-secret view of the connection target, for boot logs and /api/health. */
  db: databaseTarget(),
  jwtSecret: jwtSecret(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  publicWebUrl: process.env.PUBLIC_WEB_URL ?? "http://localhost:5173",
  /**
   * Public origin of THIS API, used to build absolute links that are opened by
   * the browser (inspection photos, QR targets). Empty means "same origin", so
   * the single-domain deployment keeps working with no config. Split-domain
   * (SPA on one host, API on another) MUST set this, or a signed photo URL like
   * /api/v1/files/... resolves against the SPA host and 404s.
   */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? "").replace(/\/+$/, ""),
  paymentProvider: process.env.PAYMENT_PROVIDER ?? "mock",
  mockWebhookSecret: process.env.MOCK_WEBHOOK_SECRET ?? "mock-webhook-secret",
  vinDecodeEnabled: bool("VIN_DECODE_ENABLED", true),
  nhtsaBaseUrl: process.env.NHTSA_BASE_URL ?? "https://vpic.nhtsa.dot.gov/api",
  /**
   * The in-memory mock processor and its "simulate approval" buttons move no
   * real money, so they are off in production unless explicitly allowed for a
   * staging demo. Cash and the external card machine never depend on it.
   */
  demoPayments: bool("ALLOW_DEMO_PAYMENTS", !isProduction),
  /** Which shop the public website belongs to (booking, estimate lookup). */
  publicShopSlug: process.env.PUBLIC_SHOP_SLUG ?? "marks-tire-muffler",
  /** Session cookie: Secure in production so it never travels over plain HTTP. */
  cookieSecure: bool("COOKIE_SECURE", isProduction),
  /**
   * "lax" is correct for the supported single-domain deployment, where the web
   * app and /api share an origin. Only the fallback split-domain setup (API on
   * its own subdomain) needs "none", and browsers reject SameSite=None without
   * Secure, so that combination is refused here rather than failing at login.
   */
  cookieSameSite: cookieSameSite(),
};
