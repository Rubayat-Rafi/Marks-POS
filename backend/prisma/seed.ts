/**
 * Demo data for the Auto Shop Web App.
 *
 * Run with:  npm run db:seed
 *
 * What it builds:
 *  - TWO shops, so tenant isolation can actually be tested rather than assumed.
 *  - One user per role, plus a user who belongs to both shops.
 *  - Customers, vehicles, a parts catalogue, suppliers and labor rates.
 *  - Jobs sitting in every lane of the work board.
 *  - Estimates in draft, sent (with a live approval link), approved and
 *    partly approved states.
 *  - Invoices unpaid, partly paid and paid, each posted to the ledger through
 *    the same domain functions the API uses.
 *  - Expenses, a deposit, a credit note and open reconciliation exceptions.
 *  - The worked finance example from the build guide (page 9), with its
 *    checks printed so you can see the ledger balance.
 *
 * Everything here is synthetic. No real customer data (build guide / 13).
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { CHART_OF_ACCOUNTS, ACCOUNT_CODES } from "../src/domain/accounts.js";
import { postJournalEntry, trialBalance } from "../src/domain/ledger.js";
import {
  applyDeposit,
  issueCreditNote,
  issueInvoice,
  recognizeJobCosts,
  recordDeposit,
  recordPayment,
} from "../src/domain/invoicing.js";
import { priceLines } from "../src/domain/pricing.js";
import { newApprovalToken } from "../src/lib/sequences.js";

const prisma = new PrismaClient();

const PASSWORD = "AutoShop2026!";
const dollars = (n: number) => Math.round(n * 100);

function daysFromNow(days: number, hour = 9): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function wipe() {
  console.log("Clearing existing data...");
  // Order matters: children before parents.
  await prisma.$transaction([
    prisma.inventoryUnit.deleteMany(),
    prisma.inventoryProduct.deleteMany(),
    prisma.bookingRequest.deleteMany(),
    prisma.journalLine.deleteMany(),
    prisma.journalEntry.deleteMany(),
    prisma.depositApplication.deleteMany(),
    prisma.paymentAllocation.deleteMany(),
    prisma.refund.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.paymentAttempt.deleteMany(),
    prisma.creditNote.deleteMany(),
    prisma.customerDeposit.deleteMany(),
    prisma.invoiceLine.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.estimateApproval.deleteMany(),
    prisma.estimateLine.deleteMany(),
    prisma.estimateVersion.deleteMany(),
    prisma.estimate.deleteMany(),
    prisma.jobPartUsage.deleteMany(),
    prisma.timeEntry.deleteMany(),
    prisma.repairTask.deleteMany(),
    prisma.inspectionItem.deleteMany(),
    prisma.inspection.deleteMany(),
    prisma.repairOrder.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.mileageReading.deleteMany(),
    prisma.customerVehicle.deleteMany(),
    prisma.vehicle.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.catalogItem.deleteMany(),
    prisma.supplier.deleteMany(),
    prisma.laborRate.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.cashSession.deleteMany(),
    prisma.reconciliationItem.deleteMany(),
    prisma.webhookInbox.deleteMany(),
    prisma.outboxEvent.deleteMany(),
    prisma.auditEvent.deleteMany(),
    prisma.providerConnection.deleteMany(),
    prisma.account.deleteMany(),
    prisma.numberSequence.deleteMany(),
    prisma.membership.deleteMany(),
    prisma.location.deleteMany(),
    prisma.user.deleteMany(),
    prisma.organization.deleteMany(),
  ]);
}

async function createShop(opts: {
  name: string;
  legalName: string;
  code: string;
  city: string;
  taxRateBps: number;
  addressLine1?: string;
  postalCode?: string;
  phone?: string;
  publicSlug?: string;
}) {
  const org = await prisma.organization.create({
    data: {
      name: opts.name,
      legalName: opts.legalName,
      currency: "USD",
      timezone: "America/Chicago",
      // Louisiana taxes parts but not labor, which is exactly the kind of
      // configuration the guide says must be reviewed per jurisdiction.
      taxRateBps: opts.taxRateBps,
      taxesParts: true,
      taxesLabor: false,
      taxesFees: false,
      paymentProvider: "mock",
      publicSlug: opts.publicSlug ?? null,
      locations: {
        create: {
          name: `${opts.name} - ${opts.city}`,
          code: opts.code,
          addressLine1: opts.addressLine1 ?? "4200 Tchoupitoulas St",
          city: opts.city,
          state: "LA",
          postalCode: opts.postalCode ?? "70115",
          phone: opts.phone ?? "(504) 555-0142",
          bayCount: 5,
        },
      },
    },
    include: { locations: true },
  });

  await prisma.account.createMany({
    data: CHART_OF_ACCOUNTS.map((a) => ({ ...a, organizationId: org.id })),
  });

  await prisma.providerConnection.create({
    data: {
      organizationId: org.id,
      kind: "PAYMENT",
      provider: "mock",
      externalAccountId: "mock_acct_demo",
      displayName: "Demo processor (sandbox)",
      isLive: false,
      isEnabled: true,
      secretRef: "secretstore://mock/demo",
      capabilities: {
        onlineCheckout: true,
        terminal: true,
        partialRefunds: true,
        settlementFeed: false,
      },
      connectedAt: new Date(),
    },
  });

  return { org, location: org.locations[0] };
}

async function createUser(
  email: string,
  firstName: string,
  lastName: string,
  hash: string,
) {
  return prisma.user.create({
    data: { email, firstName, lastName, passwordHash: hash, phone: "(504) 555-0100" },
  });
}

async function main() {
  console.log("Seeding Auto Shop Web App demo data\n");
  await wipe();

  const hash = await bcrypt.hash(PASSWORD, 10);

  // -- shops ----------------------------------------------------------------
  // The real shop's name, address and phone. Everything else (customers,
  // jobs, money) is synthetic demo data.
  const primary = await createShop({
    name: "Mark's Tire Shop & Muffler",
    legalName: "Mark's Tire Shop & Muffler LLC",
    code: "STCLAUDE",
    city: "New Orleans",
    // Placeholder rate. Confirm the combined Louisiana + Orleans Parish rate
    // with the shop's accountant and set it in Settings before real sales.
    taxRateBps: 950,
    addressLine1: "5229 Saint Claude Ave",
    postalCode: "70117",
    phone: "(504) 354-9396",
    publicSlug: "marks-tire-muffler",
  });
  const secondary = await createShop({
    name: "Crescent City Motors",
    legalName: "Crescent City Motors Inc",
    code: "METAIRIE",
    city: "Metairie",
    taxRateBps: 925,
  });

  // -- people ---------------------------------------------------------------
  const owner = await createUser("mohammad@markstire.com", "Mohammad", "Admin", hash);
  const manager = await createUser("manager@markstire.test", "Marcus", "Trahan", hash);
  const advisor = await createUser("advisor@markstire.test", "Alicia", "Nguyen", hash);
  const tech1 = await createUser("tech@markstire.test", "Devin", "Carter", hash);
  const tech2 = await createUser("tech2@markstire.test", "Sam", "Okafor", hash);
  const bookkeeper = await createUser("books@markstire.test", "Priya", "Raman", hash);
  // This person works at both shops, which is the multi-shop login case.
  const consultant = await createUser("consultant@markstire.test", "Jordan", "Lee", hash);
  const rivalOwner = await createUser("owner@crescentcity.test", "Tomas", "Reyes", hash);

  // Employment terms live on the membership: two full-time technicians at an
  // hourly rate and a part-time advisor, so Settings > Team and the payroll
  // estimate on /timeclock have real numbers to show (build guide's own
  // pattern of shipping demo data that exercises every screen).
  const HIRE = new Date("2024-03-01");
  await prisma.membership.createMany({
    data: [
      { userId: owner.id, organizationId: primary.org.id, role: "OWNER" },
      {
        userId: manager.id,
        organizationId: primary.org.id,
        role: "MANAGER",
        employmentType: "FULL_TIME",
        payType: "SALARY",
        payRateCents: dollars(3200), // per pay period
        hireDate: HIRE,
      },
      {
        userId: advisor.id,
        organizationId: primary.org.id,
        locationId: primary.location.id,
        role: "SERVICE_ADVISOR",
        employmentType: "PART_TIME",
        payType: "HOURLY",
        payRateCents: dollars(22),
        hireDate: HIRE,
      },
      {
        userId: tech1.id,
        organizationId: primary.org.id,
        locationId: primary.location.id,
        role: "TECHNICIAN",
        employmentType: "FULL_TIME",
        payType: "HOURLY",
        payRateCents: dollars(28),
        hireDate: HIRE,
      },
      {
        userId: tech2.id,
        organizationId: primary.org.id,
        locationId: primary.location.id,
        role: "TECHNICIAN",
        employmentType: "PART_TIME",
        payType: "HOURLY",
        payRateCents: dollars(24),
        hireDate: new Date("2025-06-01"),
      },
      { userId: bookkeeper.id, organizationId: primary.org.id, role: "BOOKKEEPER" },
      { userId: consultant.id, organizationId: primary.org.id, role: "MANAGER" },
      { userId: consultant.id, organizationId: secondary.org.id, role: "MANAGER" },
      { userId: rivalOwner.id, organizationId: secondary.org.id, role: "OWNER" },
    ],
  });

  // A few days of shift punches: closed days for both technicians, and tech1
  // currently clocked in, so the worker dashboard's clock widget and the
  // owner's payroll estimate both have something real to show.
  await prisma.shiftClockEntry.createMany({
    data: [
      {
        organizationId: primary.org.id,
        userId: tech1.id,
        locationId: primary.location.id,
        clockInAt: daysFromNow(-2, 8),
        clockOutAt: daysFromNow(-2, 17),
      },
      {
        organizationId: primary.org.id,
        userId: tech1.id,
        locationId: primary.location.id,
        clockInAt: daysFromNow(-1, 8),
        clockOutAt: daysFromNow(-1, 16),
      },
      {
        organizationId: primary.org.id,
        userId: tech2.id,
        locationId: primary.location.id,
        clockInAt: daysFromNow(-1, 9),
        clockOutAt: daysFromNow(-1, 13),
      },
      {
        organizationId: primary.org.id,
        userId: advisor.id,
        locationId: primary.location.id,
        clockInAt: daysFromNow(0, 8),
        clockOutAt: daysFromNow(0, 12),
      },
    ],
  });
  // Still on the clock right now, to demonstrate the live-running widget.
  await prisma.shiftClockEntry.create({
    data: {
      organizationId: primary.org.id,
      userId: tech1.id,
      locationId: primary.location.id,
      clockInAt: daysFromNow(0, 8),
      note: "Morning shift",
    },
  });

  // -- shop configuration ---------------------------------------------------
  await prisma.laborRate.createMany({
    data: [
      {
        organizationId: primary.org.id,
        name: "Standard",
        ratePerHour: dollars(145),
        costPerHour: dollars(42),
        isDefault: true,
      },
      {
        organizationId: primary.org.id,
        name: "Diagnostic",
        ratePerHour: dollars(175),
        costPerHour: dollars(48),
      },
      {
        organizationId: primary.org.id,
        name: "Fleet",
        ratePerHour: dollars(120),
        costPerHour: dollars(42),
      },
    ],
  });

  const napa = await prisma.supplier.create({
    data: {
      organizationId: primary.org.id,
      name: "Gulf Coast Parts",
      accountNumber: "GCP-88213",
      phone: "(504) 555-0190",
    },
  });
  const dealer = await prisma.supplier.create({
    data: {
      organizationId: primary.org.id,
      name: "Delta OEM Supply",
      accountNumber: "DOS-40021",
      phone: "(504) 555-0177",
    },
  });

  const catalog = await Promise.all(
    [
      ["BRK-4471", "Ceramic brake pad set, front", 3812, 8995, 14, napa.id],
      ["BRK-9902", "Brake rotor, front (pair)", 6420, 15400, 8, napa.id],
      ["OIL-5W30", "Full synthetic oil 5W-30, quart", 519, 1295, 96, napa.id],
      ["FLT-3614", "Oil filter, spin-on", 428, 1450, 40, napa.id],
      ["BAT-H6", "AGM battery, group H6", 12800, 24900, 6, napa.id],
      ["ALT-2288", "Alternator, remanufactured", 17450, 38900, 3, dealer.id],
      ["SPK-IR4", "Iridium spark plug", 812, 2195, 32, dealer.id],
      ["CAB-7712", "Cabin air filter", 940, 3200, 22, napa.id],
      ["SER-BELT", "Serpentine belt", 1875, 5400, 11, napa.id],
      ["COOL-50", "Coolant, premixed gallon", 1120, 2850, 18, napa.id],
    ].map(([partNumber, description, cost, price, onHand, supplierId]) =>
      prisma.catalogItem.create({
        data: {
          organizationId: primary.org.id,
          supplierId: supplierId as string,
          partNumber: partNumber as string,
          description: description as string,
          costCents: cost as number,
          priceCents: price as number,
          onHand: onHand as number,
        },
      }),
    ),
  );
  const part = (n: string) => catalog.find((c) => c.partNumber === n)!;

  await seedInventory(primary.org.id);

  // -- customers and vehicles ----------------------------------------------
  const people = [
    ["Denise", "Fontenot", "denise.fontenot@example.test", "(504) 555-0201"],
    ["Wallace", "Kim", "wallace.kim@example.test", "(504) 555-0202"],
    ["Imani", "Joseph", "imani.joseph@example.test", "(504) 555-0203"],
    ["Peter", "Lando", "peter.lando@example.test", "(504) 555-0204"],
    ["Gabriela", "Ortiz", "gabriela.ortiz@example.test", "(504) 555-0205"],
    ["Terrence", "Blanchard", "terrence.b@example.test", "(504) 555-0206"],
    ["Hannah", "Delacroix", "hannah.d@example.test", "(504) 555-0207"],
    ["Owen", "Pham", "owen.pham@example.test", "(504) 555-0208"],
  ];

  const customers = await Promise.all(
    people.map(([firstName, lastName, email, phone], i) =>
      prisma.customer.create({
        data: {
          organizationId: primary.org.id,
          firstName: firstName as string,
          lastName: lastName as string,
          email: email as string,
          phone: phone as string,
          addressLine1: `${1200 + i * 37} Magazine St`,
          city: "New Orleans",
          state: "LA",
          postalCode: "70130",
          allowsSms: true,
          // Marketing consent is deliberately NOT implied by being a customer.
          allowsMarketing: i % 3 === 0,
          // One fleet account is tax exempt, which exercises the tax policy.
          taxExempt: i === 5,
          companyName: i === 5 ? "Blanchard Seafood Distribution" : null,
        },
      }),
    ),
  );

  const vehicleSpecs = [
    ["1HGCM82633A004352", "2019", "Honda", "Accord", "EX-L", "2.0L I4 Gas", "TPY-4410"],
    ["3VWFE21C04M000001", "2021", "Toyota", "RAV4", "XLE", "2.5L I4 Hybrid", "LKM-2287"],
    ["1FTFW1ET5DFA00001", "2018", "Ford", "F-150", "XLT", "3.5L V6 EcoBoost", "WQR-9931"],
    ["5YJ3E1EA7KF000001", "2022", "Subaru", "Outback", "Premium", "2.5L H4 Gas", "BVN-1174"],
    ["JM1BL1VF1A1000001", "2017", "Mazda", "3", "Touring", "2.0L I4 Gas", "GHT-6620"],
    ["1GCHK23D77F000001", "2020", "Chevrolet", "Silverado 2500", "LT", "6.6L V8 Diesel", "FLT-0011"],
    ["WBA3A5C51DF000001", "2016", "BMW", "328i", "Sport", "2.0L I4 Turbo", "XCE-7708"],
    ["KNDJN2A29H7000001", "2023", "Kia", "Soul", "S", "2.0L I4 Gas", "PDQ-3345"],
  ];

  const vehicles = await Promise.all(
    vehicleSpecs.map(([vin, year, make, model, trim, engine, plate], i) =>
      prisma.vehicle.create({
        data: {
          organizationId: primary.org.id,
          vin: vin as string,
          year: Number(year),
          make: make as string,
          model: model as string,
          trim: trim as string,
          engine: engine as string,
          plate: plate as string,
          plateState: "LA",
          color: ["Silver", "Blue", "White", "Green", "Red", "Black", "Grey", "Yellow"][i],
          // Provenance recorded for the ones that came from a decode.
          vinSource: i < 5 ? "nhtsa_vpic" : null,
          vinDecodedAt: i < 5 ? new Date() : null,
          owners: { create: { customerId: customers[i].id } },
          mileageReadings: {
            create: { miles: 38_000 + i * 11_500, source: "check_in" },
          },
        },
      }),
    ),
  );

  // -- appointments ---------------------------------------------------------
  await prisma.appointment.createMany({
    data: [
      {
        organizationId: primary.org.id,
        locationId: primary.location.id,
        customerId: customers[6].id,
        vehicleId: vehicles[6].id,
        scheduledFor: daysFromNow(0, 8),
        estimatedHours: 1.5,
        concern: "Grinding noise from front end when braking",
        requestedWork: "Inspect brakes, quote replacement",
        mileageIn: 84_210,
        status: "CONFIRMED",
      },
      {
        organizationId: primary.org.id,
        locationId: primary.location.id,
        customerId: customers[7].id,
        vehicleId: vehicles[7].id,
        scheduledFor: daysFromNow(0, 13),
        estimatedHours: 0.75,
        concern: "Oil change due, check tire wear",
        mileageIn: 21_400,
        status: "SCHEDULED",
      },
      {
        organizationId: primary.org.id,
        locationId: primary.location.id,
        customerId: customers[0].id,
        vehicleId: vehicles[0].id,
        scheduledFor: daysFromNow(1, 10),
        estimatedHours: 2,
        concern: "Check engine light, rough idle at stops",
        status: "SCHEDULED",
      },
      {
        organizationId: primary.org.id,
        locationId: primary.location.id,
        customerId: customers[2].id,
        vehicleId: vehicles[2].id,
        scheduledFor: daysFromNow(3, 9),
        estimatedHours: 3,
        concern: "Battery dying overnight, needs charging system test",
        status: "SCHEDULED",
      },
    ],
  });

  // -- jobs across the work board -------------------------------------------
  const laneSpecs: Array<{
    status:
      | "CHECKED_IN"
      | "DIAGNOSING"
      | "AWAITING_APPROVAL"
      | "AWAITING_PARTS"
      | "IN_PROGRESS"
      | "QUALITY_CHECK"
      | "READY";
    customerIdx: number;
    concern: string;
  }> = [
    { status: "CHECKED_IN", customerIdx: 1, concern: "Hybrid battery warning on dash" },
    { status: "DIAGNOSING", customerIdx: 2, concern: "Intermittent no-start, clicks once" },
    { status: "AWAITING_APPROVAL", customerIdx: 3, concern: "Coolant smell after highway driving" },
    { status: "AWAITING_PARTS", customerIdx: 4, concern: "Serpentine belt squeal on cold start" },
    { status: "IN_PROGRESS", customerIdx: 5, concern: "Fleet service: brakes and fluids" },
    { status: "QUALITY_CHECK", customerIdx: 6, concern: "Rear main seal weep, follow-up" },
    { status: "READY", customerIdx: 7, concern: "Scheduled maintenance at 21k" },
  ];

  let roCounter = 1000;
  const boardOrders = [];
  for (const spec of laneSpecs) {
    const ro = await prisma.repairOrder.create({
      data: {
        organizationId: primary.org.id,
        locationId: primary.location.id,
        customerId: customers[spec.customerIdx].id,
        vehicleId: vehicles[spec.customerIdx].id,
        number: `RO-${roCounter++}`,
        status: spec.status,
        concern: spec.concern,
        mileageIn: 40_000 + spec.customerIdx * 9_000,
        checkedInAt: daysFromNow(-1, 8),
        promisedAt: daysFromNow(spec.status === "READY" ? 0 : 1, 17),
        tasks: {
          create: [
            {
              description: "Road test and confirm concern",
              status: "DONE",
              assignedToId: tech1.id,
              estimatedHours: 0.5,
              sortOrder: 0,
            },
            {
              description: "Perform repair",
              status: spec.status === "READY" ? "DONE" : "IN_PROGRESS",
              assignedToId: spec.customerIdx % 2 === 0 ? tech1.id : tech2.id,
              estimatedHours: 2,
              sortOrder: 1,
            },
          ],
        },
        timeEntries: {
          create: [
            {
              technicianId: spec.customerIdx % 2 === 0 ? tech1.id : tech2.id,
              startedAt: daysFromNow(-1, 9),
              endedAt: daysFromNow(-1, 11),
              workedHours: 2.0,
              note: "Diagnosis and initial work",
            },
          ],
        },
      },
    });
    boardOrders.push(ro);
  }

  // A completed multi-point inspection with one urgent finding.
  await prisma.inspection.create({
    data: {
      organizationId: primary.org.id,
      vehicleId: vehicles[6].id,
      repairOrderId: boardOrders[5].id,
      performedById: tech1.id,
      title: "Multi-point inspection",
      notes: "Vehicle otherwise sound. Rear seal seepage documented with photos.",
      completedAt: daysFromNow(-1, 12),
      items: {
        create: [
          { category: "Brakes", label: "Front pads", result: "ADVISE", note: "4mm remaining", sortOrder: 0 },
          { category: "Brakes", label: "Rear pads", result: "OK", sortOrder: 1 },
          { category: "Fluids", label: "Engine oil", result: "URGENT", note: "Below minimum, seepage at rear seal", sortOrder: 2 },
          { category: "Tires", label: "Tread depth", result: "OK", note: "6/32 all round", sortOrder: 3 },
          { category: "Electrical", label: "Battery load test", result: "OK", sortOrder: 4 },
          { category: "Steering", label: "Tie rod ends", result: "NOT_CHECKED", sortOrder: 5 },
        ],
      },
    },
  });

  // -- estimates in several states -----------------------------------------
  const taxPolicy = {
    taxRateBps: primary.org.taxRateBps,
    taxesParts: true,
    taxesLabor: false,
    taxesFees: false,
  };

  async function buildEstimate(opts: {
    number: string;
    repairOrderId: string;
    customerIdx: number;
    lines: Array<{
      lineType: "PART" | "LABOR" | "FEE" | "DISCOUNT";
      description: string;
      quantity: number;
      unitPrice: number;
      unitCost?: number;
      hours?: number;
      catalogItemId?: string;
    }>;
    state: "DRAFT" | "SENT" | "APPROVED" | "PARTLY_APPROVED";
  }) {
    const customer = customers[opts.customerIdx];
    const totals = priceLines(
      opts.lines.map((l) => ({
        lineType: l.lineType,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        unitCost: l.unitCost ?? 0,
        taxable: true,
      })),
      { ...taxPolicy, customerTaxExempt: customer.taxExempt },
    );

    const sent = opts.state !== "DRAFT";
    const token = sent && opts.state === "SENT" ? newApprovalToken() : null;

    const estimate = await prisma.estimate.create({
      data: {
        organizationId: primary.org.id,
        locationId: primary.location.id,
        customerId: customer.id,
        vehicleId: vehicles[opts.customerIdx].id,
        repairOrderId: opts.repairOrderId,
        number: opts.number,
        status: opts.state,
        createdById: advisor.id,
        expiresAt: daysFromNow(14),
        versions: {
          create: {
            version: 1,
            status: opts.state,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            taxTotal: totals.taxTotal,
            total: totals.total,
            taxRateBps: taxPolicy.taxRateBps,
            sentAt: sent ? daysFromNow(-1, 14) : null,
            frozenAt: sent ? daysFromNow(-1, 14) : null,
            approvalToken: token,
            approvalTokenExpiresAt: token ? daysFromNow(6) : null,
            lines: {
              create: opts.lines.map((l, i) => ({
                lineType: l.lineType,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                unitCost: l.unitCost ?? 0,
                hours: l.hours ?? null,
                taxable: l.lineType === "PART",
                catalogItemId: l.catalogItemId ?? null,
                lineTotal: totals.lines[i].lineTotal,
                sortOrder: i,
                approved:
                  opts.state === "APPROVED" ||
                  (opts.state === "PARTLY_APPROVED" && l.lineType !== "FEE"),
              })),
            },
          },
        },
      },
      include: { versions: { include: { lines: true } } },
    });

    // Approved estimates carry the evidence of who agreed and when.
    if (opts.state === "APPROVED" || opts.state === "PARTLY_APPROVED") {
      const version = estimate.versions[0];
      const approvedLines = version.lines.filter((l) => l.approved);
      await prisma.estimateApproval.create({
        data: {
          estimateVersionId: version.id,
          approvedLineIds: approvedLines.map((l) => l.id),
          approvedTotal: approvedLines.reduce((s, l) => s + l.lineTotal, 0),
          partial: opts.state === "PARTLY_APPROVED",
          approverName: `${customer.firstName} ${customer.lastName}`,
          method: "web_link",
          approverIp: "203.0.113.45",
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
          createdAt: daysFromNow(-1, 15),
        },
      });
    }

    return { estimate, token, totals };
  }

  const brakeJob = await buildEstimate({
    number: "EST-1000",
    repairOrderId: boardOrders[2].id,
    customerIdx: 3,
    state: "SENT",
    lines: [
      {
        lineType: "PART",
        description: "Ceramic brake pad set, front",
        quantity: 1,
        unitPrice: part("BRK-4471").priceCents,
        unitCost: part("BRK-4471").costCents,
        catalogItemId: part("BRK-4471").id,
      },
      {
        lineType: "PART",
        description: "Brake rotor, front (pair)",
        quantity: 1,
        unitPrice: part("BRK-9902").priceCents,
        unitCost: part("BRK-9902").costCents,
        catalogItemId: part("BRK-9902").id,
      },
      {
        lineType: "LABOR",
        description: "Replace front pads and rotors",
        quantity: 2.5,
        unitPrice: dollars(145),
        unitCost: dollars(42),
        hours: 2.5,
      },
      { lineType: "FEE", description: "Shop supplies", quantity: 1, unitPrice: dollars(18) },
    ],
  });

  await buildEstimate({
    number: "EST-1001",
    repairOrderId: boardOrders[3].id,
    customerIdx: 4,
    state: "PARTLY_APPROVED",
    lines: [
      {
        lineType: "PART",
        description: "Serpentine belt",
        quantity: 1,
        unitPrice: part("SER-BELT").priceCents,
        unitCost: part("SER-BELT").costCents,
        catalogItemId: part("SER-BELT").id,
      },
      {
        lineType: "LABOR",
        description: "Replace serpentine belt",
        quantity: 1,
        unitPrice: dollars(145),
        unitCost: dollars(42),
        hours: 1,
      },
      { lineType: "FEE", description: "Environmental disposal", quantity: 1, unitPrice: dollars(12) },
    ],
  });

  await buildEstimate({
    number: "EST-1002",
    repairOrderId: boardOrders[0].id,
    customerIdx: 1,
    state: "DRAFT",
    lines: [
      {
        lineType: "LABOR",
        description: "Hybrid system diagnostic",
        quantity: 1.5,
        unitPrice: dollars(175),
        unitCost: dollars(48),
        hours: 1.5,
      },
    ],
  });

  // -- completed jobs with invoices ----------------------------------------
  /**
   * Build a finished job end to end: approved estimate, parts consumed,
   * invoice issued through the real posting path, then payment.
   */
  async function completeJob(opts: {
    customerIdx: number;
    number: string;
    concern: string;
    lines: Array<{
      lineType: "PART" | "LABOR" | "FEE" | "DISCOUNT";
      description: string;
      quantity: number;
      unitPrice: number;
      unitCost: number;
      hours?: number;
      catalogItemId?: string;
    }>;
    settle: "paid_card" | "partly_paid_cash" | "unpaid";
    daysAgo: number;
  }) {
    const customer = customers[opts.customerIdx];
    const totals = priceLines(
      opts.lines.map((l) => ({
        lineType: l.lineType,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        taxable: true,
      })),
      { ...taxPolicy, customerTaxExempt: customer.taxExempt },
    );

    const ro = await prisma.repairOrder.create({
      data: {
        organizationId: primary.org.id,
        locationId: primary.location.id,
        customerId: customer.id,
        vehicleId: vehicles[opts.customerIdx].id,
        number: opts.number,
        status: "DELIVERED",
        concern: opts.concern,
        mileageIn: 52_000 + opts.customerIdx * 4_000,
        checkedInAt: daysFromNow(-opts.daysAgo - 1, 8),
        readyAt: daysFromNow(-opts.daysAgo, 15),
        deliveredAt: daysFromNow(-opts.daysAgo, 17),
        partUsages: {
          create: opts.lines
            .filter((l) => l.lineType === "PART")
            .map((l) => ({
              catalogItemId: l.catalogItemId ?? null,
              supplierId: napa.id,
              partNumber: l.catalogItemId
                ? catalog.find((c) => c.id === l.catalogItemId)!.partNumber
                : "MISC",
              description: l.description,
              quantity: l.quantity,
              unitCost: l.unitCost,
              unitPrice: l.unitPrice,
            })),
        },
        timeEntries: {
          create: [
            {
              technicianId: tech1.id,
              startedAt: daysFromNow(-opts.daysAgo - 1, 9),
              endedAt: daysFromNow(-opts.daysAgo - 1, 12),
              workedHours: 3.0,
            },
          ],
        },
      },
    });

    const invoice = await prisma.invoice.create({
      data: {
        organizationId: primary.org.id,
        locationId: primary.location.id,
        customerId: customer.id,
        repairOrderId: ro.id,
        number: `DRAFT-${opts.number}`,
        status: "DRAFT",
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        total: totals.total,
        lines: {
          create: opts.lines.map((l, i) => ({
            lineType: l.lineType,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            unitCost: l.unitCost,
            hours: l.hours ?? null,
            taxable: totals.lines[i].taxRateBps > 0,
            taxRateBps: totals.lines[i].taxRateBps,
            lineTotal: totals.lines[i].lineTotal,
            taxAmount: totals.lines[i].taxAmount,
            sortOrder: i,
          })),
        },
      },
    });

    // Issue and pay through the real domain functions, so the demo database
    // has a ledger that actually balances.
    const issued = await prisma.$transaction(async (tx) => {
      const result = await issueInvoice(tx, {
        invoiceId: invoice.id,
        organizationId: primary.org.id,
        actorId: advisor.id,
      });
      await recognizeJobCosts(tx, {
        repairOrderId: ro.id,
        organizationId: primary.org.id,
        actorId: bookkeeper.id,
      });
      return result;
    });

    if (opts.settle === "paid_card") {
      await prisma.$transaction(async (tx) => {
        const attempt = await tx.paymentAttempt.create({
          data: {
            organizationId: primary.org.id,
            invoiceId: issued.id,
            provider: "mock",
            method: "CARD_TERMINAL",
            amount: issued.total,
            idempotencyKey: `seed-${opts.number}-card`,
            status: "SUCCEEDED",
            externalId: `mock_pi_seed_${opts.number}`,
            externalStatus: "succeeded",
            resolvedAt: daysFromNow(-opts.daysAgo, 17),
          },
        });
        await recordPayment(tx, {
          organizationId: primary.org.id,
          invoiceId: issued.id,
          customerId: customer.id,
          amount: issued.total,
          feeAmount: Math.round(issued.total * 0.029) + 30,
          method: "CARD_TERMINAL",
          provider: "mock",
          externalId: attempt.externalId,
          attemptId: attempt.id,
          actorId: advisor.id,
        });
      });
    }

    if (opts.settle === "partly_paid_cash") {
      await prisma.$transaction(async (tx) => {
        const half = Math.floor(issued.total / 2);
        const attempt = await tx.paymentAttempt.create({
          data: {
            organizationId: primary.org.id,
            invoiceId: issued.id,
            provider: "manual",
            method: "CASH",
            amount: half,
            idempotencyKey: `seed-${opts.number}-cash`,
            status: "SUCCEEDED",
            externalId: `manual_seed_${opts.number}`,
            resolvedAt: daysFromNow(-opts.daysAgo, 17),
          },
        });
        await recordPayment(tx, {
          organizationId: primary.org.id,
          invoiceId: issued.id,
          customerId: customer.id,
          amount: half,
          method: "CASH",
          provider: "manual",
          externalId: attempt.externalId,
          attemptId: attempt.id,
          actorId: advisor.id,
        });
      });
    }

    return { ro, invoice: issued };
  }

  const paidJob = await completeJob({
    customerIdx: 0,
    number: "RO-1200",
    concern: "Brake service, front axle",
    daysAgo: 6,
    settle: "paid_card",
    lines: [
      {
        lineType: "PART",
        description: "Ceramic brake pad set, front",
        quantity: 1,
        unitPrice: part("BRK-4471").priceCents,
        unitCost: part("BRK-4471").costCents,
        catalogItemId: part("BRK-4471").id,
      },
      {
        lineType: "PART",
        description: "Brake rotor, front (pair)",
        quantity: 1,
        unitPrice: part("BRK-9902").priceCents,
        unitCost: part("BRK-9902").costCents,
        catalogItemId: part("BRK-9902").id,
      },
      {
        lineType: "LABOR",
        description: "Replace front pads and rotors",
        quantity: 2.5,
        unitPrice: dollars(145),
        unitCost: dollars(42),
        hours: 2.5,
      },
    ],
  });

  await completeJob({
    customerIdx: 2,
    number: "RO-1201",
    concern: "Charging system failure",
    daysAgo: 12,
    settle: "partly_paid_cash",
    lines: [
      {
        lineType: "PART",
        description: "Alternator, remanufactured",
        quantity: 1,
        unitPrice: part("ALT-2288").priceCents,
        unitCost: part("ALT-2288").costCents,
        catalogItemId: part("ALT-2288").id,
      },
      {
        lineType: "PART",
        description: "Serpentine belt",
        quantity: 1,
        unitPrice: part("SER-BELT").priceCents,
        unitCost: part("SER-BELT").costCents,
        catalogItemId: part("SER-BELT").id,
      },
      {
        lineType: "LABOR",
        description: "Replace alternator and belt",
        quantity: 3,
        unitPrice: dollars(145),
        unitCost: dollars(42),
        hours: 3,
      },
      { lineType: "DISCOUNT", description: "Repeat customer courtesy", quantity: 1, unitPrice: dollars(40), unitCost: 0 },
    ],
  });

  const unpaidJob = await completeJob({
    customerIdx: 5,
    number: "RO-1202",
    concern: "Fleet service: brakes, oil and fluids",
    daysAgo: 45,
    settle: "unpaid",
    lines: [
      {
        lineType: "PART",
        description: "Full synthetic oil 5W-30, quart",
        quantity: 12,
        unitPrice: part("OIL-5W30").priceCents,
        unitCost: part("OIL-5W30").costCents,
        catalogItemId: part("OIL-5W30").id,
      },
      {
        lineType: "PART",
        description: "Oil filter, spin-on",
        quantity: 1,
        unitPrice: part("FLT-3614").priceCents,
        unitCost: part("FLT-3614").costCents,
        catalogItemId: part("FLT-3614").id,
      },
      {
        lineType: "LABOR",
        description: "Fleet service package",
        quantity: 4,
        unitPrice: dollars(120),
        unitCost: dollars(42),
        hours: 4,
      },
    ],
  });

  // -- deposit taken and applied -------------------------------------------
  // The fleet customer paid a deposit up front against the job that is still
  // outstanding, so the finance screen has a real partly-settled invoice.
  await prisma.$transaction(async (tx) => {
    const deposit = await recordDeposit(tx, {
      organizationId: primary.org.id,
      customerId: customers[5].id,
      amount: dollars(200),
      method: "CARD_ONLINE",
      note: "Deposit toward fleet service",
      actorId: advisor.id,
    });
    // Half of it is still an unapplied liability, which is what the finance
    // screen should show as customer credit held.
    await applyDeposit(tx, {
      organizationId: primary.org.id,
      depositId: deposit.id,
      invoiceId: unpaidJob.invoice.id,
      amount: dollars(100),
      actorId: advisor.id,
    });
  });

  // A second customer holds an entirely unapplied credit.
  await prisma.$transaction((tx) =>
    recordDeposit(tx, {
      organizationId: primary.org.id,
      customerId: customers[1].id,
      amount: dollars(150),
      method: "CARD_ONLINE",
      note: "Deposit toward hybrid diagnostic",
      actorId: advisor.id,
    }),
  );

  // -- a credit note against a paid invoice --------------------------------
  await prisma.$transaction((tx) =>
    issueCreditNote(tx, {
      organizationId: primary.org.id,
      invoiceId: paidJob.invoice.id,
      amount: dollars(25),
      taxAmount: 0,
      reason: "Goodwill credit: vehicle returned for a squeak recheck",
      actorId: manager.id,
    }),
  );

  // -- expenses -------------------------------------------------------------
  const expenses = [
    ["Rent", "Tchoupitoulas Property Co", 385000, false, 20],
    ["Utilities", "Entergy New Orleans", 68400, false, 15],
    ["Shop supplies", "Gulf Coast Parts", 21250, false, 10],
    ["Insurance", "Pelican Mutual", 142000, false, 8],
    ["Tools", "Snap-on Route Truck", 47900, true, 5],
    ["Software", "Auto Shop Web App", 19900, false, 3],
    ["Waste disposal", "Delta Environmental", 12500, true, 2],
  ];
  for (const [category, vendor, amount, isCash, daysAgo] of expenses) {
    await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          organizationId: primary.org.id,
          locationId: primary.location.id,
          category: category as string,
          vendor: vendor as string,
          amount: amount as number,
          isCash: isCash as boolean,
          incurredOn: daysFromNow(-(daysAgo as number)),
          recordedById: bookkeeper.id,
        },
      });
      await postJournalEntry(tx, {
        organizationId: primary.org.id,
        memo: `Expense: ${vendor}`,
        sourceType: "expense",
        sourceId: expense.id,
        postedById: bookkeeper.id,
        entryDate: expense.incurredOn,
        lines: [
          { account: ACCOUNT_CODES.SHOP_EXPENSE, debit: amount as number },
          {
            account: isCash ? ACCOUNT_CODES.CASH_DRAWER : ACCOUNT_CODES.ACCOUNTS_PAYABLE,
            credit: amount as number,
          },
        ],
      });
    });
  }

  // -- open reconciliation exceptions --------------------------------------
  await prisma.reconciliationItem.createMany({
    data: [
      {
        organizationId: primary.org.id,
        kind: "missing_fee",
        reference: "mock_pi_seed_RO-1200",
        amount: 0,
        detail: "Processor settlement did not include a fee line for this payment.",
      },
      {
        organizationId: primary.org.id,
        kind: "payout_not_received",
        reference: "payout_2026_09_18",
        amount: dollars(1240.55),
        detail: "Processor reported a payout five days ago; nothing seen in the bank yet.",
      },
      {
        organizationId: primary.org.id,
        kind: "unknown_attempt",
        reference: "seed-timeout-demo",
        amount: dollars(318.4),
        detail:
          "Terminal request timed out. Outcome unknown; resolve before retrying on another processor.",
      },
    ],
  });

  // An attempt stuck in UNKNOWN, so the POS screen has the ambiguous case to
  // show (build guide / 13 "Ambiguous outcome").
  await prisma.paymentAttempt.create({
    data: {
      organizationId: primary.org.id,
      invoiceId: unpaidJob.invoice.id,
      provider: "mock",
      method: "CARD_TERMINAL",
      amount: dollars(318.4),
      idempotencyKey: "seed-timeout-demo",
      status: "UNKNOWN",
      externalId: "mock_pi_seed_timeout",
      failureMessage: "The processor did not answer within the timeout.",
    },
  });

  // -- second shop: a little data to prove isolation ------------------------
  const rivalCustomer = await prisma.customer.create({
    data: {
      organizationId: secondary.org.id,
      firstName: "Confidential",
      lastName: "Rival Customer",
      email: "rival@crescentcity.test",
      phone: "(504) 555-0999",
    },
  });
  const rivalVehicle = await prisma.vehicle.create({
    data: {
      organizationId: secondary.org.id,
      vin: "1N4AL3AP8JC000001",
      year: 2018,
      make: "Nissan",
      model: "Altima",
      plate: "RIV-0001",
      owners: { create: { customerId: rivalCustomer.id } },
    },
  });
  await prisma.repairOrder.create({
    data: {
      organizationId: secondary.org.id,
      locationId: secondary.location.id,
      customerId: rivalCustomer.id,
      vehicleId: rivalVehicle.id,
      number: "RO-9000",
      status: "IN_PROGRESS",
      concern: "This job must never be visible from the other shop.",
    },
  });

  // -- document counters ----------------------------------------------------
  // Estimates and repair orders above were given literal numbers, so the
  // counters have to be advanced past them or the first document the API
  // creates would collide.
  await prisma.numberSequence.createMany({
    data: [
      { organizationId: primary.org.id, kind: "estimate", prefix: "EST", nextValue: 1003 },
      { organizationId: primary.org.id, kind: "repair_order", prefix: "RO", nextValue: 1300 },
      { organizationId: secondary.org.id, kind: "repair_order", prefix: "RO", nextValue: 9001 },
    ],
    skipDuplicates: true,
  });

  await workedExampleCheck();
  await report();
}

/**
 * Serial-numbered tires and mufflers. A few products are deliberately at or
 * below their reorder point so the "reorder" reminder shows on first run.
 */
async function seedInventory(organizationId: string) {
  const products: Array<{
    kind: "TIRE" | "MUFFLER" | "OTHER";
    brand: string;
    name: string;
    size: string;
    cost: number;
    price: number;
    reorderPoint: number;
    serialPrefix: string;
    count: number;
  }> = [
    { kind: "TIRE", brand: "Michelin", name: "Defender2", size: "225/65R17", cost: 142.0, price: 219.0, reorderPoint: 4, serialPrefix: "DOTB3LLJ7Y", count: 8 },
    { kind: "TIRE", brand: "Goodyear", name: "Assurance WeatherReady", size: "215/55R17", cost: 118.5, price: 185.0, reorderPoint: 4, serialPrefix: "DOTMD1RKN", count: 3 },
    { kind: "TIRE", brand: "Cooper", name: "Endeavor", size: "205/55R16", cost: 78.0, price: 129.0, reorderPoint: 4, serialPrefix: "DOTUP8FXR", count: 12 },
    { kind: "TIRE", brand: "Economy", name: "Tire", size: "Standard Radial", cost: 28.0, price: 48.0, reorderPoint: 4, serialPrefix: "DOTE48TR", count: 10 },
    { kind: "TIRE", brand: "Firestone", name: "Destination LE3", size: "265/70R17", cost: 136.0, price: 209.0, reorderPoint: 4, serialPrefix: "DOTVN4TPL", count: 2 },

    { kind: "MUFFLER", brand: "Walker", name: "Quiet-Flow Stainless Muffler", size: '2.25" in / 2.25" out', cost: 64.0, price: 149.0, reorderPoint: 3, serialPrefix: "WK21638", count: 6 },
    { kind: "MUFFLER", brand: "Flowmaster", name: "Super 44", size: '2.5" in / 2.5" out', cost: 102.0, price: 229.0, reorderPoint: 2, serialPrefix: "FM942548", count: 1 },
    { kind: "MUFFLER", brand: "Cherry Bomb", name: "Glasspack", size: '2" in / 2" out', cost: 38.0, price: 95.0, reorderPoint: 3, serialPrefix: "CB87517", count: 5 },
    { kind: "OTHER", brand: "Walker", name: "Universal Catalytic Converter", size: '2.25"', cost: 158.0, price: 389.0, reorderPoint: 2, serialPrefix: "WKCAT1591", count: 3 },
  ];

  for (const p of products) {
    await prisma.inventoryProduct.create({
      data: {
        organizationId,
        kind: p.kind,
        brand: p.brand,
        name: p.name,
        size: p.size,
        costCents: dollars(p.cost),
        priceCents: dollars(p.price),
        reorderPoint: p.reorderPoint,
        units: {
          create: Array.from({ length: p.count }, (_, i) => ({
            organizationId,
            serialNumber: `${p.serialPrefix}${String(2400 + i * 7).padStart(4, "0")}`,
            receivedAt: daysFromNow(-20 + i),
          })),
        },
      },
    });
  }

  await prisma.bookingRequest.create({
    data: {
      organizationId,
      name: "Jasmine Boudreaux",
      phone: "(504) 555-0181",
      vehicle: "2014 Honda Accord",
      service: "Muffler / exhaust repair",
      preferredDate: daysFromNow(1, 12),
      preferredTime: "Morning",
      notes: "Loud rattle under the car when I start it.",
    },
  });
}

/**
 * The worked example from build guide page 9, posted through the real ledger
 * and then checked. If these numbers ever stop matching, the posting policy
 * has drifted.
 */
async function workedExampleCheck() {
  console.log("\nWorked finance example (build guide / 08)");
  console.log("-".repeat(60));

  const org = await prisma.organization.create({
    data: {
      name: "Worked Example Shop",
      currency: "USD",
      taxRateBps: 0,
      locations: { create: { name: "Example bay", code: "EX" } },
    },
    include: { locations: true },
  });
  await prisma.account.createMany({
    data: CHART_OF_ACCOUNTS.map((a) => ({ ...a, organizationId: org.id })),
  });

  const post = (memo: string, lines: Parameters<typeof postJournalEntry>[1]["lines"]) =>
    prisma.$transaction((tx) =>
      postJournalEntry(tx, {
        organizationId: org.id,
        memo,
        sourceType: "worked_example",
        sourceId: org.id,
        lines,
      }),
    );

  // $200 labor, $100 parts, $30 tax => $330 invoice. Fee assumed at $10.
  await post("Receive $100 deposit", [
    { account: ACCOUNT_CODES.PROCESSOR_CLEARING, debit: 10_000 },
    { account: ACCOUNT_CODES.CUSTOMER_DEPOSITS, credit: 10_000 },
  ]);
  await post("Issue invoice", [
    { account: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debit: 33_000 },
    { account: ACCOUNT_CODES.LABOR_REVENUE, credit: 20_000 },
    { account: ACCOUNT_CODES.PARTS_REVENUE, credit: 10_000 },
    { account: ACCOUNT_CODES.SALES_TAX_PAYABLE, credit: 3_000 },
  ]);
  await post("Apply deposit", [
    { account: ACCOUNT_CODES.CUSTOMER_DEPOSITS, debit: 10_000 },
    { account: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, credit: 10_000 },
  ]);
  await post("Collect remaining $230", [
    { account: ACCOUNT_CODES.PROCESSOR_CLEARING, debit: 23_000 },
    { account: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, credit: 23_000 },
  ]);
  await post("Recognise consumed costs", [
    { account: ACCOUNT_CODES.PARTS_COST, debit: 6_000 },
    { account: ACCOUNT_CODES.DIRECT_LABOR_COST, debit: 8_000 },
    { account: ACCOUNT_CODES.INVENTORY, credit: 6_000 },
    { account: ACCOUNT_CODES.LABOR_ALLOCATION, credit: 8_000 },
  ]);
  await post("Recognise processor fee", [
    { account: ACCOUNT_CODES.PROCESSING_FEES, debit: 1_000 },
    { account: ACCOUNT_CODES.PROCESSOR_CLEARING, credit: 1_000 },
  ]);
  await post("Receive confirmed payout", [
    { account: ACCOUNT_CODES.BANK, debit: 32_000 },
    { account: ACCOUNT_CODES.PROCESSOR_CLEARING, credit: 32_000 },
  ]);

  const tb = await trialBalance(prisma, org.id);
  const at = (code: string) => tb.find((r) => r.code === code)?.balance ?? 0;

  const sales = at(ACCOUNT_CODES.LABOR_REVENUE) + at(ACCOUNT_CODES.PARTS_REVENUE);
  const directCost = at(ACCOUNT_CODES.PARTS_COST) + at(ACCOUNT_CODES.DIRECT_LABOR_COST);
  const grossProfit = sales - directCost;

  const checks: Array<[string, number, number]> = [
    ["Invoice balance (AR)", at(ACCOUNT_CODES.ACCOUNTS_RECEIVABLE), 0],
    ["Deposit liability", at(ACCOUNT_CODES.CUSTOMER_DEPOSITS), 0],
    ["Tax liability", at(ACCOUNT_CODES.SALES_TAX_PAYABLE), 3_000],
    ["Sales", sales, 30_000],
    ["Direct cost", directCost, 14_000],
    ["Gross profit", grossProfit, 16_000],
    ["Processor clearing", at(ACCOUNT_CODES.PROCESSOR_CLEARING), 0],
    ["Bank", at(ACCOUNT_CODES.BANK), 32_000],
  ];

  let allPass = true;
  for (const [label, actual, expected] of checks) {
    const pass = actual === expected;
    allPass = allPass && pass;
    console.log(
      `  ${pass ? "PASS" : "FAIL"}  ${label.padEnd(24)} ${(actual / 100).toFixed(2).padStart(10)}  expected ${(expected / 100).toFixed(2)}`,
    );
  }
  const margin = ((grossProfit / sales) * 100).toFixed(2);
  console.log(`  ----  Gross margin             ${margin}%  expected 53.33%`);

  const debits = tb.reduce((s, r) => s + r.debit, 0);
  const credits = tb.reduce((s, r) => s + r.credit, 0);
  console.log(
    `  ${debits === credits ? "PASS" : "FAIL"}  Journal balances         debits ${(debits / 100).toFixed(2)} = credits ${(credits / 100).toFixed(2)}`,
  );

  if (!allPass) {
    throw new Error("The worked finance example does not reconcile. Posting policy has drifted.");
  }

  // The example shop is a check, not demo data. Remove it. Journal lines
  // protect their accounts (onDelete: Restrict), so the entries go first.
  await prisma.journalEntry.deleteMany({ where: { organizationId: org.id } });
  await prisma.organization.delete({ where: { id: org.id } });
}

async function report() {
  const [orgs, users, customers, vehicles, orders, invoices, payments] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.customer.count(),
    prisma.vehicle.count(),
    prisma.repairOrder.count(),
    prisma.invoice.count(),
    prisma.payment.count(),
  ]);

  const liveToken = await prisma.estimateVersion.findFirst({
    where: { approvalToken: { not: null } },
    include: { estimate: { include: { customer: true } } },
  });

  console.log("\nSeed complete");
  console.log("=".repeat(60));
  console.log(
    `  ${orgs} shops, ${users} users, ${customers} customers, ${vehicles} vehicles`,
  );
  console.log(`  ${orders} repair orders, ${invoices} invoices, ${payments} payments`);

  console.log("\nSign in at http://localhost:5173");
  console.log(`  Password for every demo account: ${PASSWORD}\n`);
  console.log("  mohammad@markstire.com      Owner        full access");
  console.log("  manager@markstire.test      Manager      operations, refunds under $500");
  console.log("  advisor@markstire.test      Advisor      no cost or margin data");
  console.log("  tech@markstire.test         Technician   assigned jobs only");
  console.log("  books@markstire.test        Bookkeeper   ledger and reconciliation");
  console.log("  consultant@markstire.test   Manager      belongs to BOTH shops");
  console.log("  owner@crescentcity.test     Owner        the other shop, for isolation tests");

  if (liveToken) {
    console.log("\nLive customer approval link (no login needed):");
    console.log(`  http://localhost:5173/approve/${liveToken.approvalToken}`);
    console.log(
      `  Estimate ${liveToken.estimate.number} for ${liveToken.estimate.customer.firstName} ${liveToken.estimate.customer.lastName}`,
    );
  }
  console.log("");
}

main()
  .catch((error) => {
    console.error("\nSeed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

