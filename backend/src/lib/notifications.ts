import { prisma } from "./prisma.js";

/**
 * Transactional messaging.
 *
 * Two rules from the build guide are enforced here rather than left to the
 * caller:
 *   1. Transactional messages (approval links, receipts, "your car is ready")
 *      are kept separate from marketing. A customer's marketing preference is
 *      never consulted for a transactional send (build guide / 03).
 *   2. Nothing claims to have been sent that was not. A missing transport logs
 *      loudly and reports failure so the outbox retries, rather than silently
 *      dropping the message (build guide / 11).
 */

export type Channel = "email" | "sms";

export type Message = {
  channel: Channel;
  to: string;
  subject?: string;
  body: string;
  /** For the audit trail and for debugging a delivery complaint. */
  reference: string;
};

export type DeliveryResult = {
  delivered: boolean;
  transport: string;
  externalId?: string;
  error?: string;
};

export interface MessageTransport {
  readonly name: string;
  send(message: Message): Promise<DeliveryResult>;
}

/**
 * The default transport in development: prints the message and reports success.
 *
 * It is named honestly so nobody mistakes a console line for a delivered email.
 * Swap it for a real provider before the pilot.
 */
class ConsoleTransport implements MessageTransport {
  readonly name = "console";

  async send(message: Message): Promise<DeliveryResult> {
    const rule = "-".repeat(64);
    console.log(
      [
        rule,
        `[notification] ${message.channel.toUpperCase()} -> ${message.to}`,
        message.subject ? `Subject: ${message.subject}` : null,
        "",
        message.body,
        rule,
      ]
        .filter((line) => line !== null)
        .join("\n"),
    );
    return { delivered: true, transport: this.name, externalId: `console_${Date.now()}` };
  }
}

/**
 * Refuses to send rather than pretending. Selected when a transport is
 * configured by name but not implemented in this build.
 */
class UnconfiguredTransport implements MessageTransport {
  constructor(private readonly configured: string) {}
  readonly name = "unconfigured";

  async send(): Promise<DeliveryResult> {
    return {
      delivered: false,
      transport: this.name,
      error: `Transport "${this.configured}" is named in the configuration but not implemented in this build.`,
    };
  }
}

const TRANSPORTS: Record<string, MessageTransport> = {
  console: new ConsoleTransport(),
};

export function getTransport(): MessageTransport {
  const configured = process.env.NOTIFICATION_TRANSPORT ?? "console";
  return TRANSPORTS[configured] ?? new UnconfiguredTransport(configured);
}

/**
 * Resolve where a customer's transactional message should go.
 *
 * Marketing consent is deliberately not read here. A receipt is owed to the
 * customer whether or not they want newsletters.
 */
async function resolveRecipient(
  customerId: string,
): Promise<{ channel: Channel; to: string } | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { email: true, phone: true, allowsSms: true, archivedAt: true },
  });
  if (!customer || customer.archivedAt) return null;

  if (customer.email) return { channel: "email", to: customer.email };
  // SMS consent is a channel permission, not a marketing preference.
  if (customer.phone && customer.allowsSms) return { channel: "sms", to: customer.phone };
  return null;
}

type Composed = { subject: string; body: string };

/** Message bodies, kept in one place so wording can be reviewed. */
function compose(eventType: string, payload: Record<string, unknown>): Composed | null {
  const shop = String(payload.shopName ?? "your repair shop");

  switch (eventType) {
    case "estimate.sent":
      return {
        subject: `Your estimate from ${shop} is ready to approve`,
        body: [
          "Your repair estimate is ready.",
          "",
          `Review and approve it here: ${payload.approvalUrl}`,
          "",
          "You can approve everything, or untick anything you do not want done.",
          "This link works once and expires. If the price changes, we will send a new one.",
        ].join("\n"),
      };

    case "estimate.approved":
      return {
        subject: `${shop} received your approval`,
        body: "Thank you. We have your approval and will begin the work you authorised.",
      };

    case "invoice.issued":
      return {
        subject: `Invoice ${payload.number} from ${shop}`,
        body: [
          `Your invoice ${payload.number} is ready.`,
          "",
          "It will also be available when you collect the vehicle.",
        ].join("\n"),
      };

    case "payment.received":
      return {
        subject: `Payment received by ${shop}`,
        body: "Thank you. We have received your payment and your receipt is ready.",
      };

    case "job.ready":
      return {
        subject: `Your vehicle is ready at ${shop}`,
        body: [
          `Job ${payload.number} is finished and your vehicle is ready for collection.`,
          "",
          "Please settle any outstanding balance when you arrive.",
        ].join("\n"),
      };

    case "refund.succeeded":
      return {
        subject: `${shop} has issued a refund`,
        body: "Your refund has been sent back to the original payment method. Banks usually take a few business days to show it.",
      };

    // Internal events. There is no customer message for these, and inventing
    // one would be worse than staying quiet.
    default:
      return null;
  }
}

/**
 * Deliver the customer-facing message for an outbox event, if there is one.
 *
 * Returns `skipped` when the event has no customer message or the customer has
 * no reachable channel. Throws on a transport failure so the outbox retries.
 */
export async function deliverForEvent(
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ status: "sent" | "skipped"; reason?: string }> {
  const composed = compose(eventType, payload);
  if (!composed) return { status: "skipped", reason: "no customer message for this event" };

  const customerId = payload.customerId as string | undefined;
  if (!customerId) return { status: "skipped", reason: "event carries no customer" };

  const recipient = await resolveRecipient(customerId);
  if (!recipient) {
    return { status: "skipped", reason: "customer has no reachable contact channel" };
  }

  const result = await getTransport().send({
    channel: recipient.channel,
    to: recipient.to,
    subject: composed.subject,
    body: composed.body,
    reference: eventType,
  });

  if (!result.delivered) {
    throw new Error(result.error ?? "The message transport reported a failure.");
  }
  return { status: "sent" };
}

/** Shown once at worker start so the operator knows what is actually wired. */
export function describeTransport(): string {
  const transport = getTransport();
  if (transport.name === "console") {
    return "console (development only: messages are printed, not sent)";
  }
  if (transport.name === "unconfigured") {
    return `UNCONFIGURED — messages will fail and retry. Set NOTIFICATION_TRANSPORT to an implemented transport.`;
  }
  return transport.name;
}
