import { Router } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";
import * as financeController from "./finance.controller.js";

export const financeRouter = Router();

financeRouter.use(requireAuth);

// Expenses
financeRouter.get(
  "/expenses",
  requirePermission("finance.read"),
  asyncHandler(financeController.listExpenses),
);
financeRouter.post(
  "/expenses",
  requirePermission("expenses.write"),
  asyncHandler(financeController.createExpense),
);

// Receivables
financeRouter.get(
  "/receivables",
  requirePermission("finance.read"),
  asyncHandler(financeController.getReceivables),
);

// Cash Sessions
financeRouter.get(
  "/cash-sessions",
  requirePermission("finance.read"),
  asyncHandler(financeController.listCashSessions),
);
financeRouter.post(
  "/cash-sessions",
  requirePermission("finance.reconcile"),
  asyncHandler(financeController.openCashSession),
);
financeRouter.post(
  "/cash-sessions/:id/close",
  requirePermission("finance.reconcile"),
  asyncHandler(financeController.closeCashSession),
);
financeRouter.get(
  "/daily-closing",
  requirePermission("finance.read"),
  asyncHandler(financeController.getDailyClosingSummary),
);


// Reconciliation
financeRouter.get(
  "/reconciliation",
  requirePermission("finance.reconcile"),
  asyncHandler(financeController.listReconciliationItems),
);
financeRouter.post(
  "/reconciliation/:id/resolve",
  requirePermission("finance.reconcile"),
  asyncHandler(financeController.resolveReconciliationItem),
);
financeRouter.post(
  "/payments/:id/confirm-bank",
  requirePermission("finance.reconcile"),
  asyncHandler(financeController.confirmBankPayment),
);

// Ledger
financeRouter.get(
  "/trial-balance",
  requirePermission("finance.read"),
  asyncHandler(financeController.getTrialBalance),
);
financeRouter.get(
  "/journal",
  requirePermission("finance.read"),
  asyncHandler(financeController.listJournalEntries),
);
financeRouter.post(
  "/journal/:id/reverse",
  requirePermission("finance.reconcile"),
  asyncHandler(financeController.reverseJournal),
);

financeRouter.delete(
  "/expenses/:id",
  requirePermission("expenses.write"),
  asyncHandler(financeController.deleteExpense),
);

financeRouter.delete(
  "/cash-sessions/:id",
  requirePermission("finance.reconcile"),
  asyncHandler(financeController.deleteCashSession),
);

financeRouter.delete(
  "/reconciliation/:id",
  requirePermission("finance.reconcile"),
  asyncHandler(financeController.deleteReconciliationItem),
);
