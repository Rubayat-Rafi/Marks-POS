import { Router } from "express";
import * as estimatesController from "./estimate.controller.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";

export const estimateRouter = Router();

estimateRouter.use(requireAuth);

estimateRouter.get(
  "/",
  requirePermission("estimates.read"),
  asyncHandler(estimatesController.listEstimates),
);

estimateRouter.get(
  "/:id",
  requirePermission("estimates.read"),
  asyncHandler(estimatesController.getEstimate),
);

estimateRouter.post(
  "/",
  requirePermission("estimates.write"),
  asyncHandler(estimatesController.createEstimate),
);

estimateRouter.put(
  "/versions/:versionId/lines",
  requirePermission("estimates.write"),
  asyncHandler(estimatesController.updateVersionLines),
);

estimateRouter.post(
  "/versions/:versionId/send",
  requirePermission("estimates.write"),
  asyncHandler(estimatesController.sendVersion),
);

estimateRouter.post(
  "/:id/revise",
  requirePermission("estimates.write"),
  asyncHandler(estimatesController.reviseEstimate),
);
