import { type Request, type Response } from "express";
import { db } from "../../db.js";
import { ApiError } from "../../middlewares/error.middleware.js";
import { auth } from "../../middlewares/auth.middleware.js";
import { auditContext, recordAudit } from "../../lib/audit.js";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  buildKey,
  getFileStore,
  keyBelongsTo,
  signKey,
  sniffImageType,
  verifySignature,
} from "../../lib/storage.js";

export const uploadInspectionImage = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const body = req.body as Buffer;

  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw ApiError.badRequest("Send the image as the raw request body.");
  }
  if (body.length > MAX_UPLOAD_BYTES) {
    throw ApiError.unprocessable(
      `That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`,
    );
  }

  const sniffed = sniffImageType(body);
  if (!sniffed) {
    throw ApiError.unprocessable(
      "That file is not a JPEG, PNG, WebP or HEIC image. Upload a photo taken by the camera.",
    );
  }

  const extension = ALLOWED_IMAGE_TYPES[sniffed];
  const key = buildKey(ctx.organizationId, "inspections", extension);
  const stored = await getFileStore().put(key, body, sniffed);

  await recordAudit(db, {
    organizationId: ctx.organizationId,
    ...auditContext(req),
    action: "file.uploaded",
    resourceType: "file",
    resourceId: key,
    metadata: { contentType: sniffed, size: stored.size },
  });

  res.status(201).json({
    key,
    contentType: sniffed,
    size: stored.size,
    url: signKey(key),
  });
};

export const signFileKeys = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const keys = (req.body?.keys ?? []) as unknown;

  if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
    throw ApiError.badRequest("Send { keys: string[] }.");
  }
  if (keys.length > 100) {
    throw ApiError.unprocessable("Ask for at most 100 links at a time.");
  }

  res.json({
    urls: Object.fromEntries(
      (keys as string[])
        .filter((key) => keyBelongsTo(key, ctx.organizationId))
        .map((key) => [key, signKey(key)]),
    ),
  });
};

export const serveFile = async (req: Request, res: Response) => {
  const key = decodeURIComponent(req.params.key);
  const expires = String(req.query.expires ?? "");
  const signature = String(req.query.signature ?? "");

  if (!verifySignature(key, expires, signature)) {
    throw ApiError.forbidden("This file link is invalid or has expired.");
  }

  const file = await getFileStore().get(key);
  if (!file) throw ApiError.notFound("That file is no longer stored.");

  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(file.body);
};
