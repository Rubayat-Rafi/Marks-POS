import { type Request, type Response } from "express";
import { db } from "../../db.js";
import { getPaymentProvider } from "../../providers/registry.js";
import { resolveAttempt } from "../../domain/payments.js";

export async function processWebhook(inboxId: string) {
  const inbox = await db.webhookInbox.findUniqueOrThrow({ where: { id: inboxId } });
  if (inbox.status === "PROCESSED") return;

  const payload = inbox.payload as Record<string, unknown>;
  const externalPaymentId = String(
    (payload.data as Record<string, unknown> | undefined)?.id ?? payload.paymentId ?? "",
  );

  if (!externalPaymentId) {
    await db.webhookInbox.update({
      where: { id: inbox.id },
      data: { status: "IGNORED", error: "No payment reference in the event.", processedAt: new Date() },
    });
    return;
  }

  if (!inbox.organizationId) return;
  const attempt = await db.paymentAttempt.findFirst({
    where: {
      provider: inbox.provider,
      externalId: externalPaymentId,
      organizationId: inbox.organizationId,
    },
  });

  if (!attempt) {
    return;
  }

  await resolveAttempt({ attemptId: attempt.id, organizationId: attempt.organizationId });

  await db.webhookInbox.update({
    where: { id: inbox.id },
    data: { status: "PROCESSED", processedAt: new Date() },
  });
}

export const handleWebhook = async (req: Request, res: Response) => {
  const providerName = req.params.provider;

  let verified;
  try {
    verified = getPaymentProvider(providerName).verifyWebhook(
      req.body as Buffer,
      req.headers,
    );
  } catch {
    res.status(400).json({ error: { code: "bad_webhook", message: "Rejected." } });
    return;
  }

  if (!verified.signatureValid) {
    res.status(400).json({ error: { code: "bad_signature", message: "Rejected." } });
    return;
  }

  const connection = await db.providerConnection.findFirst({
    where: {
      kind: "PAYMENT",
      provider: providerName,
      externalAccountId: verified.externalAccountId,
    },
  });

  let inbox;
  try {
    inbox = await db.webhookInbox.create({
      data: {
        organizationId: connection?.organizationId ?? null,
        provider: providerName,
        externalAccountId: verified.externalAccountId,
        eventId: verified.eventId,
        eventType: verified.eventType,
        signatureValid: true,
        payload: verified.payload as object,
        status: connection ? "RECEIVED" : "IGNORED",
        error: connection ? null : "No provider connection matches that merchant account.",
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      res.json({ received: true, duplicate: true });
      return;
    }
    throw err;
  }

  res.json({ received: true });

  if (!connection) return;

  try {
    await processWebhook(inbox.id);
  } catch (error) {
    await db.webhookInbox.update({
      where: { id: inbox.id },
      data: {
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
};
