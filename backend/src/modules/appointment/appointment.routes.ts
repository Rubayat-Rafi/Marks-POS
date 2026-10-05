import { Router } from "express";
import * as appointmentsController from "./appointment.controller.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requirePermission } from "../../middlewares/rbac.middleware.js";

export const appointmentRouter = Router();

appointmentRouter.use(requireAuth);

appointmentRouter.get(
  "/",
  requirePermission("appointments.read"),
  asyncHandler(appointmentsController.listAppointments),
);

appointmentRouter.post(
  "/",
  requirePermission("appointments.write"),
  asyncHandler(appointmentsController.createAppointment),
);

appointmentRouter.patch(
  "/:id",
  requirePermission("appointments.write"),
  asyncHandler(appointmentsController.updateAppointment),
);

appointmentRouter.post(
  "/:id/check-in",
  requirePermission("jobs.write"),
  asyncHandler(appointmentsController.checkInAppointment),
);
