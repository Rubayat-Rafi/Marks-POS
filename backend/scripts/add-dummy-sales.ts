import { PrismaClient } from "@prisma/client";
import { postJournalEntry } from "../src/domain/ledger.js";
import { nextNumber } from "../src/lib/sequences.js";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findFirst();
  if (!org) {
    console.log("No organization found");
    return;
  }
  console.log("Found organization:", org.id, org.name);

  const location = await prisma.location.findFirst({ where: { organizationId: org.id } });
  let customer = await prisma.customer.findFirst({ where: { organizationId: org.id } });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        organizationId: org.id,
        firstName: "Walk-in",
        lastName: "Customer",
        phone: "504-555-0100",
      },
    });
  }

  console.log("Customer:", customer.id);

  // Clean up any incomplete invoices from prior failed run
  await prisma.invoice.deleteMany({ where: { organizationId: org.id, allocations: { none: {} } } });

  // Let's inspect current invoice count
  const count = await prisma.invoice.count({ where: { organizationId: org.id } });
  console.log("Current invoice count:", count);

  // Create 5 realistic dummy sales for today and yesterday:
  // 1. Tires Shop: 4 Michelin Tires + Mount & Balance
  // 2. Mufflers Shop: Custom Dual Exhaust & Flowmaster Muffler
  // 3. Tires Shop: Flat Repair & Bead Seal
  // 4. Mufflers Shop: Catalytic Converter & Exhaust Pipe Weld
  // 5. Tires Shop: 2 Goodyear 225/65R17 Tires + Tire Disposal Fee

  const now = new Date();
  const salesData = [
    {
      dept: "TIRE",
      customerName: "David Miller",
      lines: [
        { description: "Michelin Defender 205/55R16 Tire", qty: 4, unitPrice: 12500, taxRate: 1000 },
        { description: "Mount & Balance (4 Wheels)", qty: 4, unitPrice: 2000, taxRate: 0 },
        { description: "State Tire Recycling / Disposal Fee", qty: 4, unitPrice: 350, taxRate: 0 },
      ],
      method: "CASH",
    },
    {
      dept: "MUFFLER",
      customerName: "Sarah Jenkins",
      lines: [
        { description: "Flowmaster 40 Series Muffler Replacement", qty: 1, unitPrice: 16500, taxRate: 1000 },
        { description: "Custom Tailpipe & Exhaust Hanger Weld Labor", qty: 1, unitPrice: 8500, taxRate: 0 },
      ],
      method: "CARD_TERMINAL",
    },
    {
      dept: "TIRE",
      customerName: "Carlos Ramirez",
      lines: [
        { description: "Tire Flat Repair & Inner Patch Plug", qty: 1, unitPrice: 2500, taxRate: 1000 },
        { description: "Wheel Bead Clean & Valve Stem Replace", qty: 1, unitPrice: 1000, taxRate: 0 },
      ],
      method: "CASH",
    },
    {
      dept: "MUFFLER",
      customerName: "Marcus Antoine",
      lines: [
        { description: "High-Flow Catalytic Converter Direct Fit", qty: 1, unitPrice: 28000, taxRate: 1000 },
        { description: "Muffler Flex Pipe Section Replacement", qty: 1, unitPrice: 9500, taxRate: 0 },
      ],
      method: "CARD_TERMINAL",
    },
    {
      dept: "TIRE",
      customerName: "Angela Davis",
      lines: [
        { description: "Goodyear Assurance 225/65R17 All-Season Tire", qty: 2, unitPrice: 14000, taxRate: 1000 },
        { description: "Tire Mount & High-Speed Road-Force Balance", qty: 2, unitPrice: 2200, taxRate: 0 },
      ],
      method: "CASH",
    },
  ];

  for (let i = 0; i < salesData.length; i++) {
    const sale = salesData[i];
    let cust = await prisma.customer.findFirst({
      where: {
        organizationId: org.id,
        firstName: sale.customerName.split(" ")[0],
      },
    });

    if (!cust) {
      const parts = sale.customerName.split(" ");
      cust = await prisma.customer.create({
        data: {
          organizationId: org.id,
          firstName: parts[0],
          lastName: parts.slice(1).join(" ") || "Customer",
          phone: `504-555-01${i + 10}`,
        },
      });
    }

    const invNumber = await nextNumber(prisma, org.id, "invoice");

    let subtotal = 0;
    let taxTotal = 0;

    const lineInserts = sale.lines.map((l, idx) => {
      const lineTotal = l.qty * l.unitPrice;
      const taxAmount = Math.round((lineTotal * l.taxRate) / 10000);
      subtotal += lineTotal;
      taxTotal += taxAmount;

      return {
        sortOrder: idx + 1,
        lineType: (l.description.toLowerCase().includes("labor") || l.description.toLowerCase().includes("mount") || l.description.toLowerCase().includes("weld") || l.description.toLowerCase().includes("repair") ? "LABOR" : "PART") as any,
        description: l.description,
        quantity: l.qty,
        unitPrice: l.unitPrice,
        unitCost: Math.round(l.unitPrice * 0.55),
        lineTotal,
        taxable: l.taxRate > 0,
        taxRateBps: l.taxRate,
        taxAmount,
      };
    });

    const total = subtotal + taxTotal;
    const issuedAt = new Date(Date.now() - (i * 3600 * 1000 * 2)); // Spread out over past hours today

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: org.id,
        locationId: location?.id || null,
        customerId: cust.id,
        number: invNumber,
        status: "PAID",
        subtotal,
        discountTotal: 0,
        taxTotal,
        total,
        amountPaid: total,
        amountCredited: 0,
        issuedAt,
        dueAt: issuedAt,
        paidAt: issuedAt,
        lines: {
          create: lineInserts,
        },
      },
    });

    // Create Payment record
    const payment = await prisma.payment.create({
      data: {
        organizationId: org.id,
        customerId: cust.id,
        provider: "mock",
        method: sale.method,
        status: "SUCCEEDED",
        amount: total,
        feeAmount: sale.method === "CARD" ? Math.round(total * 0.029 + 30) : 0,
        receivedAt: issuedAt,
        reference: `${sale.dept === "TIRE" ? "Tires" : "Mufflers"} sale ${invNumber}`,
        allocations: {
          create: [
            {
              invoiceId: invoice.id,
              amount: total,
            },
          ],
        },
      },
    });

    console.log(`Created dummy invoice ${invNumber} (${sale.dept}): $${(total / 100).toFixed(2)} [${sale.method}]`);
  }

  console.log("Successfully inserted 5 dummy sales records!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
