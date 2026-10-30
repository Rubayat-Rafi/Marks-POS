import type { Tx } from "../lib/prisma.js";
import { refreshInvoiceTotals } from "./invoicing.js";

/**
 * Safely delete all JournalEntry and JournalLine rows associated with the given source IDs,
 * handling self-referential reversal links (`reversesId`) first so MySQL foreign keys never block.
 */
export async function deleteJournalEntriesForSources(
  tx: Tx,
  organizationId: string,
  sourceIds: string[],
) {
  const uniqueIds = [...new Set(sourceIds.filter(Boolean))];
  if (uniqueIds.length === 0) return;

  const directEntries = await tx.journalEntry.findMany({
    where: { organizationId, sourceId: { in: uniqueIds } },
    select: { id: true },
  });
  const directIds = directEntries.map((e) => e.id);

  const reversalEntries =
    directIds.length > 0
      ? await tx.journalEntry.findMany({
          where: { organizationId, reversesId: { in: directIds } },
          select: { id: true },
        })
      : [];

  const allEntryIds = [...new Set([...directIds, ...reversalEntries.map((e) => e.id)])];
  if (allEntryIds.length === 0) return;

  await tx.journalEntry.updateMany({
    where: {
      organizationId,
      OR: [{ id: { in: allEntryIds } }, { reversesId: { in: allEntryIds } }],
    },
    data: { reversesId: null },
  });

  await tx.journalLine.deleteMany({
    where: { journalEntryId: { in: allEntryIds } },
  });

  await tx.journalEntry.deleteMany({
    where: { id: { in: allEntryIds } },
  });
}

/**
 * Permanently delete an invoice and clean up its payments, credit notes, deposit applications,
 * ledger entries, and restore any serialized inventory units sold on the invoice back to IN_STOCK.
 */
export async function deleteInvoiceTx(tx: Tx, organizationId: string, invoiceId: string) {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: {
      allocations: true,
      creditNotes: true,
      depositApplications: true,
      attempts: true,
    },
  });
  if (!invoice) return null;

  // 1. Restore any serialized inventory units sold on this invoice back to IN_STOCK
  await tx.inventoryUnit.updateMany({
    where: {
      organizationId,
      OR: [{ invoiceId: invoice.id }, { invoiceLine: { invoiceId: invoice.id } }],
    },
    data: {
      status: "IN_STOCK",
      soldAt: null,
      invoiceId: null,
      invoiceLineId: null,
    },
  });

  // 2. Restore customer deposits if any were applied to this invoice
  for (const app of invoice.depositApplications) {
    await tx.customerDeposit.updateMany({
      where: { id: app.depositId, organizationId },
      data: { amountApplied: { decrement: app.amount } },
    });
  }
  await tx.depositApplication.deleteMany({ where: { invoiceId: invoice.id } });

  // 3. Delete credit notes issued against this invoice
  const creditNoteIds = invoice.creditNotes.map((c) => c.id);
  if (creditNoteIds.length > 0) {
    await tx.creditNote.deleteMany({ where: { id: { in: creditNoteIds } } });
  }

  // 4. Identify payments allocated to this invoice or linked to its attempts
  const attemptIds = invoice.attempts.map((a) => a.id);
  const allocatedPaymentIds = invoice.allocations.map((a) => a.paymentId);
  const attemptPayments =
    attemptIds.length > 0
      ? await tx.payment.findMany({
          where: { organizationId, attemptId: { in: attemptIds } },
          select: { id: true },
        })
      : [];
  const candidatePaymentIds = [
    ...new Set([...allocatedPaymentIds, ...attemptPayments.map((p) => p.id)]),
  ];

  // Remove allocations to this invoice
  await tx.paymentAllocation.deleteMany({ where: { invoiceId: invoice.id } });

  // Check if any candidate payments still have allocations to other invoices
  const remainingAllocations =
    candidatePaymentIds.length > 0
      ? await tx.paymentAllocation.findMany({
          where: { paymentId: { in: candidatePaymentIds } },
          select: { paymentId: true },
        })
      : [];
  const stillAllocatedIds = new Set(remainingAllocations.map((a) => a.paymentId));
  const orphanPaymentIds = candidatePaymentIds.filter((id) => !stillAllocatedIds.has(id));

  let refundIds: string[] = [];
  if (orphanPaymentIds.length > 0) {
    const refunds = await tx.refund.findMany({
      where: { organizationId, paymentId: { in: orphanPaymentIds } },
      select: { id: true },
    });
    refundIds = refunds.map((r) => r.id);
    if (refundIds.length > 0) {
      await tx.refund.deleteMany({ where: { id: { in: refundIds } } });
    }
    await tx.payment.deleteMany({ where: { id: { in: orphanPaymentIds } } });
  }

  // Unlink any non-orphan payments from this invoice's payment attempts before deleting attempts
  if (attemptIds.length > 0) {
    await tx.payment.updateMany({
      where: { attemptId: { in: attemptIds } },
      data: { attemptId: null },
    });
    await tx.paymentAttempt.deleteMany({ where: { id: { in: attemptIds } } });
  }

  // 5. Clean up reconciliation items & journal entries
  const reconRefs = [invoice.number, ...attemptIds, ...refundIds].filter(Boolean);
  if (reconRefs.length > 0) {
    await tx.reconciliationItem.deleteMany({
      where: { organizationId, reference: { in: reconRefs } },
    });
  }

  await deleteJournalEntriesForSources(tx, organizationId, [
    invoice.id,
    ...creditNoteIds,
    ...orphanPaymentIds,
    ...refundIds,
  ]);

  // 6. Delete invoice lines and invoice
  await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
  await tx.invoice.delete({ where: { id: invoice.id } });

  return invoice;
}

/**
 * Permanently delete a payment, its refunds and ledger entries, and refresh affected invoices.
 */
export async function deletePaymentTx(tx: Tx, organizationId: string, paymentId: string) {
  const payment = await tx.payment.findFirst({
    where: { id: paymentId, organizationId },
    include: { allocations: true, refunds: true },
  });
  if (!payment) return null;

  const affectedInvoiceIds = [...new Set(payment.allocations.map((a) => a.invoiceId))];
  const refundIds = payment.refunds.map((r) => r.id);

  if (refundIds.length > 0) {
    await tx.refund.deleteMany({ where: { id: { in: refundIds } } });
  }

  await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });
  await deleteJournalEntriesForSources(tx, organizationId, [payment.id, ...refundIds]);

  await tx.payment.delete({ where: { id: payment.id } });

  if (payment.attemptId) {
    await tx.paymentAttempt.deleteMany({
      where: { id: payment.attemptId, organizationId },
    });
  }

  for (const invoiceId of affectedInvoiceIds) {
    await refreshInvoiceTotals(tx, invoiceId);
  }

  return payment;
}

/**
 * Permanently delete an estimate and all its versions, lines, and approvals.
 */
export async function deleteEstimateTx(tx: Tx, organizationId: string, estimateId: string) {
  const estimate = await tx.estimate.findFirst({
    where: { id: estimateId, organizationId },
  });
  if (!estimate) return null;

  await tx.estimateApproval.deleteMany({
    where: { estimateVersion: { estimateId: estimate.id } },
  });
  await tx.estimateLine.deleteMany({
    where: { estimateVersion: { estimateId: estimate.id } },
  });
  await tx.estimateVersion.deleteMany({
    where: { estimateId: estimate.id },
  });
  await tx.estimate.delete({
    where: { id: estimate.id },
  });

  return estimate;
}

/**
 * Permanently delete a repair order (job), restoring catalog part onHand counts,
 * deleting tasks, time entries, inspections, estimates, and job invoices.
 */
export async function deleteRepairOrderTx(
  tx: Tx,
  organizationId: string,
  repairOrderId: string,
) {
  const order = await tx.repairOrder.findFirst({
    where: { id: repairOrderId, organizationId },
    include: {
      partUsages: true,
      estimates: { select: { id: true } },
      invoices: { select: { id: true } },
    },
  });
  if (!order) return null;

  // Restore catalog onHand for non-returned parts
  for (const usage of order.partUsages) {
    if (usage.catalogItemId && !usage.returned) {
      await tx.catalogItem.updateMany({
        where: { id: usage.catalogItemId, organizationId },
        data: { onHand: { increment: usage.quantity } },
      });
    }
  }

  await tx.jobPartUsage.deleteMany({ where: { repairOrderId: order.id } });
  await tx.timeEntry.deleteMany({ where: { repairOrderId: order.id } });
  await tx.repairTask.deleteMany({ where: { repairOrderId: order.id } });
  await tx.inspectionItem.deleteMany({
    where: { inspection: { repairOrderId: order.id } },
  });
  await tx.inspection.deleteMany({ where: { repairOrderId: order.id } });

  for (const est of order.estimates) {
    await deleteEstimateTx(tx, organizationId, est.id);
  }

  for (const inv of order.invoices) {
    await deleteInvoiceTx(tx, organizationId, inv.id);
  }

  await deleteJournalEntriesForSources(tx, organizationId, [order.id]);

  await tx.repairOrder.delete({ where: { id: order.id } });
  return order;
}

/**
 * Permanently delete a vehicle and all dependent repair orders, estimates, appointments,
 * inspections, and mileage readings.
 */
export async function deleteVehicleTx(tx: Tx, organizationId: string, vehicleId: string) {
  const vehicle = await tx.vehicle.findFirst({
    where: { id: vehicleId, organizationId },
    include: {
      repairOrders: { select: { id: true } },
      estimates: { select: { id: true } },
    },
  });
  if (!vehicle) return null;

  for (const ro of vehicle.repairOrders) {
    await deleteRepairOrderTx(tx, organizationId, ro.id);
  }
  for (const est of vehicle.estimates) {
    await deleteEstimateTx(tx, organizationId, est.id);
  }

  await tx.appointment.deleteMany({ where: { vehicleId: vehicle.id, organizationId } });
  await tx.inspectionItem.deleteMany({
    where: { inspection: { vehicleId: vehicle.id, organizationId } },
  });
  await tx.inspection.deleteMany({ where: { vehicleId: vehicle.id, organizationId } });
  await tx.mileageReading.deleteMany({ where: { vehicleId: vehicle.id } });
  await tx.customerVehicle.deleteMany({ where: { vehicleId: vehicle.id } });
  await tx.vehicle.delete({ where: { id: vehicle.id } });

  return vehicle;
}

/**
 * Permanently delete a customer and all dependent invoices, payments, deposits, credit notes,
 * repair orders, estimates, appointments, and vehicles exclusively owned by this customer.
 */
export async function deleteCustomerTx(tx: Tx, organizationId: string, customerId: string) {
  const customer = await tx.customer.findFirst({
    where: { id: customerId, organizationId },
    include: {
      invoices: { select: { id: true } },
      payments: { select: { id: true } },
      creditNotes: { select: { id: true } },
      deposits: { select: { id: true } },
      repairOrders: { select: { id: true } },
      estimates: { select: { id: true } },
      vehicles: { select: { vehicleId: true } },
    },
  });
  if (!customer) return null;

  for (const inv of customer.invoices) {
    await deleteInvoiceTx(tx, organizationId, inv.id);
  }

  for (const pay of customer.payments) {
    await deletePaymentTx(tx, organizationId, pay.id);
  }

  const creditNoteIds = customer.creditNotes.map((c) => c.id);
  if (creditNoteIds.length > 0) {
    await deleteJournalEntriesForSources(tx, organizationId, creditNoteIds);
    await tx.creditNote.deleteMany({ where: { customerId: customer.id } });
  }

  const depositIds = customer.deposits.map((d) => d.id);
  if (depositIds.length > 0) {
    await tx.depositApplication.deleteMany({ where: { depositId: { in: depositIds } } });
    await deleteJournalEntriesForSources(tx, organizationId, depositIds);
    await tx.customerDeposit.deleteMany({ where: { customerId: customer.id } });
  }

  for (const ro of customer.repairOrders) {
    await deleteRepairOrderTx(tx, organizationId, ro.id);
  }

  for (const est of customer.estimates) {
    await deleteEstimateTx(tx, organizationId, est.id);
  }

  await tx.appointment.deleteMany({ where: { customerId: customer.id, organizationId } });

  // Delete vehicles exclusively owned by this customer; otherwise just unlink
  const vehicleIds = customer.vehicles.map((v) => v.vehicleId);
  await tx.customerVehicle.deleteMany({ where: { customerId: customer.id } });

  for (const vehicleId of vehicleIds) {
    const otherOwners = await tx.customerVehicle.count({ where: { vehicleId } });
    if (otherOwners === 0) {
      await deleteVehicleTx(tx, organizationId, vehicleId);
    }
  }

  await tx.customer.delete({ where: { id: customer.id } });
  return customer;
}
