import { Router } from "express";
import * as roController from "./repairOrder.controller.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";

export const repairOrderRouter = Router();

repairOrderRouter.use(requireAuth);

repairOrderRouter.get(
  "/board",
  requirePermission("jobs.read"),
  asyncHandler(roController.getWorkBoard),
);

repairOrderRouter.get(
  "/",
  requirePermission("jobs.read"),
  asyncHandler(roController.listRepairOrders),
);

repairOrderRouter.get(
  "/:id",
  requirePermission("jobs.read"),
  asyncHandler(roController.getRepairOrder),
);

repairOrderRouter.post(
  "/",
  requirePermission("jobs.write"),
  asyncHandler(roController.createRepairOrder),
);

repairOrderRouter.post(
  "/:id/status",
  requirePermission("jobs.write"),
  asyncHandler(roController.updateRepairOrderStatus),
);

repairOrderRouter.post(
  "/:id/tasks",
  requirePermission("jobs.write"),
  asyncHandler(roController.addTask),
);

repairOrderRouter.patch(
  "/tasks/:taskId",
  requirePermission("jobs.technician"),
  asyncHandler(roController.updateTask),
);

repairOrderRouter.post(
  "/:id/time",
  requirePermission("jobs.technician"),
  asyncHandler(roController.addTimeEntry),
);

repairOrderRouter.post(
  "/:id/parts",
  requirePermission("jobs.write"),
  asyncHandler(roController.addPartUsage),
);

repairOrderRouter.post(
  "/parts/:usageId/return",
  requirePermission("jobs.write"),
  asyncHandler(roController.returnPartUsage),
);

repairOrderRouter.post(
  "/:id/inspections",
  requirePermission("inspections.write"),
  asyncHandler(roController.addInspection),
);
