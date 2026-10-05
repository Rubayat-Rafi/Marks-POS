/**
 * Seeds (or repairs) the admin / owner account WITHOUT wiping any data.
 *
 * Run with:  npm run seed:admin
 *
 * Override defaults with env vars if needed:
 *   ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME, ADMIN_LAST_NAME
 *
 * Behaviour (safe to run repeatedly):
 *  - If the legacy demo owner (owner@markstire.test) exists, it is renamed to
 *    the admin email so existing data/audit history stays attached to it.
 *  - Otherwise the admin user is created (or updated) with the given password.
 *  - The user is guaranteed an active OWNER membership. If no shop exists yet,
 *    a shop, a location and the chart of accounts are created first.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CHART_OF_ACCOUNTS } from "../src/domain/accounts.js";

const prisma = new PrismaClient();

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "mohammad@markstire.com").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "AutoShop2026!";
const FIRST_NAME = process.env.ADMIN_FIRST_NAME ?? "Mohammad";
const LAST_NAME = process.env.ADMIN_LAST_NAME ?? "Admin";
const LEGACY_OWNER_EMAIL = "owner@markstire.test";

async function ensureShop() {
  const existing = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;

  console.log("No shop found - creating the default shop...");
  const org = await prisma.organization.create({
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
  await prisma.account.createMany({
    data: CHART_OF_ACCOUNTS.map((a) => ({ ...a, organizationId: org.id })),
  });
  return org;
}

async function main() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  let user = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });

  if (!user) {
    const legacy = await prisma.user.findUnique({ where: { email: LEGACY_OWNER_EMAIL } });
    if (legacy) {
      console.log(`Renaming ${LEGACY_OWNER_EMAIL} -> ${ADMIN_EMAIL}`);
      user = await prisma.user.update({
        where: { id: legacy.id },
        data: { email: ADMIN_EMAIL, passwordHash },
      });
    }
  }

  if (user) {
    user = await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    console.log(`Updated password for ${ADMIN_EMAIL}`);
  } else {
    user = await prisma.user.create({
      data: { email: ADMIN_EMAIL, firstName: FIRST_NAME, lastName: LAST_NAME, passwordHash },
    });
    console.log(`Created admin user ${ADMIN_EMAIL}`);
  }

  const org = await ensureShop();
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, organizationId: org.id },
  });
  if (membership) {
    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: "OWNER", isActive: true },
    });
  } else {
    await prisma.membership.create({
      data: { userId: user.id, organizationId: org.id, role: "OWNER" },
    });
  }

  console.log("\nAdmin ready:");
  console.log(`  shop      ${org.name}`);
  console.log(`  email     ${ADMIN_EMAIL}`);
  console.log(`  password  ${ADMIN_PASSWORD}`);
  console.log("  role      OWNER");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
