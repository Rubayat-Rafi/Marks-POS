import { Router } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { rateLimit } from "../../middlewares/rateLimit.middleware.js";
import * as publicController from "./public.controller.js";

export const publicRouter = Router();

publicRouter.get(
  "/shop",
  rateLimit({ limit: 120, windowMs: 60_000 }),
  asyncHandler(publicController.getPublicShop),
);

publicRouter.post(
  "/bookings",
  rateLimit({
    limit: 5,
    windowMs: 60 * 60_000,
    message: "We already have your request. Call the shop if it is urgent.",
  }),
  asyncHandler(publicController.createPublicBooking),
);

publicRouter.post(
  "/estimate-lookup",
  rateLimit({
    limit: 10,
    windowMs: 15 * 60_000,
    message: "Too many lookups. Wait 15 minutes or call the shop.",
  }),
  asyncHandler(publicController.lookupEstimate),
);

const checkoutLimiter = rateLimit({ limit: 60, windowMs: 60_000 });

publicRouter.get(
  "/checkout/:externalId",
  checkoutLimiter,
  asyncHandler(publicController.getCheckout),
);

publicRouter.post(
  "/checkout/:externalId/pay",
  checkoutLimiter,
  asyncHandler(publicController.payCheckout),
);
