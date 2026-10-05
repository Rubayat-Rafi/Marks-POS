import { Router } from "express";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";
import * as bookingController from "./booking.controller.js";

export const bookingRouter = Router();

bookingRouter.use(requireAuth);

bookingRouter.get(
  "/",
  requirePermission("bookings.read"),
  asyncHandler(bookingController.listBookingRequests),
);

bookingRouter.patch(
  "/:id",
  requirePermission("bookings.write"),
  asyncHandler(bookingController.updateBookingStatus),
);

bookingRouter.post(
  "/:id/convert",
  requirePermission("bookings.write"),
  asyncHandler(bookingController.convertBookingToAppointment),
);

