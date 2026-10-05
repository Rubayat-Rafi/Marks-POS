import { Router } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";
import * as inventoryController from "./inventory.controller.js";

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

inventoryRouter.get(
  "/products",
  requirePermission("inventory.read"),
  asyncHandler(inventoryController.listProducts),
);

inventoryRouter.get(
  "/low-stock",
  requirePermission("inventory.read"),
  asyncHandler(inventoryController.getLowStock),
);

inventoryRouter.get(
  "/units/lookup",
  requirePermission("inventory.read"),
  asyncHandler(inventoryController.lookupUnit),
);

inventoryRouter.get(
  "/available",
  requirePermission("inventory.read"),
  asyncHandler(inventoryController.getAvailable),
);

inventoryRouter.get(
  "/products/:id",
  requirePermission("inventory.read"),
  asyncHandler(inventoryController.getProductById),
);

inventoryRouter.post(
  "/products",
  requirePermission("inventory.receive"),
  asyncHandler(inventoryController.createProduct),
);

inventoryRouter.delete(
  "/products/:id",
  requirePermission("inventory.manage"),
  asyncHandler(inventoryController.deleteProduct),
);

inventoryRouter.patch(
  "/products/:id",
  requirePermission("inventory.manage"),
  asyncHandler(inventoryController.updateProduct),
);

inventoryRouter.post(
  "/products/:id/units",
  requirePermission("inventory.receive"),
  asyncHandler(inventoryController.receiveUnits),
);

inventoryRouter.post(
  "/units/:id/remove",
  requirePermission("inventory.manage"),
  asyncHandler(inventoryController.removeUnit),
);

inventoryRouter.post(
  "/units/:id/restock",
  requirePermission("inventory.manage"),
  asyncHandler(inventoryController.restockUnit),
);
