import { Router, raw } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "../../lib/storage.js";
import * as mediaController from "./media.controller.js";

export const mediaRouter = Router();

mediaRouter.post(
  "/inspections",
  requireAuth,
  requirePermission("inspections.write"),
  raw({ type: Object.keys(ALLOWED_IMAGE_TYPES), limit: MAX_UPLOAD_BYTES }),
  asyncHandler(mediaController.uploadInspectionImage),
);

mediaRouter.post(
  "/sign",
  requireAuth,
  asyncHandler(mediaController.signFileKeys),
);

mediaRouter.get(
  "/:key(*)",
  asyncHandler(mediaController.serveFile),
);
