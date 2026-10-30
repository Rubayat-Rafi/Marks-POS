import { Router } from "express";
import * as customerController from "./customer.controller.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";

export const customerRouter = Router();

customerRouter.use(requireAuth);

customerRouter.get(
  "/",
  requirePermission("customers.read"),
  asyncHandler(customerController.listCustomers),
);

customerRouter.get(
  "/:id",
  requirePermission("customers.read"),
  asyncHandler(customerController.getCustomer),
);

customerRouter.post(
  "/",
  requirePermission("customers.write"),
  asyncHandler(customerController.createCustomer),
);

customerRouter.patch(
  "/:id",
  requirePermission("customers.write"),
  asyncHandler(customerController.updateCustomer),
);

customerRouter.post(
  "/:id/archive",
  requirePermission("customers.write"),
  asyncHandler(customerController.archiveCustomer),
);

customerRouter.delete(
  "/:id",
  requirePermission("customers.write"),
  asyncHandler(customerController.deleteCustomer),
);
