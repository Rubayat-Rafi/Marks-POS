import { Router } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";
import * as reportController from "./report.controller.js";

export const reportRouter = Router();

reportRouter.use(requireAuth);

reportRouter.get(
  "/dashboard",
  requirePermission("jobs.read"),
  asyncHandler(reportController.getDashboard),
);

reportRouter.get(
  "/daily-sales",
  requirePermission("reports.sales"),
  asyncHandler(reportController.getDailySales),
);

reportRouter.get(
  "/job-margins",
  requirePermission("reports.costs"),
  asyncHandler(reportController.getJobMargins),
);

reportRouter.get(
  "/technician-hours",
  requirePermission("reports.costs"),
  asyncHandler(reportController.getTechnicianHours),
);

reportRouter.get(
  "/reconciliation-summary",
  requirePermission("finance.read"),
  asyncHandler(reportController.getReconciliationSummary),
);
