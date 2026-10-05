import { Router } from "express";
import * as authController from "./auth.controller.js";
import { asyncHandler } from "../../middlewares/error.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { rateLimit } from "../../middlewares/rateLimit.middleware.js";

export const authRouter = Router();

const loginPerIp = rateLimit({
  limit: 30,
  windowMs: 15 * 60_000,
  message: "Too many sign-in attempts from this device. Wait 15 minutes and try again.",
});

authRouter.post("/login", loginPerIp, asyncHandler(authController.login));
authRouter.post("/logout", authController.logout);
authRouter.get("/session", asyncHandler(authController.getSession));
authRouter.get("/me", requireAuth, asyncHandler(authController.getMe));
authRouter.post(
  "/change-password",
  requireAuth,
  rateLimit({ limit: 10, windowMs: 15 * 60_000 }),
  asyncHandler(authController.changePassword),
);
