import { Router } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";
import * as settingController from "./setting.controller.js";

export const settingRouter = Router();

settingRouter.use(requireAuth);

settingRouter.get(
  "/",
  requirePermission("settings.read"),
  asyncHandler(settingController.getSettings),
);

settingRouter.patch(
  "/organization",
  requirePermission("settings.write"),
  asyncHandler(settingController.updateOrganization),
);

// Staff
settingRouter.get(
  "/staff",
  requirePermission("settings.read"),
  asyncHandler(settingController.listStaff),
);

settingRouter.get(
  "/technicians",
  requirePermission("jobs.read"),
  asyncHandler(settingController.listTechnicians),
);

settingRouter.post(
  "/staff",
  requirePermission("staff.manage"),
  asyncHandler(settingController.addStaff),
);

settingRouter.patch(
  "/staff/:membershipId",
  requirePermission("staff.manage"),
  asyncHandler(settingController.updateStaff),
);

settingRouter.post(
  "/staff/:membershipId/deactivate",
  requirePermission("staff.manage"),
  asyncHandler(settingController.deactivateStaff),
);

settingRouter.delete(
  "/staff/:membershipId",
  requirePermission("staff.manage"),
  asyncHandler(settingController.deleteStaff),
);

// Labor rates
settingRouter.get(
  "/labor-rates",
  requirePermission("jobs.read"),
  asyncHandler(settingController.listLaborRates),
);

settingRouter.post(
  "/labor-rates",
  requirePermission("settings.write"),
  asyncHandler(settingController.createLaborRate),
);

settingRouter.delete(
  "/labor-rates/:id",
  requirePermission("settings.write"),
  asyncHandler(settingController.deleteLaborRate),
);

// Catalog
settingRouter.get(
  "/catalog",
  requirePermission("jobs.read"),
  asyncHandler(settingController.listCatalogItems),
);

settingRouter.get(
  "/catalog/:id",
  requirePermission("jobs.read"),
  asyncHandler(settingController.getCatalogItemById),
);

settingRouter.post(
  "/catalog",
  requirePermission("parts_catalog.write"),
  asyncHandler(settingController.createCatalogItem),
);

settingRouter.patch(
  "/catalog/:id",
  requirePermission("parts_catalog.write"),
  asyncHandler(settingController.updateCatalogItem),
);

settingRouter.delete(
  "/catalog/:id",
  requirePermission("parts_catalog.write"),
  asyncHandler(settingController.deleteCatalogItem),
);

settingRouter.post(
  "/catalog/:id/fitments",
  requirePermission("parts_catalog.write"),
  asyncHandler(settingController.addFitment),
);

settingRouter.delete(
  "/catalog/fitments/:fitmentId",
  requirePermission("parts_catalog.write"),
  asyncHandler(settingController.deleteFitment),
);

// Audit
settingRouter.get(
  "/audit",
  requirePermission("audit.read"),
  asyncHandler(settingController.listAuditTrail),
);

// Bootstrap accounts
settingRouter.post(
  "/bootstrap-accounts",
  requirePermission("settings.write"),
  asyncHandler(settingController.bootstrapAccounts),
);

// Remove all data
settingRouter.post(
  "/clear-all-data",
  requirePermission("settings.write"),
  asyncHandler(settingController.clearAllData),
);

