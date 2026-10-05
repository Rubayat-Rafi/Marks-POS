import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "../env.js";

/**
 * Private object storage for inspection photos and receipts.
 *
 * Build guide / 05 and / 12: files live in private storage behind signed access
 * links, and the file metadata carries tenant ownership and access scope. The
 * key itself encodes the tenant, so a key from one shop cannot be signed for a
 * session belonging to another.
 *
 * The default implementation writes to local disk. It is deliberately not a
 * pretend S3: it is honest about being a single-machine store, and the
 * interface matches what an S3-compatible adapter needs so swapping it is a
 * one-file change.
 */

export type StoredFile = {
  /** Tenant-scoped opaque key, e.g. "org/<uuid>/inspections/<uuid>.jpg". */
  key: string;
  contentType: string;
  size: number;
};

export interface FileStore {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<StoredFile>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  remove(key: string): Promise<void>;
}

/** Only formats we can safely serve back. No SVG: it executes script. */
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Magic-number check. An upload that claims image/jpeg but is not one is
 * rejected, because the declared content type comes from the client and the
 * client is not trusted (build guide / 12).
 */
export function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("mif1")) {
      return "image/heic";
    }
  }
  return null;
}

class LocalDiskStore implements FileStore {
  readonly name = "local-disk";
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  /** Refuses any key that could escape the storage root. */
  private resolve(key: string): string {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) {
      throw new Error("Rejected a file key that escapes the storage root.");
    }
    return full;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredFile> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
    await fs.writeFile(`${full}.meta`, JSON.stringify({ contentType }), "utf8");
    return { key, contentType, size: body.length };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | null> {
    try {
      const full = this.resolve(key);
      const body = await fs.readFile(full);
      const meta = await fs
        .readFile(`${full}.meta`, "utf8")
        .then((raw) => JSON.parse(raw) as { contentType: string })
        .catch(() => ({ contentType: "application/octet-stream" }));
      return { body, contentType: meta.contentType };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    const full = this.resolve(key);
    await fs.rm(full, { force: true });
    await fs.rm(`${full}.meta`, { force: true });
  }
}

let store: FileStore | null = null;

export function getFileStore(): FileStore {
  if (!store) {
    store = new LocalDiskStore(process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "uploads"));
  }
  return store;
}

/** Keys always begin with the tenant, so ownership is visible in the key. */
export function buildKey(organizationId: string, folder: string, extension: string): string {
  return `org/${organizationId}/${folder}/${crypto.randomUUID()}.${extension}`;
}

export function keyBelongsTo(key: string, organizationId: string): boolean {
  return key.startsWith(`org/${organizationId}/`);
}

/**
 * Short-lived signed link.
 *
 * The signature covers the key AND the expiry, so neither can be edited in the
 * URL bar. Links expire because an inspection photo of someone's car is not
 * something to leave permanently public (build guide / 03).
 *
 * Absolute when PUBLIC_API_URL is set (split-domain: the SPA is on another
 * host, so a relative link would be requested from the wrong origin), relative
 * otherwise (single-domain).
 */
export function signKey(key: string, ttlSeconds = 600): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = crypto
    .createHmac("sha256", env.jwtSecret)
    .update(`${key}:${expires}`)
    .digest("hex");
  return `${env.publicApiUrl}/api/v1/files/${encodeURIComponent(key)}?expires=${expires}&signature=${signature}`;
}

export function verifySignature(key: string, expires: string, signature: string): boolean {
  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;

  const expected = crypto
    .createHmac("sha256", env.jwtSecret)
    .update(`${key}:${expiresAt}`)
    .digest("hex");

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
