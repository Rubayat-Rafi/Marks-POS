import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: [
          "'self'",
          env.publicWebUrl,
          ...env.corsOrigin.split(",").map((o) => o.trim()),
        ].filter(Boolean),
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
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

// In production or when frontend build exists, locate the SPA assets
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const possibleDistPaths = [
  path.resolve(__dirname, "../../frontend/dist"),
  path.resolve(__dirname, "../public"),
  path.resolve(process.cwd(), "frontend/dist"),
  path.resolve(process.cwd(), "public"),
];
const frontendDistPath = possibleDistPaths.find((p) => fs.existsSync(p));

if (frontendDistPath) {
  app.use(express.static(frontendDistPath));
}

// Root route: serves frontend index.html when available and HTML requested, else API info
app.get("/", (req, res, next) => {
  if (frontendDistPath && req.accepts(["html", "json"]) === "html") {
    return res.sendFile(path.join(frontendDistPath, "index.html"));
  }
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

// SPA client-side routing fallback: any non-API route serves index.html
if (frontendDistPath) {
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path === "/health") {
      return next();
    }
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
}

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