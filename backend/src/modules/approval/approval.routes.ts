import { Router } from "express";
import * as approvalsController from "./approval.controller.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { rateLimit } from "../../middlewares/rateLimit.middleware.js";

export const approvalRouter = Router();

approvalRouter.use(rateLimit({ limit: 60, windowMs: 60_000 }));

approvalRouter.get("/:token", asyncHandler(approvalsController.getApprovalByToken));
approvalRouter.post("/:token", asyncHandler(approvalsController.submitApprovalDecision));
