import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { dateTime, money, num } from "../lib/format";
import { SHOP } from "../lib/shop";
import { useAuth } from "../lib/auth";
import { Button, DataState, Notice } from "../components/ui";
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
 * A printable receipt rendered from the invoice SNAPSHOT.
 *
 * Customer and vehicle details come from what was frozen at issuance, not from
 * the live records, so reprinting an old receipt shows what was actually
 * agreed (build guide / 04 step 6). Printing is one tap and needs nothing
 * more than being signed in: the counter prints after every job.
 */
export function ReceiptPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const [format, setFormat] = useState<Format>(savedFormat);
  const printed = useRef(false);

  const invoice = useQuery({
    queryKey: ["invoice", invoiceId],
    queryFn: () => api.get<ReceiptInvoice>(`/invoices/${invoiceId}`),
    enabled: Boolean(invoiceId),
  });

  const inv = invoice.data;

  // Opened from "Print receipt": print as soon as the receipt is on screen,
  // once, then drop the flag so a refresh does not print again.
  useEffect(() => {
    if (!inv || printed.current || params.get("print") !== "1") return;
    printed.current = true;
    const t = window.setTimeout(() => {
      window.print();
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
  // "5229 Saint Claude Ave, New Orleans, LA 70117"
  const address = inv
    ? [inv.location.addressLine1, inv.location.city, [inv.location.state, inv.location.postalCode].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <div className={`mx-auto ${thermal ? "max-w-sm" : "max-w-3xl"}`}>
      {/* The paper size for this print job. */}
      <style>{thermal ? "@page { size: 80mm auto; margin: 4mm; }" : "@page { size: letter; margin: 14mm; }"}</style>

      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Button size="lg" variant="success" onClick={() => window.print()} disabled={!inv}>
          <Icon name="printer" className="h-5 w-5" /> Print
        </Button>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1" role="group" aria-label="Paper">
          {(["letter", "thermal"] as Format[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => choose(f)}
              aria-pressed={format === f}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${format === f ? "bg-ink text-white" : "text-slate-600"}`}
            >
              {f === "letter" ? "Full page" : "Receipt printer"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          {inv && balance > 0 && inv.status !== "DRAFT" && can("payments.collect") && (
            <Link to={`/quick-sale/${inv.id}`}>
              <Button variant="secondary">Collect {money(balance)}</Button>
            </Link>
          )}
          {can("sales.quick") && (
            <Link to="/quick-sale">
              <Button variant="secondary">
                <Icon name="plus" className="h-4 w-4" /> New sale
              </Button>
            </Link>
          )}
        </div>
      </div>

      <DataState loading={invoice.isLoading} error={invoice.error}>
        {inv && (
          <article
            className={`bg-white text-ink print:shadow-none ${
              thermal
                ? "rounded-xl border border-slate-200 p-4 font-mono text-[12px] leading-snug print:border-0 print:p-0"
                : "rounded-2xl border border-slate-200 p-6 shadow-card sm:p-10 print:rounded-none print:border-0 print:p-0"
            }`}
          >
            {/* Header */}
            <header className={thermal ? "text-center" : "flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-5"}>
              <div>
                <h1 className={thermal ? "text-[15px] font-bold uppercase" : "font-display text-2xl font-extrabold"}>{shopName}</h1>
                <p className={thermal ? "" : "mt-1 text-sm text-slate-600"}>{address}</p>
                {inv.location.phone && <p className={thermal ? "" : "text-sm text-slate-600"}>{inv.location.phone}</p>}
              </div>
              <div className={thermal ? "mt-2 border-y border-dashed border-slate-400 py-1.5" : "text-right"}>
                <p className={thermal ? "font-bold" : "text-xs font-bold uppercase tracking-wide text-slate-500"}>
                  {inv.status === "PAID" ? "Paid receipt" : inv.status === "DRAFT" ? "Draft" : "Invoice"}
                </p>
                <p className={thermal ? "" : "font-mono text-xl font-bold"}>{inv.number.startsWith("DRAFT-") ? "—" : inv.number}</p>
                <p className={thermal ? "" : "text-sm text-slate-500"}>{dateTime(inv.issuedAt ?? inv.dueAt)}</p>
              </div>
            </header>

            {/* Customer and vehicle */}
            <section className={thermal ? "mt-2 space-y-0.5" : "mt-6 grid gap-6 sm:grid-cols-2"}>
              <div>
                {!thermal && <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Customer</h2>}
                {inv.billToSnapshot ? (
                  <p className={thermal ? "" : "text-sm"}>
                    {inv.billToSnapshot.companyName && (
                      <>
                        {inv.billToSnapshot.companyName}
                        <br />
                      </>
                    )}
                    {thermal && "Customer: "}
                    {inv.billToSnapshot.name}
                    {inv.billToSnapshot.phone && (
                      <>
                        <br />
                        {inv.billToSnapshot.phone}
                      </>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">Not issued yet.</p>
                )}
              </div>
              {inv.vehicleSnapshot && (
                <div>
                  {!thermal && <h2 className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">Vehicle</h2>}
                  <p className={thermal ? "" : "text-sm"}>
                    {thermal && "Vehicle: "}
                    {[inv.vehicleSnapshot.year, inv.vehicleSnapshot.make, inv.vehicleSnapshot.model].filter(Boolean).join(" ") || "—"}
                    {(inv.vehicleSnapshot.plate || inv.vehicleSnapshot.mileageIn) && (
                      <>
                        <br />
                        {inv.vehicleSnapshot.plate && `Plate ${inv.vehicleSnapshot.plate}`}
                        {inv.vehicleSnapshot.plate && inv.vehicleSnapshot.mileageIn ? " · " : ""}
                        {inv.vehicleSnapshot.mileageIn ? `${Number(inv.vehicleSnapshot.mileageIn).toLocaleString()} mi` : ""}
                      </>
                    )}
                    {inv.vehicleSnapshot.vin && (
                      <>
                        <br />
                        <span className="font-mono text-xs">VIN {inv.vehicleSnapshot.vin}</span>
                      </>
                    )}
                  </p>
                </div>
              )}
            </section>

            {/* Work and parts */}
            {thermal ? (
              <section className="mt-2 border-t border-dashed border-slate-400 pt-1.5">
                {inv.lines?.map((l) => {
                  const dept = classifyLineDepartment(l);
                  return (
                    <div key={l.id} className="py-0.5">
                      <div className="flex justify-between gap-2">
                        <span>
                          <span className="font-bold text-[10px] mr-1">
                            [{dept === "TIRE" ? "Tires" : dept === "MUFFLER" ? "Mufflers" : "General"}]
                          </span>
                          {l.description}
                        </span>
                        <span className="tabular-nums">{money(l.lineTotal)}</span>
                      </div>
                      {num(l.quantity) !== 1 && (
                        <div className="pl-2 text-slate-600">
                          {num(l.quantity)} × {money(l.unitPrice)}
                        </div>
                      )}
                      {l.inventoryUnits?.map((u) => (
                        <div key={u.id} className="pl-2 text-slate-600">
                          SN {u.serialNumber}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </section>
            ) : (
              <table className="mt-8 w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="pb-2 font-bold">Work performed &amp; parts</th>
                    <th className="pb-2 text-right font-bold">Qty</th>
                    <th className="pb-2 text-right font-bold">Price</th>
                    <th className="pb-2 text-right font-bold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inv.lines?.map((l) => {
                    const dept = classifyLineDepartment(l);
                    return (
                      <tr key={l.id} className="align-top">
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-extrabold uppercase border ${
                              dept === "TIRE"
                                ? "bg-amber-100 text-amber-900 border-amber-300"
                                : dept === "MUFFLER"
                                ? "bg-blue-100 text-blue-900 border-blue-300"
                                : "bg-slate-100 text-slate-700 border-slate-300"
                            }`}>
                              {dept === "TIRE" ? "🛞 Tires" : dept === "MUFFLER" ? "🔧 Mufflers" : "General"}
                            </span>
                            <span className="font-medium">{l.description}</span>
                            <span className="text-[10px] font-bold uppercase text-slate-400">
                              {l.lineType === "LABOR" ? "service" : l.lineType.toLowerCase()}
                            </span>
                          </div>
                          {l.inventoryUnits && l.inventoryUnits.length > 0 && (
                            <span className="mt-0.5 block font-mono text-xs text-slate-500">
                              Serial {l.inventoryUnits.map((u) => u.serialNumber).join(", ")}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">{num(l.quantity)}</td>
                        <td className="py-2.5 text-right tabular-nums">{money(l.unitPrice)}</td>
                        <td className="py-2.5 text-right tabular-nums">{money(l.lineTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {inv.notes && (
              <section className={thermal ? "mt-1.5 border-t border-dashed border-slate-400 pt-1.5" : "mt-5 rounded-xl bg-slate-50 p-4 text-sm print:bg-transparent print:p-0"}>
                <p className={thermal ? "font-bold" : "mb-1 text-xs font-bold uppercase tracking-wide text-slate-500"}>Notes</p>
                <p className="whitespace-pre-line">{inv.notes}</p>
              </section>
            )}

            {/* Totals */}
            <dl
              className={
                thermal
                  ? "mt-2 space-y-0.5 border-t border-dashed border-slate-400 pt-1.5"
                  : "ml-auto mt-6 max-w-xs space-y-1 border-t border-slate-300 pt-3 text-sm"
              }
            >
              <Line label="Subtotal" value={money(inv.subtotal)} />
              {inv.discountTotal > 0 && <Line label="Discount" value={`-${money(inv.discountTotal)}`} />}
              <Line label="Sales tax" value={money(inv.taxTotal)} />
              <Line label="Total" value={money(inv.total)} strong />
              {deptBreakdown.tires > 0 && deptBreakdown.mufflers > 0 && (
                <div className="my-1 border-t border-slate-200/80 pt-1 text-[11px] text-slate-500">
                  <div className="flex justify-between">
                    <span>🛞 Tires Items:</span>
                    <span className="tabular-nums font-semibold">{money(deptBreakdown.tires)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>🔧 Mufflers Items:</span>
                    <span className="tabular-nums font-semibold">{money(deptBreakdown.mufflers)}</span>
                  </div>
                </div>
              )}
            </dl>

            {/* Payments */}
            {(inv.allocations.length > 0 || inv.depositApplications.length > 0) && (
              <section className={thermal ? "mt-2 border-t border-dashed border-slate-400 pt-1.5" : "mt-6 border-t border-slate-200 pt-4"}>
                {!thermal && <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Payments</h2>}
                <div className={thermal ? "space-y-0.5" : "space-y-1.5 text-sm"}>
                  {inv.allocations.map((a) => (
                    <div key={a.id}>
                      <div className="flex justify-between gap-2">
                        <span className={thermal ? "" : "text-slate-600"}>
                          {METHOD_LABELS[a.payment.method] ?? a.payment.method}
                          {a.payment.reference &&
                            (a.payment.method === "CARD_EXTERNAL" && /^\d{4}$/.test(a.payment.reference)
                              ? ` •••• ${a.payment.reference}`
                              : ` (${a.payment.reference})`)}
                          {!thermal && <> · {dateTime(a.payment.receivedAt)}</>}
                        </span>
                        <span className="tabular-nums">{money(a.amount)}</span>
                      </div>
                      {a.payment.tenderedAmount !== null && a.payment.tenderedAmount > a.payment.amount && (
                        <div className={`flex justify-between gap-2 ${thermal ? "pl-2" : "pl-3 text-xs"} text-slate-500`}>
                          <span>
                            Cash {money(a.payment.tenderedAmount)} · change
                          </span>
                          <span className="tabular-nums">{money(a.payment.tenderedAmount - a.payment.amount)}</span>
                        </div>
                      )}
                    </div>
                  ))}
                  {inv.depositApplications.map((d) => (
                    <div key={d.id} className="flex justify-between gap-2">
                      <span className={thermal ? "" : "text-slate-600"}>Deposit applied</span>
                      <span className="tabular-nums">{money(d.amount)}</span>
                    </div>
                  ))}
                  {inv.creditNotes.map((c) => (
                    <div key={c.id} className="flex justify-between gap-2">
                      <span className={thermal ? "" : "text-slate-600"}>
                        Credit {c.number} · {c.reason}
                      </span>
                      <span className="tabular-nums">-{money(c.amount + c.taxAmount)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div
              className={
                thermal
                  ? "mt-2 flex justify-between border-y border-dashed border-slate-400 py-1.5 font-bold"
                  : "mt-6 flex justify-between rounded-xl bg-ink px-5 py-3 font-display text-lg font-bold text-white print:rounded-none print:border-y-2 print:border-ink print:bg-transparent print:px-0 print:text-ink"
              }
            >
              <span>{balance <= 0 ? "PAID IN FULL" : "BALANCE DUE"}</span>
              <span className="tabular-nums">{money(Math.max(balance, 0))}</span>
            </div>

            {inv.status === "DRAFT" && (
              <div className="mt-4 print:hidden">
                <Notice tone="warn">
                  This invoice is still a draft. It has no number and is not a valid receipt until it is issued.
                </Notice>
              </div>
            )}

            <footer className={thermal ? "mt-3 text-center" : "mt-8 border-t border-slate-200 pt-4 text-center text-xs text-slate-500"}>
              <p>Thank you for choosing {inv.organization.name}!</p>
              <p>Questions about this receipt? Call {inv.location.phone ?? SHOP.phone}.</p>
            </footer>
          </article>
        )}
      </DataState>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-bold text-ink" : "text-slate-600"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
