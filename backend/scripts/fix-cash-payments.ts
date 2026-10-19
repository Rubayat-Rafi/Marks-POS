import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const list = await prisma.payment.findMany({
    select: { id: true, method: true, provider: true, amount: true, bankConfirmedAt: true, reference: true }
  });

  console.log(`Found ${list.length} payments:`);
  for (const item of list) {
    console.log(`- ${item.method} | provider: ${item.provider} | $${(item.amount / 100).toFixed(2)} | bankConfirmed: ${item.bankConfirmedAt ? "YES" : "NO"} | ref: ${item.reference || "none"}`);
  }

  // Update any CASH or CHECK payments to have provider = 'manual'
  const updated = await prisma.payment.updateMany({
    where: {
      method: { in: ["CASH", "CHECK"] },
      provider: { not: "manual" },
    },
    data: {
      provider: "manual",
    },
  });

  console.log(`Fixed ${updated.count} CASH/CHECK payments to provider: "manual"`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
