import { type Request, type Response } from "express";
import { db } from "../../db.js";
import { queryDate } from "../../utils/query.js";
import { auth, tenantScope } from "../../middlewares/auth.middleware.js";
import { can } from "../../middlewares/rbac.middleware.js";
import { decimalToNumber } from "../../lib/money.js";
import { grossMarginPct } from "../../domain/pricing.js";
import { inStockCounts, isLowStock } from "../../domain/inventory.js";
import { dayBounds } from "../../lib/time.js";
import { classifyLineDepartment, classifyTextDepartment } from "../../domain/shopDepartment.js";


async function lowStockCount(organizationId: string): Promise<number> {
  const [products, counts] = await Promise.all([
    db.inventoryProduct.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, reorderPoint: true },
    }),
    inStockCounts(db, organizationId),
  ]);
  return products.filter((p) => isLowStock(counts.get(p.id) ?? 0, p.reorderPoint)).length;
}

function rangeFrom(req: { query: Record<string, unknown> }) {
  const to = queryDate(req.query.to, "to") ?? new Date();
  const from = queryDate(req.query.from, "from") ?? new Date(to.getTime() - 30 * 86_400_000);
  return { from, to };
}

export const getDashboard = async (req: Request, res: Response) => {
  const ctx = auth(req);
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });
  const { start: startOfDay, end: endOfDay } = dayBounds(org.timezone);

  const [
    appointments,
    openJobs,
    unpaid,
    exceptions,
    todaysPayments,
    myTasks,
    inService,
    invoicedToday,
    lowStock,
    newBookings,
    location,
  ] = await Promise.all([
    db.appointment.findMany({
      where: {
        ...tenantScope(req),
        scheduledFor: { gte: startOfDay, lt: endOfDay },
        status: { notIn: ["CANCELLED", "CONVERTED"] },
      },
      orderBy: { scheduledFor: "asc" },
      include: { customer: true, vehicle: true },
    }),
    db.repairOrder.count({
      where: {
        ...tenantScope(req),
        status: { notIn: ["DELIVERED", "CANCELLED"] },
      },
    }),
    db.invoice.aggregate({
      where: { ...tenantScope(req), status: { in: ["ISSUED", "PARTLY_PAID"] } },
      _sum: { total: true, amountPaid: true, amountCredited: true },
      _count: true,
    }),
    db.reconciliationItem.count({ where: { ...tenantScope(req), status: "OPEN" } }),
    db.payment.aggregate({
      where: { ...tenantScope(req), receivedAt: { gte: startOfDay, lt: endOfDay } },
      _sum: { amount: true },
      _count: true,
    }),
    db.repairTask.findMany({
      where: {
        assignedToId: ctx.userId,
        status: { not: "DONE" },
        repairOrder: { ...tenantScope(req), status: { notIn: ["DELIVERED", "CANCELLED"] } },
      },
      orderBy: { createdAt: "asc" },
      take: 25,
      include: {
        repairOrder: {
          select: {
            id: true,
            number: true,
            status: true,
            concern: true,
            customer: { select: { firstName: true, lastName: true } },
            vehicle: { select: { year: true, make: true, model: true, plate: true } },
          },
        },
      },
    }),
    db.repairOrder.findMany({
      where: {
        ...tenantScope(req),
        ...(ctx.locationId ? { locationId: ctx.locationId } : {}),
        status: { notIn: ["SCHEDULED", "DELIVERED", "CANCELLED"] },
      },
      orderBy: [{ checkedInAt: "asc" }, { createdAt: "asc" }],
      take: 30,
      select: {
        id: true,
        number: true,
        status: true,
        concern: true,
        checkedInAt: true,
        promisedAt: true,
        customer: { select: { firstName: true, lastName: true, companyName: true, phone: true } },
        vehicle: { select: { year: true, make: true, model: true, plate: true } },
        invoices: {
          where: { status: { not: "VOID" } },
          select: { id: true, number: true, status: true, total: true, amountPaid: true, amountCredited: true },
        },
      },
    }),
    db.invoice.aggregate({
      where: { ...tenantScope(req), issuedAt: { gte: startOfDay, lt: endOfDay }, status: { not: "VOID" } },
      _sum: { total: true },
      _count: true,
    }),
    can(ctx.role, "inventory.read")
      ? lowStockCount(ctx.organizationId)
      : Promise.resolve(null),
    can(ctx.role, "bookings.read")
      ? db.bookingRequest.count({ where: { ...tenantScope(req), status: { in: ["NEW", "CONTACTED"] } } })
      : Promise.resolve(null),
    ctx.locationId
      ? db.location.findUnique({ where: { id: ctx.locationId }, select: { bayCount: true } })
      : db.location.findFirst({
          where: { ...tenantScope(req), isActive: true },
          orderBy: { createdAt: "asc" },
          select: { bayCount: true },
        }),
  ]);

  const seesInvoices = can(ctx.role, "invoices.read");
  const seesFinance = can(ctx.role, "finance.read");
  const outstanding =
    (unpaid._sum.total ?? 0) - (unpaid._sum.amountPaid ?? 0) - (unpaid._sum.amountCredited ?? 0);

  // Compute separate revenue breakdown for Tire Shop vs Mufflers Shop
  let tireCollectedToday = 0;
  let mufflerCollectedToday = 0;
  let tirePaymentsCount = 0;
  let mufflerPaymentsCount = 0;
  let tireInvoicedToday = 0;
  let mufflerInvoicedToday = 0;
  let tireInvoicedCount = 0;
  let mufflerInvoicedCount = 0;

  if (seesFinance || seesInvoices) {
    const [todaysDetailedPayments, todaysDetailedInvoices] = await Promise.all([
      seesFinance
        ? db.payment.findMany({
            where: { ...tenantScope(req), receivedAt: { gte: startOfDay, lt: endOfDay }, status: "SUCCEEDED" },
            include: {
              allocations: {
                include: {
                  invoice: {
                    include: {
                      lines: {
                        include: {
                          inventoryUnits: {
                            include: { product: { select: { kind: true } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
      seesInvoices
        ? db.invoice.findMany({
            where: { ...tenantScope(req), issuedAt: { gte: startOfDay, lt: endOfDay }, status: { not: "VOID" } },
            include: {
              lines: {
                include: {
                  inventoryUnits: {
                    include: { product: { select: { kind: true } } },
                  },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    for (const p of todaysDetailedPayments) {
      let tireLinesSum = 0;
      let mufflerLinesSum = 0;
      for (const alloc of p.allocations) {
        for (const line of alloc.invoice.lines) {
          const d = classifyLineDepartment(line);
          if (d === "TIRE") tireLinesSum += line.lineTotal + line.taxAmount;
          else if (d === "MUFFLER") mufflerLinesSum += line.lineTotal + line.taxAmount;
        }
      }
      const sum = tireLinesSum + mufflerLinesSum;
      let tireShare = 0.5;
      if (sum > 0) {
        tireShare = tireLinesSum / sum;
      } else {
        const ref = (p.reference ?? "").toLowerCase();
        if (ref.includes("tire")) tireShare = 1;
        else if (ref.includes("muffler") || ref.includes("exhaust")) tireShare = 0;
      }
      const tAmt = Math.round(p.amount * tireShare);
      const mAmt = p.amount - tAmt;
      if (tAmt > 0) {
        tireCollectedToday += tAmt;
        tirePaymentsCount++;
      }
      if (mAmt > 0) {
        mufflerCollectedToday += mAmt;
        mufflerPaymentsCount++;
      }
    }

    for (const inv of todaysDetailedInvoices) {
      let hasTire = false;
      let hasMuffler = false;
      for (const line of inv.lines) {
        const d = classifyLineDepartment(line);
        if (d === "TIRE") {
          tireInvoicedToday += line.lineTotal + line.taxAmount;
          hasTire = true;
        } else if (d === "MUFFLER") {
          mufflerInvoicedToday += line.lineTotal + line.taxAmount;
          hasMuffler = true;
        } else {
          tireInvoicedToday += line.lineTotal + line.taxAmount;
          hasTire = true;
        }
      }
      if (hasTire) tireInvoicedCount++;
      if (hasMuffler) mufflerInvoicedCount++;
    }
  }

  res.json({
    timezone: org.timezone,
    appointmentsToday: appointments.map((a) => ({
      ...a,
      department: classifyTextDepartment(`${a.concern} ${a.requestedWork ?? ""}`, a.id),
    })),
    bayCount: location?.bayCount ?? null,
    inService: inService.map((ro) => {
      const invoice = ro.invoices[0] ?? null;
      return {
        ...ro,
        department: classifyTextDepartment(ro.concern, ro.number || ro.id),
        invoices: undefined,
        invoice:
          invoice && seesInvoices
            ? {
                id: invoice.id,
                number: invoice.number,
                status: invoice.status,
                balance: invoice.total - invoice.amountPaid - invoice.amountCredited,
              }
            : invoice
              ? { id: invoice.id, number: invoice.number, status: invoice.status, balance: null }
              : null,
      };
    }),
    invoicedToday: seesInvoices
      ? { count: invoicedToday._count, total: invoicedToday._sum.total ?? 0 }
      : null,
    lowStockCount: lowStock,
    newBookingRequests: newBookings,
    openJobs,
    unpaidInvoices: {
      count: unpaid._count,
      outstanding: can(ctx.role, "invoices.read") ? outstanding : null,
    },
    cashCollectedToday: seesFinance ? (todaysPayments._sum.amount ?? 0) : null,
    paymentsToday: todaysPayments._count,
    revenueByShop: seesFinance || seesInvoices
      ? {
          tireShop: {
            revenue: seesFinance ? tireCollectedToday : null,
            paymentsCount: tirePaymentsCount,
            invoiced: seesInvoices ? tireInvoicedToday : null,
            invoicedCount: tireInvoicedCount,
          },
          mufflersShop: {
            revenue: seesFinance ? mufflerCollectedToday : null,
            paymentsCount: mufflerPaymentsCount,
            invoiced: seesInvoices ? mufflerInvoicedToday : null,
            invoicedCount: mufflerInvoicedCount,
          },
        }
      : null,
    openReconciliationItems: exceptions,
    myOpenTasks: myTasks,
  });
};

export const getDailySales = async (req: Request, res: Response) => {
  const { from, to } = rangeFrom(req);
  const invoices = await db.invoice.findMany({
    where: {
      ...tenantScope(req),
      status: { notIn: ["DRAFT", "VOID"] },
      issuedAt: { gte: from, lte: to },
    },
    include: {
      customer: { select: { firstName: true, lastName: true, companyName: true } },
      lines: {
        include: {
          inventoryUnits: {
            include: {
              product: { select: { kind: true, name: true, brand: true } },
            },
          },
        },
      },
    },
    orderBy: { issuedAt: "desc" },
  });

  const overallByDay = new Map<string, { net: number; tax: number; gross: number; count: number }>();
  const tireByDay = new Map<string, { net: number; tax: number; gross: number; count: number }>();
  const mufflerByDay = new Map<string, { net: number; tax: number; gross: number; count: number }>();

  const tireInvoices: Array<{
    id: string;
    number: string;
    customer: string;
    issuedAt: string;
    net: number;
    tax: number;
    total: number;
    lines: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number; taxAmount: number }>;
  }> = [];

  const mufflerInvoices: Array<{
    id: string;
    number: string;
    customer: string;
    issuedAt: string;
    net: number;
    tax: number;
    total: number;
    lines: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number; taxAmount: number }>;
  }> = [];

  const tireItemMap = new Map<string, { description: string; quantity: number; lineTotal: number; taxAmount: number; lineType: string }>();
  const mufflerItemMap = new Map<string, { description: string; quantity: number; lineTotal: number; taxAmount: number; lineType: string }>();

  let tireNetTotal = 0;
  let tireTaxTotal = 0;
  let tireGrossTotal = 0;
  let tireLineCount = 0;

  let mufflerNetTotal = 0;
  let mufflerTaxTotal = 0;
  let mufflerGrossTotal = 0;
  let mufflerLineCount = 0;

  for (const inv of invoices) {
    const dayKey = inv.issuedAt!.toISOString().slice(0, 10);
    const customerName = [inv.customer.firstName, inv.customer.lastName].filter(Boolean).join(" ") || inv.customer.companyName || "Walk-in";

    // Overall day row
    const overallRow = overallByDay.get(dayKey) ?? { net: 0, tax: 0, gross: 0, count: 0 };
    overallRow.net += inv.subtotal - inv.discountTotal;
    overallRow.tax += inv.taxTotal;
    overallRow.gross += inv.total;
    overallRow.count += 1;
    overallByDay.set(dayKey, overallRow);

    // Analyze lines
    let invTireNet = 0;
    let invTireTax = 0;
    const invTireLines: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number; taxAmount: number }> = [];

    let invMufflerNet = 0;
    let invMufflerTax = 0;
    const invMufflerLines: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number; taxAmount: number }> = [];

    for (const line of inv.lines) {
      const dept = classifyLineDepartment(line);
      const qty = decimalToNumber(line.quantity);

      if (dept === "TIRE") {
        invTireNet += line.lineTotal;
        invTireTax += line.taxAmount;
        tireNetTotal += line.lineTotal;
        tireTaxTotal += line.taxAmount;
        tireGrossTotal += line.lineTotal + line.taxAmount;
        tireLineCount += 1;

        invTireLines.push({
          description: line.description,
          quantity: qty,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          taxAmount: line.taxAmount,
        });

        const existing = tireItemMap.get(line.description) ?? {
          description: line.description,
          quantity: 0,
          lineTotal: 0,
          taxAmount: 0,
          lineType: line.lineType,
        };
        existing.quantity += qty;
        existing.lineTotal += line.lineTotal;
        existing.taxAmount += line.taxAmount;
        tireItemMap.set(line.description, existing);
      } else if (dept === "MUFFLER") {
        invMufflerNet += line.lineTotal;
        invMufflerTax += line.taxAmount;
        mufflerNetTotal += line.lineTotal;
        mufflerTaxTotal += line.taxAmount;
        mufflerGrossTotal += line.lineTotal + line.taxAmount;
        mufflerLineCount += 1;

        invMufflerLines.push({
          description: line.description,
          quantity: qty,
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
          taxAmount: line.taxAmount,
        });

        const existing = mufflerItemMap.get(line.description) ?? {
          description: line.description,
          quantity: 0,
          lineTotal: 0,
          taxAmount: 0,
          lineType: line.lineType,
        };
        existing.quantity += qty;
        existing.lineTotal += line.lineTotal;
        existing.taxAmount += line.taxAmount;
        mufflerItemMap.set(line.description, existing);
      }
    }

    if (invTireLines.length > 0) {
      tireInvoices.push({
        id: inv.id,
        number: inv.number,
        customer: customerName,
        issuedAt: inv.issuedAt!.toISOString(),
        net: invTireNet,
        tax: invTireTax,
        total: invTireNet + invTireTax,
        lines: invTireLines,
      });

      const tireDayRow = tireByDay.get(dayKey) ?? { net: 0, tax: 0, gross: 0, count: 0 };
      tireDayRow.net += invTireNet;
      tireDayRow.tax += invTireTax;
      tireDayRow.gross += invTireNet + invTireTax;
      tireDayRow.count += 1;
      tireByDay.set(dayKey, tireDayRow);
    }

    if (invMufflerLines.length > 0) {
      mufflerInvoices.push({
        id: inv.id,
        number: inv.number,
        customer: customerName,
        issuedAt: inv.issuedAt!.toISOString(),
        net: invMufflerNet,
        tax: invMufflerTax,
        total: invMufflerNet + invMufflerTax,
        lines: invMufflerLines,
      });

      const mufflerDayRow = mufflerByDay.get(dayKey) ?? { net: 0, tax: 0, gross: 0, count: 0 };
      mufflerDayRow.net += invMufflerNet;
      mufflerDayRow.tax += invMufflerTax;
      mufflerDayRow.gross += invMufflerNet + invMufflerTax;
      mufflerDayRow.count += 1;
      mufflerByDay.set(dayKey, mufflerDayRow);
    }
  }

  res.json({
    basis: "invoice issue date",
    note: "Sales exclude sales tax, which is a liability. This is not cash collected.",
    from,
    to,
    days: [...overallByDay.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    totals: {
      net: invoices.reduce((s, i) => s + i.subtotal - i.discountTotal, 0),
      tax: invoices.reduce((s, i) => s + i.taxTotal, 0),
      gross: invoices.reduce((s, i) => s + i.total, 0),
      count: invoices.length,
    },
    tireShop: {
      shopName: "Tire Shop",
      totals: {
        net: tireNetTotal,
        tax: tireTaxTotal,
        gross: tireGrossTotal,
        invoiceCount: tireInvoices.length,
        lineCount: tireLineCount,
      },
      days: [...tireByDay.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      items: [...tireItemMap.values()].sort((a, b) => b.lineTotal - a.lineTotal),
      invoices: tireInvoices,
    },
    mufflersShop: {
      shopName: "Mufflers Shop",
      totals: {
        net: mufflerNetTotal,
        tax: mufflerTaxTotal,
        gross: mufflerGrossTotal,
        invoiceCount: mufflerInvoices.length,
        lineCount: mufflerLineCount,
      },
      days: [...mufflerByDay.entries()]
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      items: [...mufflerItemMap.values()].sort((a, b) => b.lineTotal - a.lineTotal),
      invoices: mufflerInvoices,
    },
  });
};


export const getJobMargins = async (req: Request, res: Response) => {
  const { from, to } = rangeFrom(req);
  const orders = await db.repairOrder.findMany({
    where: { ...tenantScope(req), createdAt: { gte: from, lte: to } },
    include: {
      customer: { select: { firstName: true, lastName: true } },
      vehicle: { select: { year: true, make: true, model: true } },
      partUsages: true,
      invoices: { where: { status: { notIn: ["DRAFT", "VOID"] } }, include: { lines: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const rows = orders
    .filter((o) => o.invoices.length > 0)
    .map((o) => {
      const netSales = o.invoices.reduce((s, i) => s + i.subtotal - i.discountTotal, 0);
      const partsCost = o.partUsages
        .filter((p) => !p.returned)
        .reduce((s, p) => s + Math.round(decimalToNumber(p.quantity) * p.unitCost), 0);
      const laborCost = o.invoices
        .flatMap((i) => i.lines)
        .filter((l) => l.lineType === "LABOR")
        .reduce((s, l) => s + Math.round(decimalToNumber(l.quantity) * l.unitCost), 0);
      const directCost = partsCost + laborCost;

      const billedParts = o.invoices
        .flatMap((i) => i.lines)
        .some((l) => l.lineType === "PART");
      const missingCosts = (billedParts && partsCost === 0) || o.costsProvisional;

      return {
        id: o.id,
        number: o.number,
        customer: `${o.customer.firstName} ${o.customer.lastName}`,
        vehicle: [o.vehicle.year, o.vehicle.make, o.vehicle.model].filter(Boolean).join(" "),
        netSales,
        partsCost,
        laborCost,
        directCost,
        grossProfit: netSales - directCost,
        grossMarginPct: grossMarginPct(netSales, directCost),
        provisional: o.costsProvisional,
        missingCosts,
      };
    });

  res.json({
    from,
    to,
    rows,
    flaggedCount: rows.filter((r) => r.missingCosts).length,
    note: "Rows marked provisional or missing costs are not final margins.",
  });
};

export const getTechnicianHours = async (req: Request, res: Response) => {
  const { from, to } = rangeFrom(req);

  const entries = await db.timeEntry.findMany({
    where: { repairOrder: { ...tenantScope(req) }, startedAt: { gte: from, lte: to } },
    include: {
      technician: { select: { id: true, firstName: true, lastName: true } },
      repairOrder: { include: { invoices: { include: { lines: true } } } },
    },
  });

  const byTech = new Map<
    string,
    { name: string; workedHours: number; billedHours: number; jobs: Set<string> }
  >();

  for (const e of entries) {
    const row = byTech.get(e.technicianId) ?? {
      name: `${e.technician.firstName} ${e.technician.lastName}`,
      workedHours: 0,
      billedHours: 0,
      jobs: new Set<string>(),
    };
    row.workedHours += decimalToNumber(e.workedHours);
    if (!row.jobs.has(e.repairOrderId)) {
      row.jobs.add(e.repairOrderId);
      row.billedHours += e.repairOrder.invoices
        .flatMap((i) => i.lines)
        .filter((l) => l.lineType === "LABOR")
        .reduce((s, l) => s + decimalToNumber(l.hours ?? l.quantity), 0);
    }
    byTech.set(e.technicianId, row);
  }

  res.json({
    from,
    to,
    rows: [...byTech.entries()].map(([id, r]) => ({
      technicianId: id,
      name: r.name,
      workedHours: Number(r.workedHours.toFixed(2)),
      billedHours: Number(r.billedHours.toFixed(2)),
      jobCount: r.jobs.size,
      efficiency:
        r.workedHours > 0 ? Number(((r.billedHours / r.workedHours) * 100).toFixed(1)) : null,
    })),
  });
};

export const getReconciliationSummary = async (req: Request, res: Response) => {
  const [clearing, awaitingBank, openItems, unknownAttempts] = await Promise.all([
    db.payment.aggregate({
      where: { ...tenantScope(req), provider: { not: "manual" }, bankConfirmedAt: null },
      _sum: { amount: true, feeAmount: true },
      _count: true,
    }),
    db.payment.findMany({
      where: { ...tenantScope(req), provider: { not: "manual" }, bankConfirmedAt: null },
      orderBy: { receivedAt: "asc" },
      take: 50,
      select: { id: true, amount: true, feeAmount: true, receivedAt: true, provider: true },
    }),
    db.reconciliationItem.groupBy({
      by: ["kind"],
      where: { ...tenantScope(req), status: "OPEN" },
      _count: true,
    }),
    db.paymentAttempt.count({ where: { ...tenantScope(req), status: "UNKNOWN" } }),
  ]);

  res.json({
    processorClearing: {
      count: clearing._count,
      gross: clearing._sum.amount ?? 0,
      fees: clearing._sum.feeAmount ?? 0,
      net: (clearing._sum.amount ?? 0) - (clearing._sum.feeAmount ?? 0),
    },
    awaitingBankConfirmation: awaitingBank,
    openExceptionsByKind: openItems.map((g) => ({ kind: g.kind, count: g._count })),
    unresolvedAttempts: unknownAttempts,
    note: "Processor-confirmed receipts are labelled separately from bank-received funds.",
  });
};
