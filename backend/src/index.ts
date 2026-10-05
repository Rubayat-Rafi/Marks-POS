import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./env.js";
import { db } from "./db.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { router } from "./routes/index.js";
import { webhookRouter } from "./modules/webhook/webhook.routes.js";
import { bootstrapAdminUser } from "./bootstrap/admin.bootstrap.js";

const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: env.corsOrigin.split(",").map((o) => o.trim()),
    credentials: true,
  }),
);

app.use((req, res, next) => {
  const incoming = req.headers["x-request-id"];
  res.locals.requestId =
    typeof incoming === "string" && /^[\w-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader("x-request-id", res.locals.requestId);
  next();
});

if (!env.isProduction) app.use(morgan("dev"));

// Webhooks mount before json parser so raw signature verification works
app.use("/api/v1/webhooks", webhookRouter);

app.use(express.json({ limit: "1mb" }));

// Root route
app.get("/", (_req, res) => {
  res.json({
    service: "autoshop-api",
    status: "up",
    health: "/api/health",
    api: "/api/v1",
    web: env.publicWebUrl,
  });
});

// Health check endpoint
app.get(["/health", "/api/health"], async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({
      status: "ok",
      database: "up",
      schema: "ready",
      db: env.db.database,
      time: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      database: "down",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

// Main API Routes
app.use("/api/v1", router);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.port, () => {
  console.log(`[api] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  console.log(`[api] database: ${env.db.user}@${env.db.host}:${env.db.port}/${env.db.database}`);
  void bootstrapAdminUser();
});

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

export { app };