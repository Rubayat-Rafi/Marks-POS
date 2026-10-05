import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { CHART_OF_ACCOUNTS } from "../domain/accounts.js";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "mohammad@markstire.com").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AutoShop2026!";
const FIRST_NAME = process.env.ADMIN_FIRST_NAME ?? "Mohammad";
const LAST_NAME = process.env.ADMIN_LAST_NAME ?? "Admin";
const LEGACY_OWNER_EMAIL = "owner@markstire.test";

async function ensureDefaultShop() {
  const existing = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;

  console.log("[bootstrap] No shop found in DB - creating default organization...");
  const org = await db.organization.create({
    data: {
      name: "Mark's Tire Shop & Muffler",
      legalName: "Mark's Tire Shop & Muffler LLC",
      currency: "USD",
      timezone: "America/Chicago",
      taxRateBps: 950,
      taxesParts: true,
      taxesLabor: false,
      taxesFees: false,
      paymentProvider: "mock",
      publicSlug: "marks-tire-muffler",
      locations: {
        create: {
          name: "Mark's Tire Shop & Muffler - New Orleans",
          code: "STCLAUDE",
          addressLine1: "5229 Saint Claude Ave",
          city: "New Orleans",
          state: "LA",
          postalCode: "70117",
          phone: "(504) 354-9396",
          bayCount: 5,
        },
      },
    },
  });

  await db.account.createMany({
    data: CHART_OF_ACCOUNTS.map((a) => ({ ...a, organizationId: org.id })),
  });
  return org;
}

/**
 * Automatically ensures the primary admin account exists and is an OWNER.
 * Runs seamlessly on server boot so that environments like Hostinger hPanel,
 * cPanel, and cloud containers have an active admin without needing SSH commands.
 */
export async function bootstrapAdminUser(): Promise<void> {
  try {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    let user = await db.user.findUnique({ where: { email: ADMIN_EMAIL } });

    if (!user) {
      // Migrate legacy demo owner if present
      const legacy = await db.user.findUnique({ where: { email: LEGACY_OWNER_EMAIL } });
      if (legacy) {
        console.log(`[bootstrap] Migrating legacy user ${LEGACY_OWNER_EMAIL} -> ${ADMIN_EMAIL}`);
        user = await db.user.update({
          where: { id: legacy.id },
          data: { email: ADMIN_EMAIL, passwordHash },
        });
      }
    }

    if (user) {
      // Ensure password is valid and up-to-date
      user = await db.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });
      console.log(`[bootstrap] Verified admin credentials for ${ADMIN_EMAIL}`);
    } else {
      user = await db.user.create({
        data: {
          email: ADMIN_EMAIL,
          firstName: FIRST_NAME,
          lastName: LAST_NAME,
          passwordHash,
        },
      });
      console.log(`[bootstrap] Created primary admin: ${ADMIN_EMAIL}`);
    }

    const org = await ensureDefaultShop();

    const membership = await db.membership.findFirst({
      where: { userId: user.id, organizationId: org.id },
    });

    if (membership) {
      await db.membership.update({
        where: { id: membership.id },
        data: { role: "OWNER", isActive: true },
      });
    } else {
      await db.membership.create({
        data: { userId: user.id, organizationId: org.id, role: "OWNER", isActive: true },
      });
    }

    console.log(`[bootstrap] Admin ready -> ${ADMIN_EMAIL} (role: OWNER, shop: ${org.name})`);
  } catch (err) {
    console.error("[bootstrap] Error bootstrapping admin account:", err);
  }
}
