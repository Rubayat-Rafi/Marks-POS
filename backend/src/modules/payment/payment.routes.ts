import { Router } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";
import * as paymentController from "./payment.controller.js";

export const paymentRouter = Router();

paymentRouter.use(requireAuth);

paymentRouter.get(
  "/providers",
  requirePermission("payments.collect"),
  asyncHandler(paymentController.getProviders),
);

paymentRouter.post(
  "/attempts",
  requirePermission("payments.collect"),
  asyncHandler(paymentController.createAttempt),
);

paymentRouter.post(
  "/attempts/:id/resolve",
  requirePermission("payments.collect"),
  asyncHandler(paymentController.resolveAttemptHandler),
);

paymentRouter.post(
  "/attempts/:id/cancel",
  requirePermission("payments.collect"),
  asyncHandler(paymentController.cancelAttempt),
);

paymentRouter.post(
  "/manual",
  requirePermission("payments.collect"),
  asyncHandler(paymentController.recordManualPayment),
);

paymentRouter.post(
  "/deposits",
  requirePermission("payments.collect"),
  asyncHandler(paymentController.createDeposit),
);

paymentRouter.post(
  "/deposits/:depositId/apply",
  requirePermission("payments.collect"),
  asyncHandler(paymentController.applyDepositHandler),
);

paymentRouter.post(
  "/:paymentId/refund",
  requirePermission("payments.refund"),
  asyncHandler(paymentController.refundPayment),
);

paymentRouter.get(
  "/",
  requirePermission("finance.read"),
  asyncHandler(paymentController.listPayments),
);

paymentRouter.post(
  "/attempts/:id/simulate",
  requirePermission("payments.collect"),
  asyncHandler(paymentController.simulatePayment),
);
