import { db } from "../src/db.js";
import { classifyTextDepartment, classifyLineDepartment } from "../src/domain/shopDepartment.js";
import { decimalToNumber } from "../src/lib/money.js";

async function main() {
  const ros = await db.repairOrder.findMany({
    where: { status: { notIn: ["SCHEDULED", "DELIVERED", "CANCELLED"] } },
    select: { id: true, number: true, concern: true, status: true },
  });
  console.log("ACTIVE REPAIR ORDERS IN BAYS:");
  for (const ro of ros) {
    const dept = classifyTextDepartment(ro.concern, ro.number || ro.id);
    console.log(`  [${dept.padEnd(7)}] ${ro.number}: ${ro.concern}`);
  }

  const invoices = await db.invoice.findMany({
    where: { status: { notIn: ["DRAFT", "VOID"] } },
    include: {
      lines: {
        include: {
          inventoryUnits: { include: { product: { select: { kind: true } } } },
        },
      },
    },
  });

  let overallNet = 0, overallTax = 0, overallGross = 0;
  let tireNet = 0, tireTax = 0, tireGross = 0;
  let mufflerNet = 0, mufflerTax = 0, mufflerGross = 0;

  for (const inv of invoices) {
    overallNet += inv.subtotal - inv.discountTotal;
    overallTax += inv.taxTotal;
    overallGross += inv.total;

    for (const line of inv.lines) {
      const d = classifyLineDepartment(line);
      if (d === "TIRE") {
        tireNet += line.lineTotal;
        tireTax += line.taxAmount;
        tireGross += line.lineTotal + line.taxAmount;
      } else if (d === "MUFFLER") {
        mufflerNet += line.lineTotal;
        mufflerTax += line.taxAmount;
        mufflerGross += line.lineTotal + line.taxAmount;
      }
    }
  }

  const auditCount = await db.auditEvent.count();
  console.log(`\nTOTAL AUDIT EVENTS IN DB: ${auditCount}`);
  const sample = await db.auditEvent.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    include: { actor: { select: { email: true } } },
  });
  console.log("RECENT AUDIT EVENTS:");
  sample.forEach((s) => console.log(`  - [${s.action}] on ${s.resourceType} by ${s.actor?.email ?? "system"} (${s.reason ?? "no reason"})`));
}

main().finally(() => db.$disconnect());
