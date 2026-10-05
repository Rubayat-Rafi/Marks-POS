import { Router } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";
import * as quickSaleController from "./quickSale.controller.js";

export const quickSaleRouter = Router();

quickSaleRouter.use(requireAuth);

quickSaleRouter.post(
  "/preview",
  requirePermission("sales.quick"),
  asyncHandler(quickSaleController.previewSale),
);

quickSaleRouter.post(
  "/",
  requirePermission("sales.quick"),
  asyncHandler(quickSaleController.createQuickSale),
);
