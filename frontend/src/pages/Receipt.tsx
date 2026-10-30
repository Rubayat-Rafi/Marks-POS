import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { dateTime, money, num } from "../lib/format";
import { SHOP } from "../lib/shop";
import { useAuth } from "../lib/auth";
import { Button, DataState, ErrorBanner, Modal, Notice } from "../components/ui";
import { Icon } from "../components/Icon";
import { METHOD_LABELS } from "./Pos";
import { classifyLineDepartment } from "../lib/shopDepartment";
import type { Invoice } from "../lib/types";

type ReceiptInvoice = Omit<Invoice, "creditNotes"> & {
  notes: string | null;
  billToSnapshot: Record<string, string | null> | null;
  vehicleSnapshot: Record<string, string | number | null> | null;
  organization: { name: string; legalName: string | null };
  location: {
    name: string;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    phone: string | null;
  };
  allocations: Array<{
    id: string;
    amount: number;
    payment: {
      method: string;
      provider: string;
      receivedAt: string;
      externalId: string | null;
      reference: string | null;
      tenderedAmount: number | null;
      amount: number;
    };
  }>;
  depositApplications: Array<{ id: string; amount: number; createdAt: string }>;
  creditNotes: Array<{ id: string; number: string; amount: number; taxAmount: number; reason: string }>;
};

type Format = "letter" | "thermal";

function savedFormat(): Format {
  try {
    return localStorage.getItem("receipt.format") === "thermal" ? "thermal" : "letter";
  } catch {
    return "letter";
  }
}

/**
 * Clean, single-page printable & downloadable invoice/receipt.
 * Uses `@page { margin: 0mm }` with internal padding so browser URL headers
 * (`http://localhost...`) and page numbers never clutter the printed receipt.
 */
export function ReceiptPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const [format, setFormat] = useState<Format>(savedFormat);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteInvoiceMutation = useMutation({
    mutationFn: () => api.delete(`/invoices/${invoiceId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["receivables"] });
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["trial-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-closing"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      navigate("/reports");
    },
  });
  const printed = useRef(false);

  const invoice = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => api.get<ReceiptInvoice>(`/invoices/${invoiceId}`),
    enabled: Boolean(invoiceId),
  });

  const inv = invoice.data;

  function triggerPrint() {
    if (!inv) return;
    const prevTitle = document.title;
    document.title = `Invoice-${inv.number}`;
    window.print();
    window.setTimeout(() => {
      document.title = prevTitle;
    }, 500);
  }

  // Opened from "Print / Download receipt": print as soon as the receipt is on screen,
  // once, then drop the flag so a refresh does not print again.
  useEffect(() => {
    if (!inv || printed.current || params.get("print") !== "1") return;
    printed.current = true;
    const t = window.setTimeout(() => {
      const prevTitle = document.title;
      document.title = `Invoice-${inv.number}`;
      window.print();
      window.setTimeout(() => {
        document.title = prevTitle;
      }, 500);
      params.delete("print");
      setParams(params, { replace: true });
    }, 250);
    return () => window.clearTimeout(t);
  }, [inv, params, setParams]);

  function choose(f: Format) {
    setFormat(f);
    try {
      localStorage.setItem("receipt.format", f);
    } catch {
      /* per-device preference only */
    }
  }

  const balance = inv ? inv.total - inv.amountPaid - inv.amountCredited : 0;
  const deptBreakdown = useMemo(() => {
    if (!inv?.lines) return { tires: 0, mufflers: 0 };
    let tires = 0;
    let mufflers = 0;
    for (const l of inv.lines) {
      const dept = classifyLineDepartment(l);
      if (dept === "TIRE") tires += l.lineTotal;
      else if (dept === "MUFFLER") mufflers += l.lineTotal;
    }
    return { tires, mufflers };
  }, [inv?.lines]);
  const thermal = format === "thermal";
  const shopName = inv?.organization.legalName || inv?.organization.name || SHOP.legalName;
  const address = inv
    ? [inv.location.addressLine1, inv.location.city, [inv.location.state, inv.location.postalCode].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <div className={`mx-auto ${thermal ? "max-w-sm" : "max-w-3xl"}`}>
      {/* Clean print rules: margin 0mm hides browser URL & date headers */}
      <style>{`
        ${thermal ? "@page { size: 80mm auto; margin: 3mm; }" : "@page { size: letter portrait; margin: 0mm; }"}
        @media print {
          html, body {
            background: #ffffff !important;
            color: #0f172a !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          aside, header.sticky, nav, .print\\:hidden {
            display: none !important;
          }
          #printable-receipt-sheet {
            padding: ${thermal ? "2mm" : "12mm 14mm"} !important;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
        }
      `}</style>

      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Button size="lg" variant="success" onClick={triggerPrint} disabled={!inv}>
          <Icon name="printer" className="h-5 w-5" /> Print Receipt
        </Button>
        <Button size="lg" variant="primary" onClick={triggerPrint} disabled={!inv}>
          <Icon name="download" className="h-5 w-5" /> Download Invoice (PDF)
        </Button>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1" role="group" aria-label="Paper">
          {(["letter", "thermal"] as Format[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => choose(f)}
              aria-pressed={format === f}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold ${format === f ? "bg-ink text-white" : "text-slate-600"}`}
            >
              {f === "letter" ? "Standard Page" : "80mm Thermal"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link to="/reports">
            <Button variant="secondary">Daily Sales</Button>
          </Link>
          {inv && balance > 0 && inv.status !== "DRAFT" && can("payments.collect") && (
            <Link to={`/quick-sale/${inv.id}`}>
              <Button variant="secondary">Collect {money(balance)}</Button>
            </Link>
          )}
          {can("sales.quick") && (
            <Link to="/quick-sale">
              <Button variant="secondary">
                <Icon name="plus" className="h-4 w-4" /> New Sale
              </Button>
            </Link>
          )}
          {inv && can("invoices.write") && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      <DataState loading={invoice.isLoading} error={invoice.error}>
        {inv && (
          <article
            id="printable-receipt-sheet"
            className={`bg-white text-ink print:shadow-none ${
              thermal
                ? "rounded-xl border border-slate-200 p-4 font-mono text-[12px] leading-snug"
                : "rounded-2xl border border-slate-200 p-6 shadow-card sm:p-8"
            }`}
          >
            {/* Header */}
            <header className={thermal ? "text-center" : "flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4"}>
              <div>
                <h1 className={thermal ? "text-[15px] font-bold uppercase" : "font-display text-2xl font-extrabold"}>{shopName}</h1>
                <p className={thermal ? "" : "mt-0.5 text-sm text-slate-600"}>{address}</p>
                {inv.location.phone && <p className={thermal ? "" : "text-sm font-medium text-slate-600"}>{inv.location.phone}</p>}
              </div>
              <div className={thermal ? "mt-2 border-y border-dashed border-slate-400 py-1.5" : "text-right"}>
                <span
                  className={
                    thermal
                      ? "font-bold uppercase"
                      : `inline-block rounded-md px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wider ${
                          balance <= 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                        }`
                  }
                >
                  {balance <= 0 ? "PAID RECEIPT" : inv.status === "DRAFT" ? "DRAFT" : "INVOICE"}
                </span>
                <p className={thermal ? "mt-0.5 font-bold" : "mt-1 font-mono text-xl font-black text-ink"}>
                  {inv.number.startsWith("DRAFT-") ? "DRAFT" : inv.number}
                </p>
                <p className={thermal ? "" : "text-xs text-slate-500"}>{dateTime(inv.issuedAt ?? inv.dueAt)}</p>
              </div>
            </header>

            {/* Customer and vehicle */}
            <section className={thermal ? "mt-2 space-y-0.5" : "mt-4 grid gap-4 rounded-xl bg-slate-50 p-3.5 sm:grid-cols-2"}>
              <div>
                {!thermal && <h2 className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Customer</h2>}
                {inv.billToSnapshot ? (
                  <p className={thermal ? "" : "text-sm font-semibold text-ink"}>
                    {inv.billToSnapshot.companyName && (
                      <>
                        {inv.billToSnapshot.companyName}
                        <br />
                      </>
                    )}
                    {thermal && "Customer: "}
                    {inv.billToSnapshot.name}
                    {inv.billToSnapshot.phone && (
                      <span className="block font-normal text-slate-600">{inv.billToSnapshot.phone}</span>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">Walk-in Customer</p>
                )}
              </div>
              {inv.vehicleSnapshot && (
                <div>
                  {!thermal && <h2 className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Vehicle</h2>}
                  <p className={thermal ? "" : "text-sm font-semibold text-ink"}>
                    {thermal && "Vehicle: "}
                    {[inv.vehicleSnapshot.year, inv.vehicleSnapshot.make, inv.vehicleSnapshot.model].filter(Boolean).join(" ") || "—"}
                    {(inv.vehicleSnapshot.plate || inv.vehicleSnapshot.mileageIn) && (
                      <span className="block font-normal text-slate-600">
                        {inv.vehicleSnapshot.plate && `Plate ${inv.vehicleSnapshot.plate}`}
                        {inv.vehicleSnapshot.plate && inv.vehicleSnapshot.mileageIn ? " · " : ""}
                        {inv.vehicleSnapshot.mileageIn ? `${Number(inv.vehicleSnapshot.mileageIn).toLocaleString()} mi` : ""}
                      </span>
                    )}
                  </p>
                </div>
              )}
            </section>

            {/* Items & Services */}
            {thermal ? (
              <section className="mt-2 border-t border-dashed border-slate-400 pt-1.5">
                {inv.lines?.map((l) => (
                  <div key={l.id} className="py-0.5">
                    <div className="flex justify-between gap-2">
                      <span>{l.description}</span>
                      <span className="tabular-nums font-semibold">{money(l.lineTotal)}</span>
                    </div>
                    {num(l.quantity) !== 1 && (
                      <div className="pl-2 text-slate-600">
                        {num(l.quantity)} × {money(l.unitPrice)}
                      </div>
                    )}
                  </div>
                ))}
              </section>
            ) : (
              <table className="mt-5 w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 font-bold">Item / Service</th>
                    <th className="pb-2 text-right font-bold">Qty</th>
                    <th className="pb-2 text-right font-bold">Price</th>
                    <th className="pb-2 text-right font-bold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inv.lines?.map((l) => {
                    const dept = classifyLineDepartment(l);
                    return (
                      <tr key={l.id} className="align-top">
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                dept === "TIRE"
                                  ? "bg-amber-100 text-amber-900"
                                  : dept === "MUFFLER"
                                  ? "bg-blue-100 text-blue-900"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {dept === "TIRE" ? "Tires" : dept === "MUFFLER" ? "Mufflers" : "Service"}
                            </span>
                            <span className="font-semibold text-ink">{l.description}</span>
                          </div>
                          {l.inventoryUnits && l.inventoryUnits.length > 0 && (
                            <span className="mt-0.5 block font-mono text-xs text-slate-500">
                              SN: {l.inventoryUnits.map((u) => u.serialNumber).join(", ")}
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">{num(l.quantity)}</td>
                        <td className="py-2 text-right tabular-nums">{money(l.unitPrice)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{money(l.lineTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {inv.notes && (
              <section className={thermal ? "mt-1.5 border-t border-dashed border-slate-400 pt-1.5" : "mt-4 rounded-lg bg-slate-50 p-3 text-xs"}>
                <span className="font-bold uppercase text-slate-500">Note: </span>
                <span>{inv.notes}</span>
              </section>
            )}

            {/* Totals & Payments */}
            <div className={thermal ? "mt-2 border-t border-dashed border-slate-400 pt-1.5" : "mt-5 grid gap-6 border-t-2 border-slate-200 pt-4 sm:grid-cols-2"}>
              {/* Left side: Payment method summary */}
              <div>
                {(inv.allocations.length > 0 || inv.depositApplications.length > 0) && (
                  <div className={thermal ? "mb-2 space-y-0.5" : "space-y-1 text-xs"}>
                    {!thermal && <p className="font-bold uppercase tracking-wide text-slate-500">Payment Received</p>}
                    {inv.allocations.map((a) => (
                      <div key={a.id} className="flex justify-between gap-2 text-slate-700">
                        <span>
                          {METHOD_LABELS[a.payment.method] ?? a.payment.method}
                          {a.payment.reference ? ` (${a.payment.reference})` : ""}
                        </span>
                        <span className="font-semibold tabular-nums">{money(a.amount)}</span>
                      </div>
                    ))}
                    {inv.depositApplications.map((d) => (
                      <div key={d.id} className="flex justify-between gap-2 text-slate-700">
                        <span>Deposit applied</span>
                        <span className="font-semibold tabular-nums">{money(d.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right side: Subtotal / Tax / Total */}
              <dl className={thermal ? "space-y-0.5" : "space-y-1 text-sm"}>
                <Line label="Subtotal" value={money(inv.subtotal)} />
                {inv.discountTotal > 0 && <Line label="Discount" value={`-${money(inv.discountTotal)}`} />}
                <Line label="Sales Tax" value={money(inv.taxTotal)} />
                <Line label="Total" value={money(inv.total)} strong />
                {deptBreakdown.tires > 0 && deptBreakdown.mufflers > 0 && (
                  <div className="pt-1 text-xs text-slate-500">
                    <div className="flex justify-between">
                      <span>Tires Shop:</span>
                      <span className="tabular-nums">{money(deptBreakdown.tires)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Mufflers Shop:</span>
                      <span className="tabular-nums">{money(deptBreakdown.mufflers)}</span>
                    </div>
                  </div>
                )}
              </dl>
            </div>

            <div
              className={
                thermal
                  ? "mt-2 flex justify-between border-y border-dashed border-slate-400 py-1.5 font-bold"
                  : "mt-4 flex justify-between rounded-xl bg-slate-900 px-4 py-2.5 font-display text-base font-bold text-white"
              }
            >
              <span>{balance <= 0 ? "PAID IN FULL" : "BALANCE DUE"}</span>
              <span className="tabular-nums">{balance <= 0 ? money(inv.total) : money(Math.max(balance, 0))}</span>
            </div>

            {inv.status === "DRAFT" && (
              <div className="mt-4 print:hidden">
                <Notice tone="warn">
                  This invoice is still a draft. Issue it first to make it an official receipt.
                </Notice>
              </div>
            )}

            <footer className={thermal ? "mt-3 text-center" : "mt-5 border-t border-slate-200 pt-3 text-center text-xs text-slate-500"}>
              <p className="font-semibold text-slate-700">Thank you for choosing {inv.organization.name}!</p>
              <p>Questions? Call {inv.location.phone ?? SHOP.phone}</p>
            </footer>
          </article>
        )}
      </DataState>

      {confirmDelete && inv && (
        <Modal title={`Delete Invoice ${inv.number}?`} onClose={() => setConfirmDelete(false)}>
          <div className="space-y-4">
            <ErrorBanner error={deleteInvoiceMutation.error} />
            <p className="text-sm text-slate-700">
              Are you sure you want to permanently delete invoice{" "}
              <span className="font-mono font-bold text-ink">{inv.number}</span> ({money(inv.total)})?
            </p>
            <p className="text-xs text-slate-500">
              This will permanently remove the invoice, its associated payment and accounting entries,
              and return any serialized tires or mufflers sold on this invoice back to stock.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleteInvoiceMutation.isPending}
                onClick={() => deleteInvoiceMutation.mutate()}
              >
                <Icon name="trash" className="h-4 w-4" /> Permanently Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-slate-200 pt-1 text-base font-extrabold text-ink" : "text-slate-600"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
