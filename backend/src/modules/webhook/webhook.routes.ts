import { Router, raw } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import * as webhookController from "./webhook.controller.js";

export const webhookRouter = Router();

webhookRouter.post(
  "/:provider",
  raw({ type: "*/*", limit: "1mb" }),
  asyncHandler(webhookController.handleWebhook),
);

export { processWebhook } from "./webhook.controller.js";
