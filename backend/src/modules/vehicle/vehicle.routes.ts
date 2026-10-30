import { Router } from "express";
import * as vehicleController from "./vehicle.controller.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";

export const vehicleRouter = Router();

vehicleRouter.use(requireAuth);

vehicleRouter.get(
  "/",
  requirePermission("vehicles.read"),
  asyncHandler(vehicleController.listVehicles),
);

vehicleRouter.get(
  "/reference/makes",
  requirePermission("vehicles.read"),
  asyncHandler(vehicleController.getReferenceMakes),
);

vehicleRouter.get(
  "/reference/models",
  requirePermission("vehicles.read"),
  asyncHandler(vehicleController.getReferenceModels),
);

vehicleRouter.get(
  "/:id",
  requirePermission("vehicles.read"),
  asyncHandler(vehicleController.getVehicle),
);

vehicleRouter.post(
  "/",
  requirePermission("vehicles.write"),
  asyncHandler(vehicleController.createVehicle),
);

vehicleRouter.patch(
  "/:id",
  requirePermission("vehicles.write"),
  asyncHandler(vehicleController.updateVehicle),
);

vehicleRouter.post(
  "/:id/mileage",
  requirePermission("vehicles.write"),
  asyncHandler(vehicleController.addMileage),
);

vehicleRouter.post(
  "/:id/owners",
  requirePermission("vehicles.write"),
  asyncHandler(vehicleController.addOwner),
);

vehicleRouter.post(
  "/decode-vin",
  requirePermission("vehicles.read"),
  asyncHandler(vehicleController.decodeVin),
);

vehicleRouter.post(
  "/:id/apply-decode",
  requirePermission("vehicles.write"),
  asyncHandler(vehicleController.applyDecode),
);

vehicleRouter.delete(
  "/:id",
  requirePermission("vehicles.write"),
  asyncHandler(vehicleController.deleteVehicle),
);
