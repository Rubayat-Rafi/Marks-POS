import { prisma } from "../lib/prisma.js";
import { deliverForEvent, describeTransport } from "../lib/notifications.js";
import { processWebhook } from "../modules/webhook/webhook.controller.js";

/**
 * Background worker: the same codebase, a separate process (build guide / 05).
 *
 * Two jobs:
 *  1. Dispatch outbox events (notifications, integration tasks).
 *  2. Retry webhook events that arrived out of order or failed processing.
 *
 * Retries use bounded exponential backoff and alert once retries are exhausted;
 * a job is never retried forever in silence (build guide / 11).
 */

const POLL_INTERVAL_MS = 2000;
const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 20;

let running = true;

function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** attempts, 5 * 60 * 1000);
}

/**
 * Dispatch one event.
 *
 * The shop name is looked up here rather than baked into every payload, so a
 * rename does not leave stale text in queued messages.
 */
async function dispatch(
  organizationId: string,
  eventType: string,
  payload: Record<string, unknown>,
) {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  const result = await deliverForEvent(eventType, {
    ...payload,
    shopName: organization?.name,
  });

  console.log(
    `[worker] ${eventType} ${result.status}${result.reason ? ` (${result.reason})` : ""}`,
  );
}

async function drainOutbox() {
  const due = await prisma.outboxEvent.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  for (const event of due) {
    // Claim the row so a second worker cannot take it.
    const claimed = await prisma.outboxEvent.updateMany({
      where: { id: event.id, status: "PENDING" },
      data: { status: "PROCESSING" },
    });
    if (claimed.count === 0) continue;

    try {
      await dispatch(
        event.organizationId,
        event.eventType,
        event.payload as Record<string, unknown>,
      );
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: "DONE", processedAt: new Date() },
      });
    } catch (error) {
      const attempts = event.attempts + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          attempts,
          lastError: error instanceof Error ? error.message : String(error),
          availableAt: new Date(Date.now() + backoffMs(attempts)),
        },
      });
      if (exhausted) {
        console.error(
          `[worker] ALERT outbox event ${event.id} (${event.eventType}) failed ${attempts} times and is now dead-lettered`,
        );
      }
    }
  }
}

async function retryWebhooks() {
  // RECEIVED rows are events whose payment attempt did not exist yet when the
  // event arrived. Retrying tolerates out-of-order delivery.
  const stuck = await prisma.webhookInbox.findMany({
    where: {
      status: { in: ["RECEIVED", "FAILED"] },
      organizationId: { not: null },
      receivedAt: { lte: new Date(Date.now() - 5000) },
    },
    orderBy: { receivedAt: "asc" },
    take: BATCH_SIZE,
  });

  for (const event of stuck) {
    try {
      await processWebhook(event.id);
    } catch (error) {
      await prisma.webhookInbox.update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

async function expireStaleApprovalLinks() {
  const expired = await prisma.estimateVersion.updateMany({
    where: {
      status: "SENT",
      approvalTokenExpiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED", approvalToken: null },
  });
  if (expired.count > 0) console.log(`[worker] expired ${expired.count} approval link(s)`);
}

async function loop() {
  console.log("[worker] started");
  console.log(`[worker] message transport: ${describeTransport()}`);
  let tick = 0;
  while (running) {
    try {
      await drainOutbox();
      await retryWebhooks();
      // Link expiry only needs checking occasionally.
      if (tick % 150 === 0) await expireStaleApprovalLinks();
    } catch (error) {
      console.error("[worker] loop error", error);
    }
    tick += 1;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/**
 * One pass, then exit.
 *
 * Shared hosting will not keep a second long-lived process alive, so on cPanel
 * the worker runs from a cron entry every two minutes calling
 * `node dist/worker/index.js --once` instead of polling. See
 * docs/DEPLOY-CPANEL.md for the exact line. Everything a pass does is
 * idempotent and row-claimed, so an overlapping run is safe; only latency
 * differs from the polling loop.
 */
async function once() {
  console.log(`[worker] single pass, message transport: ${describeTransport()}`);
  await drainOutbox();
  await retryWebhooks();
  await expireStaleApprovalLinks();
  console.log("[worker] pass complete");
}

function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, finishing current batch`);
  running = false;
  setTimeout(() => void prisma.$disconnect().then(() => process.exit(0)), 500);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

if (process.argv.includes("--once")) {
  // A cron run must report failure through its exit code, or a broken worker
  // is invisible until someone notices the outbox backing up.
  void once()
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("[worker] pass failed", error);
      await prisma.$disconnect().catch(() => {});
      process.exit(1);
    });
} else {
  void loop();
}
