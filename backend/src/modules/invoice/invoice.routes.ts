import { Router } from "express";
import * as invoicesController from "./invoice.controller.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";

export const invoiceRouter = Router();

invoiceRouter.use(requireAuth);

invoiceRouter.get(
  "/",
  requirePermission("invoices.read"),
  asyncHandler(invoicesController.listInvoices),
);

invoiceRouter.get(
  "/:id",
  requirePermission("invoices.read"),
  asyncHandler(invoicesController.getInvoice),
);

invoiceRouter.post(
  "/from-repair-order/:repairOrderId",
  requirePermission("invoices.write"),
  asyncHandler(invoicesController.createInvoiceFromRepairOrder),
);

invoiceRouter.post(
  "/:id/issue",
  requirePermission("invoices.write"),
  asyncHandler(invoicesController.issueInvoiceHandler),
);

invoiceRouter.post(
  "/:id/credit-note",
  requirePermission("credits.issue"),
  asyncHandler(invoicesController.createCreditNote),
);

invoiceRouter.post(
  "/:id/void",
  requirePermission("invoices.write"),
  asyncHandler(invoicesController.voidInvoice),
);

invoiceRouter.post(
  "/repair-orders/:repairOrderId/recognize-costs",
  requirePermission("finance.read"),
  asyncHandler(invoicesController.recognizeCosts),
);

invoiceRouter.delete(
  "/:id",
  requirePermission("invoices.write"),
  asyncHandler(invoicesController.deleteInvoice),
);
