import { Router } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";
import * as timeClockController from "./timeClock.controller.js";

export const timeClockRouter = Router();

timeClockRouter.use(requireAuth);

timeClockRouter.get("/status", asyncHandler(timeClockController.getStatus));
timeClockRouter.post("/in", asyncHandler(timeClockController.clockIn));
timeClockRouter.post("/out", asyncHandler(timeClockController.clockOut));
timeClockRouter.get("/me", asyncHandler(timeClockController.getMyHistory));

timeClockRouter.get(
  "/",
  requirePermission("payroll.read"),
  asyncHandler(timeClockController.listAllEntries),
);

timeClockRouter.patch(
  "/:id",
  requirePermission("payroll.write"),
  asyncHandler(timeClockController.updateEntry),
);

timeClockRouter.get(
  "/payroll-summary",
  requirePermission("payroll.read"),
  asyncHandler(timeClockController.getPayrollSummary),
);
