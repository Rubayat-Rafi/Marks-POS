import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { customerLabel, dateOnly, dateTime, money, parseMoney } from "../lib/format";
import { useAuth } from "../lib/auth";
import type { Invoice } from "../lib/types";
import { PageHeader } from "../components/Layout";
import {
  Button,
  Card,
  DataState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Notice,
  Select,
  StatTile,
  StatusBadge,
  Table,
} from "../components/ui";
import { Icon } from "../components/Icon";
import { PrintReportModal, type PrintReportConfig } from "../features/finance/FinancePrintReports";
import { SHOP_PALETTES } from "../lib/shopColors";

type Receivables = {
  rows: Array<{
    id: string;
    number: string;
    customer: { firstName: string; lastName: string; companyName: string | null };
    issuedAt: string | null;
    total: number;
    balance: number;
    ageDays: number;
  }>;
  buckets: { current: number; d30: number; d60: number; d90: number; over90: number };
  totalOutstanding: number;
};

type Reconciliation = {
  items: Array<{
    id: string;
    kind: string;
    reference: string;
    amount: number | null;
    detail: string;
    status: string;
    createdAt: string;
  }>;
  awaitingBankConfirmation: number;
};

type TrialBalance = {
  rows: Array<{ code: string; name: string; type: string; debit: number; credit: number; balance: number }>;
  debits: number;
  credits: number;
  balanced: boolean;
};

const TABS = [
  "daily sales",
  "receivables",
  "payments",
  "expenses",
  "cash closing",
] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  "daily sales": "Daily Sales",
  receivables: "Invoices & Receipts",
  payments: "Payments",
  expenses: "Expenses",
  "cash closing": "Cash Drawer",
};

export function FinancePage() {
  const [tab, setTab] = useState<Tab>("daily sales");
  const [printConfig, setPrintConfig] = useState<PrintReportConfig | null>(null);

  return (
    <>
      <div className="finance-screen-ui print:hidden space-y-6">
        <PageHeader
          title="Sales, Invoices & Cash"
          description="View daily sales, print or download customer invoices, and manage shop payments and expenses."
        />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
              tab === t
                ? "border-teal-600 text-teal-700 font-bold"
                : "border-transparent text-slate-500 hover:text-ink"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "receivables" && <Receivables onPrint={(cfg) => setPrintConfig(cfg)} />}
      {tab === "payments" && (
        <Payments onPrint={(payments) => setPrintConfig({ type: "PAYMENTS", title: "All Payments Register", data: payments })} />
      )}
      {tab === "cash closing" && (
        <CashClosing onPrint={(cfg) => setPrintConfig(cfg)} />
      )}
      {tab === "expenses" && (
        <Expenses onPrint={(expenses) => setPrintConfig({ type: "EXPENSES", title: "Operating Expenses Report", data: expenses })} />
      )}
      {tab === "daily sales" && (
        <DailySalesSection onPrint={(cfg) => setPrintConfig(cfg)} />
      )}
      </div>

      {printConfig && (
        <PrintReportModal config={printConfig} onClose={() => setPrintConfig(null)} autoPrint={true} />
      )}
    </>
  );
}


function downloadFinanceCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const escapeCell = (c: string | number) => {
    const str = String(c ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvContent = [
    headers.map(escapeCell).join(","),
    ...rows.map((r) => r.map(escapeCell).join(",")),
  ].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function Receivables({ onPrint }: { onPrint?: (config: any) => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<"UNPAID" | "ALL">("ALL");
  const [confirmDeleteInv, setConfirmDeleteInv] = useState<{ id: string; number: string; total: number } | null>(null);

  const deleteInvoiceMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      setConfirmDeleteInv(null);
      void queryClient.invalidateQueries({ queryKey: ["receivables"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["trial-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-closing"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });

  const receivables = useQuery({
    queryKey: ["receivables"],
    queryFn: () => api.get<Receivables>("/finance/receivables"),
  });

  const allInvoices = useQuery({
    queryKey: ["invoices", "all"],
    queryFn: () => api.get<{ data: Invoice[] }>("/invoices"),
  });

  const data = receivables.data;
  const invoicesList = allInvoices.data?.data || [];

  return (
    <DataState loading={receivables.isLoading} error={receivables.error}>
      {data && (
        <div className="space-y-5">
          {/* Main Card with View Mode Toggle */}
          <Card
            title={
              viewMode === "UNPAID"
                ? `Unpaid Invoices — ${money(data.totalOutstanding)}`
                : `All Invoices & Receipts (${invoicesList.length})`
            }
            action={
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode("ALL")}
                    className={`px-2.5 py-1 rounded-md font-bold transition ${
                      viewMode === "ALL"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    All Invoices ({invoicesList.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("UNPAID")}
                    className={`px-2.5 py-1 rounded-md font-bold transition ${
                      viewMode === "UNPAID"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Unpaid ({data.rows.length})
                  </button>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    onPrint?.({
                      type: "INVOICES",
                      title: viewMode === "UNPAID" ? "Unpaid Customer Invoices" : "All Invoices & Receipts Register",
                      data: viewMode === "UNPAID" ? data.rows : invoicesList,
                    })
                  }
                  className="gap-1.5 font-bold text-xs shadow-2xs"
                >
                  <Icon name="printer" className="h-3.5 w-3.5 text-slate-700" />
                  Print List
                </Button>
              </div>
            }
          >
            {viewMode === "UNPAID" ? (
              <DataState empty={data.rows.length === 0} emptyMessage="Nothing unpaid. All customer invoices are paid.">
                <Table headers={["Invoice", "Customer", "Issued", "Age", "Total", "Balance", ""]}>
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link to={`/receipts/${r.id}`} className="font-bold text-brand-700 hover:underline">
                          {r.number}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{customerLabel(r.customer)}</td>
                      <td className="px-3 py-2 text-slate-600">{dateOnly(r.issuedAt)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        <span className={r.ageDays > 60 ? "font-medium text-amber-700" : ""}>
                          {r.ageDays}d
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">{money(r.total)}</td>
                      <td className="px-3 py-2 font-medium tabular-nums">{money(r.balance)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            to={`/receipts/${r.id}`}
                            className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                          >
                            Receipt
                          </Link>
                          <Link
                            to={`/receipts/${r.id}?print=1`}
                            className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand-dark"
                          >
                            Print / PDF
                          </Link>
                          {can("invoices.write") && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteInv({ id: r.id, number: r.number, total: r.total })}
                              className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </DataState>
            ) : (
              <DataState empty={invoicesList.length === 0} emptyMessage="No invoices created yet.">
                <Table headers={["Invoice #", "Customer", "Status", "Issued", "Total", "Paid", "Balance", ""]}>
                  {invoicesList.map((inv) => {
                    const bal = inv.total - inv.amountPaid - inv.amountCredited;
                    const custName = inv.customer
                      ? `${inv.customer.firstName ?? ""} ${inv.customer.lastName ?? ""}`.trim() || inv.customer.companyName || "Walk-in"
                      : "Walk-in";
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/70 transition">
                        <td className="px-3 py-2 font-mono text-xs">
                          <Link to={`/receipts/${inv.id}`} className="font-bold text-brand-700 hover:underline">
                            {inv.number}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-xs font-medium text-slate-800">{custName}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-500 font-mono">{dateOnly(inv.issuedAt)}</td>
                        <td className="px-3 py-2 tabular-nums font-mono font-bold text-slate-900">{money(inv.total)}</td>
                        <td className="px-3 py-2 tabular-nums font-mono text-emerald-700 font-bold">{money(inv.amountPaid)}</td>
                        <td className="px-3 py-2 tabular-nums font-mono text-slate-600">
                          {bal > 0 ? (
                            <span className="font-bold text-amber-700">{money(bal)}</span>
                          ) : (
                            <span>$0.00</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Link
                              to={`/receipts/${inv.id}`}
                              className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                            >
                              Receipt
                            </Link>
                            <Link
                              to={`/receipts/${inv.id}?print=1`}
                              className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand-dark"
                            >
                              Print / PDF
                            </Link>
                            {can("invoices.write") && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteInv({ id: inv.id, number: inv.number, total: inv.total })}
                                className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              </DataState>
            )}
          </Card>

          {confirmDeleteInv && (
            <Modal
              title={`Delete Invoice ${confirmDeleteInv.number}?`}
              onClose={() => setConfirmDeleteInv(null)}
            >
              <div className="space-y-4">
                <ErrorBanner error={deleteInvoiceMutation.error} />
                <p className="text-sm text-slate-700">
                  Permanently delete invoice{" "}
                  <span className="font-mono font-bold text-ink">{confirmDeleteInv.number}</span> (
                  {money(confirmDeleteInv.total)})?
                </p>
                <p className="text-xs text-slate-500">
                  This permanently deletes the invoice, its payment records, and returns any serialized inventory units sold on it back to stock.
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="secondary" onClick={() => setConfirmDeleteInv(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    loading={deleteInvoiceMutation.isPending}
                    onClick={() => deleteInvoiceMutation.mutate(confirmDeleteInv.id)}
                  >
                    <Icon name="trash" className="h-4 w-4" /> Delete Invoice
                  </Button>
                </div>
              </div>
            </Modal>
          )}
        </div>
      )}
    </DataState>
  );
}

function ReconciliationQueue({ onPrint }: { onPrint?: (data: any) => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const queue = useQuery({
    queryKey: ["reconciliation"],
    queryFn: () => api.get<Reconciliation>("/finance/reconciliation"),
  });

  const resolve = useMutation({
    mutationFn: (vars: { id: string; note: string }) =>
      api.post(`/finance/reconciliation/${vars.id}/resolve`, { note: vars.note }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reconciliation"] });
      setResolving(null);
      setNote("");
    },
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => api.delete(`/finance/reconciliation/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["reconciliation"] });
    },
  });

  return (
    <DataState loading={queue.isLoading} error={queue.error}>
      <div className="space-y-4">
        <Notice>
          Processor-confirmed receipts are tracked separately from funds received in the bank.{" "}
          <strong>{queue.data?.awaitingBankConfirmation ?? 0}</strong> payment(s) are sitting in
          processor clearing and have not been confirmed at the bank.
        </Notice>

        <Card
          title="Open exceptions"
          action={
            queue.data?.items?.length ? (
              <Button variant="secondary" size="sm" onClick={() => onPrint?.(queue.data)} className="gap-1.5 font-bold text-xs shadow-xs">
                <Icon name="printer" className="h-3.5 w-3.5 text-slate-700" /> Print / Save PDF
              </Button>
            ) : undefined
          }
        >

          <DataState
            empty={(queue.data?.items.length ?? 0) === 0}
            emptyMessage="Nothing unresolved. Every payment, fee and payout is matched."
          >
            <Table headers={["Kind", "Reference", "Amount", "Detail", "Raised", ""]}>
              {queue.data?.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <StatusBadge status={item.status} />
                    <div className="mt-1 text-xs text-slate-500">
                      {item.kind.replace(/_/g, " ")}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{item.reference}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {item.amount === null ? "—" : money(item.amount)}
                  </td>
                  <td className="max-w-sm px-3 py-2 text-xs text-slate-600">{item.detail}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{dateOnly(item.createdAt)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button variant="secondary" size="sm" onClick={() => setResolving(item.id)}>
                        Resolve
                      </Button>
                      {can("finance.reconcile") && (
                        <Button
                          variant="danger"
                          size="sm"
                          loading={deleteItem.isPending}
                          onClick={() => {
                            if (window.confirm("Delete this reconciliation item?")) {
                              deleteItem.mutate(item.id);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          </DataState>
        </Card>
      </div>

      {resolving && (
        <Modal title="Resolve exception" onClose={() => setResolving(null)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              resolve.mutate({ id: resolving, note });
            }}
          >
            <ErrorBanner error={resolve.error} />
            <Field
              label="How was this resolved?"
              required
              hint="Recorded against your name. Who resolved it and why is part of the audit trail."
            >
              <Input value={note} onChange={(e) => setNote(e.target.value)} required autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setResolving(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={resolve.isPending}>
                Mark resolved
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </DataState>
  );
}

type PaymentRow = {
  id: string;
  provider: string;
  method: string;
  amount: number;
  feeAmount: number;
  amountRefunded: number;
  status: string;
  externalId: string | null;
  receivedAt: string;
  bankConfirmedAt: string | null;
  customer: { firstName: string; lastName: string };
  allocations: Array<{ id: string; amount: number; invoice: { id?: string; number: string } }>;
  refunds: Array<{ id: string; amount: number; status: string; reason: string }>;
};

/**
 * Payments, refunds and payout confirmation.
 *
 * Processor-confirmed money and bank-received money are shown as two different
 * things, because they are (build guide / 08).
 */
function Payments({ onPrint }: { onPrint?: (payments: PaymentRow[]) => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [refunding, setRefunding] = useState<PaymentRow | null>(null);
  const [confirming, setConfirming] = useState<PaymentRow | null>(null);
  const [deleting, setDeleting] = useState<PaymentRow | null>(null);

  const payments = useQuery({
    queryKey: ["payments"],
    queryFn: () => api.get<{ data: PaymentRow[] }>("/payments"),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["payments"] });
    void queryClient.invalidateQueries({ queryKey: ["receivables"] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["daily-sales-report"] });
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
    void queryClient.invalidateQueries({ queryKey: ["trial-balance"] });
    void queryClient.invalidateQueries({ queryKey: ["daily-closing"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
  };

  const deletePaymentMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/payments/${id}`),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });

  const deleteInvoiceMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });

  return (
    <>
      <Card
        title="Payments received"
        action={
          payments.data?.data?.length ? (
            <Button variant="secondary" size="sm" onClick={() => onPrint?.(payments.data.data)} className="gap-1.5 font-bold text-xs shadow-xs">
              <Icon name="printer" className="h-3.5 w-3.5 text-slate-700" /> Print / Save PDF
            </Button>
          ) : undefined
        }
      >

        <DataState
          loading={payments.isLoading}
          error={payments.error}
          empty={payments.data?.data.length === 0}
          emptyMessage="No payments recorded yet."
        >
          <Table
            headers={["Received", "Customer", "Method", "Applied to", "Amount", "Fee", "Funds", ""]}
          >
            {payments.data?.data.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {dateOnly(p.receivedAt)}
                </td>
                <td className="px-3 py-2">{customerLabel(p.customer)}</td>
                <td className="px-3 py-2 text-xs">
                  {p.method === "CASH" ? (
                    <span className="inline-flex items-center gap-1 font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                      <span>💵</span> Cash
                    </span>
                  ) : p.method === "CHECK" ? (
                    <span className="inline-flex items-center gap-1 font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                      <span>📝</span> Check
                    </span>
                  ) : p.method === "CARD_TERMINAL" ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">
                      <span>💳</span> Card (Counter Terminal)
                    </span>
                  ) : p.method === "CARD_ONLINE" ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">
                      <span>🌐</span> Card (Online Pay)
                    </span>
                  ) : (
                    <span className="font-medium text-slate-700">
                      {p.method.toLowerCase().replace("_", " ")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {p.allocations.map((a) => a.invoice.number).join(", ") || "unapplied"}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {money(p.amount)}
                  {p.amountRefunded > 0 && (
                    <span className="block text-xs text-red-600">
                      -{money(p.amountRefunded)} refunded
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-600">
                  {p.feeAmount > 0 ? money(p.feeAmount) : "—"}
                </td>
                <td className="px-3 py-2">
                  {p.method === "CASH" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/60">
                      ✓ In Cash Drawer
                    </span>
                  ) : p.method === "CHECK" ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                      ✓ Check in hand
                    </span>
                  ) : p.provider === "manual" ? (
                    <span className="text-xs text-slate-500">at the counter</span>
                  ) : p.bankConfirmedAt ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200/60">
                      ✓ In the bank
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60">
                      Card processor clearing
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {can("finance.reconcile") &&
                      p.provider !== "manual" &&
                      p.method !== "CASH" &&
                      p.method !== "CHECK" &&
                      !p.bankConfirmedAt && (
                        <Button variant="secondary" size="sm" onClick={() => setConfirming(p)}>
                          Confirm card payout
                        </Button>
                      )}
                    {can("payments.refund") && p.amountRefunded < p.amount && (
                      <Button variant="secondary" size="sm" onClick={() => setRefunding(p)}>
                        Refund
                      </Button>
                    )}
                    {can("payments.collect") && (
                      <Button variant="danger" size="sm" onClick={() => setDeleting(p)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </DataState>
      </Card>

      {refunding && (
        <RefundModal
          payment={refunding}
          onClose={() => setRefunding(null)}
          onDone={() => {
            refresh();
            setRefunding(null);
          }}
        />
      )}
      {confirming && (
        <ConfirmPayoutModal
          payment={confirming}
          onClose={() => setConfirming(null)}
          onDone={() => {
            refresh();
            setConfirming(null);
          }}
        />
      )}
      {deleting && (
        <Modal title="Delete Payment or Entire Sale?" onClose={() => setDeleting(null)}>
          <div className="space-y-4">
            <ErrorBanner error={deletePaymentMutation.error || deleteInvoiceMutation.error} />
            <p className="text-sm text-slate-700">
              Payment of <span className="font-semibold text-slate-900">{money(deleting.amount)}</span> from{" "}
              <span className="font-semibold text-slate-900">{customerLabel(deleting.customer)}</span>
              {deleting.allocations.length > 0 && (
                <> (applied to invoice {deleting.allocations.map((a) => a.invoice.number).join(", ")})</>
              )}.
            </p>

            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 space-y-1.5">
              <p className="font-bold">What would you like to delete?</p>
              <ul className="list-disc list-inside space-y-1 text-amber-800">
                <li>
                  <strong>Delete Entire Invoice & Payment:</strong> Completely wipes the invoice and payment from all sales reports, Invoices & Receipts, and returns any sold tires/parts back to stock.
                </li>
                <li>
                  <strong>Delete Payment Only:</strong> Removes just this payment receipt. The invoice remains active in Invoices & Receipts and Reports as an unpaid invoice.
                </li>
              </ul>
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                loading={deletePaymentMutation.isPending}
                onClick={() => deletePaymentMutation.mutate(deleting.id)}
                className="text-xs"
              >
                Delete Payment Only
              </Button>
              {deleting.allocations.length > 0 && deleting.allocations[0]?.invoice?.id && (
                <Button
                  variant="danger"
                  loading={deleteInvoiceMutation.isPending}
                  onClick={() => deleteInvoiceMutation.mutate(deleting.allocations[0].invoice.id!)}
                  className="text-xs font-bold"
                >
                  <Icon name="trash" className="h-4 w-4" /> Delete Entire Invoice & Payment
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function RefundModal({
  payment,
  onClose,
  onDone,
}: {
  payment: PaymentRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { can } = useAuth();
  const refundable = payment.amount - payment.amountRefunded;
  const [amount, setAmount] = useState((refundable / 100).toFixed(2));
  const [reason, setReason] = useState("");

  // One key per intended refund, fixed when the form opens.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const refund = useMutation({
    mutationFn: () =>
      api.post(`/payments/${payment.id}/refunds`, {
        amount: parseMoney(amount) ?? 0,
        reason,
        idempotencyKey,
      }),
    onSuccess: onDone,
  });

  const cents = parseMoney(amount) ?? 0;
  // Mirrors the server's escalation rule so the operator is not surprised.
  const needsOwner = cents > 50_000;
  const blocked = needsOwner && !can("payments.refund.large");

  return (
    <Modal title="Refund payment" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          refund.mutate();
        }}
      >
        <ErrorBanner error={refund.error} />

        <Notice>
          A refund moves money back through the original provider. It does not reduce the sale. If
          the invoice itself should shrink, issue a credit note as well.
        </Notice>

        <Field label="Amount" required hint={`Up to ${money(refundable)} can still be refunded.`}>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="tabular-nums"
            required
          />
        </Field>

        <Field label="Reason" required hint="Recorded in the audit trail against your name.">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>

        {blocked && (
          <Notice tone="danger">
            A refund above {money(50_000)} needs an owner. Ask an owner to complete this one.
          </Notice>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={refund.isPending}
            disabled={blocked || cents <= 0 || cents > refundable || reason.trim().length < 3}
          >
            Refund {money(cents)}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmPayoutModal({
  payment,
  onClose,
  onDone,
}: {
  payment: PaymentRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reference, setReference] = useState("");
  const net = payment.amount - payment.feeAmount;

  const confirm = useMutation({
    mutationFn: () =>
      api.post(`/finance/payments/${payment.id}/confirm-bank`, { reference }),
    onSuccess: onDone,
  });

  return (
    <Modal title="Confirm funds received" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          confirm.mutate();
        }}
      >
        <ErrorBanner error={confirm.error} />

        <Notice>
          With no bank feed in this release, an operator confirms the money arrived. This moves{" "}
          {money(net)} from processor clearing to the bank. It is a transfer, not a second sale.
        </Notice>

        <dl className="space-y-1 rounded border border-slate-200 p-3 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Gross</dt>
            <dd className="tabular-nums">{money(payment.amount)}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>Processor fee</dt>
            <dd className="tabular-nums">-{money(payment.feeAmount)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>Expected in the bank</dt>
            <dd className="tabular-nums">{money(net)}</dd>
          </div>
        </dl>

        <Field label="Bank reference" required hint="The statement line or payout id you matched.">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} required />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={confirm.isPending} disabled={!reference.trim()}>
            Confirm receipt
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type CashSession = {
  id: string;
  openingFloat: number;
  countedTotal: number | null;
  expectedTotal: number | null;
  variance: number | null;
  openedAt: string;
  closedAt: string | null;
  note: string | null;
  openedBy: { firstName: string; lastName: string };
  location: { name: string };
};

/**
 * Daily cash closing: opening cash + receipts - refunds - cash expenses,
 * compared with the counted drawer (build guide / 07).
 */
function CashClosing({ onPrint }: { onPrint?: (cfg: PrintReportConfig) => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [openingFloat, setOpeningFloat] = useState("200.00");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [closingDate, setClosingDate] = useState(() => new Date().toISOString().slice(0, 10));

  const sessions = useQuery({
    queryKey: ["cash-sessions"],
    queryFn: () => api.get<{ data: CashSession[]; open: CashSession | null }>("/finance/cash-sessions"),
  });

  const dailyClosing = useQuery({
    queryKey: ["daily-closing", closingDate],
    queryFn: () => api.get<any>(`/finance/daily-closing?date=${closingDate}`),
    refetchInterval: 30_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["cash-sessions"] });
    void queryClient.invalidateQueries({ queryKey: ["daily-closing"] });
  };

  const open = useMutation({
    mutationFn: () =>
      api.post("/finance/cash-sessions", { openingFloat: parseMoney(openingFloat) ?? 0 }),
    onSuccess: refresh,
  });

  const close = useMutation({
    mutationFn: (id: string) =>
      api.post(`/finance/cash-sessions/${id}/close`, {
        countedTotal: parseMoney(counted) ?? 0,
        note: note || undefined,
      }),
    onSuccess: () => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["reconciliation"] });
      setCounted("");
      setNote("");
    },
  });

  const deleteSession = useMutation({
    mutationFn: (id: string) => api.delete(`/finance/cash-sessions/${id}`),
    onSuccess: refresh,
  });

  const current = sessions.data?.open ?? null;
  const closingData = dailyClosing.data;
  const tireClosing = closingData?.tireShop;
  const mufflerClosing = closingData?.mufflersShop;

  return (
    <DataState loading={sessions.isLoading} error={sessions.error}>
      <div className="space-y-5">
        {/* End-of-Day Department Closing Accounts & Print Actions */}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">End-of-Day Closing Accounts</h2>
              <p className="text-xs text-slate-500">
                Separate end-of-day sales, collections, and closing accounts for Tire Shop and Mufflers Shop.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
                className="h-9 rounded-lg border border-slate-300 px-3 py-1 font-mono text-xs text-slate-700 focus:border-brand-500 focus:outline-none"
                aria-label="Closing Date"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  onPrint?.({
                    type: "CASH_CLOSING_TIRE",
                    title: "Tire Shop End-of-Day Closing Account",
                    data: closingData,
                    dateRange: { date: closingDate },
                  })
                }
                className="gap-1.5 font-bold text-xs"
              >
                <Icon name="printer" className="h-4 w-4 text-emerald-700" /> Print Tires Closing (PDF)
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  onPrint?.({
                    type: "CASH_CLOSING_MUFFLER",
                    title: "Mufflers Shop End-of-Day Closing Account",
                    data: closingData,
                    dateRange: { date: closingDate },
                  })
                }
                className="gap-1.5 font-bold text-xs"
              >
                <Icon name="printer" className="h-4 w-4 text-orange-700" /> Print Mufflers Closing (PDF)
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  onPrint?.({
                    type: "CASH_CLOSING_OVERALL",
                    title: "Consolidated Daily Cash Closing",
                    data: closingData,
                    dateRange: { date: closingDate },
                  })
                }
                className="gap-1.5 font-bold text-xs"
              >
                <Icon name="printer" className="h-4 w-4 text-slate-700" /> Print Combined Closing (PDF)
              </Button>
            </div>
          </div>

          {/* Department Breakdown Cards */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {/* Tire Shop Closing Account */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
              <div className="flex items-center justify-between border-b border-blue-200 pb-2">
                <span className="font-bold text-sm text-blue-950 flex items-center gap-1.5">
                  <Icon name="tag" className="h-4 w-4 text-blue-700" /> Tire Shop Closing Account
                </span>
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800">
                  {tireClosing?.transactionsCount ?? 0} Transactions
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white p-2.5 shadow-2xs border border-blue-100">
                  <span className="text-slate-500 block">Cash Collected</span>
                  <span className="font-bold font-mono text-sm text-emerald-700">{money(tireClosing?.cashReceipts)}</span>
                </div>
                <div className="rounded-lg bg-white p-2.5 shadow-2xs border border-blue-100">
                  <span className="text-slate-500 block">Card / Electronic</span>
                  <span className="font-bold font-mono text-sm text-blue-700">{money(tireClosing?.cardReceipts)}</span>
                </div>
                <div className="rounded-lg bg-white p-2.5 shadow-2xs border border-blue-100">
                  <span className="text-slate-500 block">Check / Other</span>
                  <span className="font-bold font-mono text-sm text-slate-700">{money(tireClosing?.checkReceipts)}</span>
                </div>
                <div className="rounded-lg bg-white p-2.5 shadow-2xs border border-blue-100">
                  <span className="text-slate-500 block">Tax Liability</span>
                  <span className="font-bold font-mono text-sm text-amber-700">{money(tireClosing?.taxCollected)}</span>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-blue-200 pt-2 text-xs font-semibold">
                <span className="text-blue-900">Tire Net Closing Balance:</span>
                <span className="font-mono text-sm font-bold text-blue-950">{money(tireClosing?.closingCashBalance)}</span>
              </div>
            </div>

            {/* Mufflers Shop Closing Account */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
              <div className="flex items-center justify-between border-b border-amber-200 pb-2">
                <span className="font-bold text-sm text-amber-950 flex items-center gap-1.5">
                  <Icon name="wrench" className="h-4 w-4 text-amber-700" /> Mufflers Shop Closing Account
                </span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                  {mufflerClosing?.transactionsCount ?? 0} Transactions
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-white p-2.5 shadow-2xs border border-amber-100">
                  <span className="text-slate-500 block">Cash Collected</span>
                  <span className="font-bold font-mono text-sm text-emerald-700">{money(mufflerClosing?.cashReceipts)}</span>
                </div>
                <div className="rounded-lg bg-white p-2.5 shadow-2xs border border-amber-100">
                  <span className="text-slate-500 block">Card / Electronic</span>
                  <span className="font-bold font-mono text-sm text-blue-700">{money(mufflerClosing?.cardReceipts)}</span>
                </div>
                <div className="rounded-lg bg-white p-2.5 shadow-2xs border border-amber-100">
                  <span className="text-slate-500 block">Check / Other</span>
                  <span className="font-bold font-mono text-sm text-slate-700">{money(mufflerClosing?.checkReceipts)}</span>
                </div>
                <div className="rounded-lg bg-white p-2.5 shadow-2xs border border-amber-100">
                  <span className="text-slate-500 block">Tax Liability</span>
                  <span className="font-bold font-mono text-sm text-amber-700">{money(mufflerClosing?.taxCollected)}</span>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-amber-200 pt-2 text-xs font-semibold">
                <span className="text-amber-900">Mufflers Net Closing Balance:</span>
                <span className="font-mono text-sm font-bold text-amber-950">{money(mufflerClosing?.closingCashBalance)}</span>
              </div>
            </div>
          </div>
        </Card>

        <Card title={current ? "Open drawer" : "Open the drawer"}>
          <ErrorBanner error={open.error} />
          <ErrorBanner error={close.error} />

          {current ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatTile label="Opening float" value={money(current.openingFloat)} />
                <StatTile
                  label="Opened"
                  value={dateOnly(current.openedAt)}
                  sub={`by ${current.openedBy.firstName} ${current.openedBy.lastName}`}
                />
                <StatTile label="Location" value={current.location.name} />
              </div>

              {can("finance.reconcile") && (
                <form
                  className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    close.mutate(current.id);
                  }}
                >

                  <Field
                    label="Counted cash in the drawer"
                    required
                    hint="Count first, then enter. The expected figure is calculated server-side so it cannot be talked into matching."
                  >
                    <Input
                      value={counted}
                      onChange={(e) => setCounted(e.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="tabular-nums text-lg"
                      required
                    />
                  </Field>
                  <Field label="Note">
                    <Input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Anything unusual about today"
                    />
                  </Field>
                  <Button type="submit" loading={close.isPending} disabled={!counted}>
                    Close the drawer
                  </Button>
                </form>
              )}
            </div>
          ) : (
            can("finance.reconcile") && (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  open.mutate();
                }}
              >
                <Field label="Opening float" required>
                  <Input
                    value={openingFloat}
                    onChange={(e) => setOpeningFloat(e.target.value)}
                    inputMode="decimal"
                    className="tabular-nums"
                  />
                </Field>
                <Button type="submit" loading={open.isPending}>
                  Open drawer
                </Button>
              </form>
            )
          )}
        </Card>

        <Card title="Closing history">
          <DataState
            empty={(sessions.data?.data.filter((s) => s.closedAt).length ?? 0) === 0}
            emptyMessage="No closed sessions yet."
          >
            <Table
              headers={["Opened", "Closed", "Float", "Expected", "Counted", "Variance", "Note", ""]}
            >
              {sessions.data?.data
                .filter((s) => s.closedAt)
                .map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2 text-slate-600">{dateOnly(s.openedAt)}</td>
                    <td className="px-3 py-2 text-slate-600">{dateOnly(s.closedAt)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {money(s.openingFloat)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">
                      {money(s.expectedTotal)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{money(s.countedTotal)}</td>
                    <td
                      className={`px-3 py-2 tabular-nums font-medium ${
                        (s.variance ?? 0) === 0 ? "text-slate-500" : "text-amber-700"
                      }`}
                    >
                      {money(s.variance)}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2 text-xs text-slate-500">
                      {s.note ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {can("finance.reconcile") && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm("Delete this cash session record?")) {
                              deleteSession.mutate(s.id);
                            }
                          }}
                          className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </Table>
          </DataState>
        </Card>
      </div>
    </DataState>
  );
}

function Expenses({ onPrint }: { onPrint?: (expenses: any[]) => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    category: "Shop supplies",
    vendor: "",
    amount: "",
    isCash: false,
  });

  const expenses = useQuery({
    queryKey: ["expenses"],
    queryFn: () =>
      api.get<{
        data: Array<{
          id: string;
          category: string;
          vendor: string;
          amount: number;
          isCash: boolean;
          incurredOn: string;
        }>;
      }>("/finance/expenses"),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post("/finance/expenses", {
        category: form.category,
        vendor: form.vendor,
        amount: parseMoney(form.amount) ?? 0,
        isCash: form.isCash,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setAdding(false);
      setForm({ category: "Shop supplies", vendor: "", amount: "", isCash: false });
    },
  });

  const deleteExpense = useMutation({
    mutationFn: (id: string) => api.delete(`/finance/expenses/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      void queryClient.invalidateQueries({ queryKey: ["trial-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-closing"] });
    },
  });

  return (
    <>
      <Card
        title="Expenses"
        action={
          <div className="flex items-center gap-2">
            {expenses.data?.data?.length ? (
              <Button variant="secondary" size="sm" onClick={() => onPrint?.(expenses.data.data)} className="gap-1.5 font-bold text-xs shadow-xs">
                <Icon name="printer" className="h-3.5 w-3.5 text-slate-700" /> Print / Save PDF
              </Button>
            ) : null}
            {can("expenses.write") && (
              <Button variant="secondary" onClick={() => setAdding(true)}>
                Record expense
              </Button>
            )}
          </div>
        }
      >
        <DataState
          loading={expenses.isLoading}
          error={expenses.error}
          empty={expenses.data?.data.length === 0}
          emptyMessage="No expenses recorded."
        >
          <Table headers={["Date", "Category", "Vendor", "Paid from", "Amount", ""]}>
            {expenses.data?.data.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 text-slate-600">{dateOnly(e.incurredOn)}</td>
                <td className="px-3 py-2">{e.category}</td>
                <td className="px-3 py-2 text-slate-600">{e.vendor}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {e.isCash ? "Cash drawer" : "Accounts payable"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(e.amount)}</td>
                <td className="px-3 py-2 text-right">
                  {can("expenses.write") && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete expense "${e.vendor}" (${money(e.amount)})?`)) {
                          deleteExpense.mutate(e.id);
                        }
                      }}
                      className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </DataState>
      </Card>

      {adding && (
        <Modal title="Record expense" onClose={() => setAdding(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <ErrorBanner error={create.error} />
            <Field label="Category" required>
              <Select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {["Shop supplies", "Rent", "Utilities", "Insurance", "Tools", "Software", "Waste disposal", "Other"].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </Select>
            </Field>
            <Field label="Vendor" required>
              <Input
                value={form.vendor}
                onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
                required
              />
            </Field>
            <Field label="Amount" required>
              <Input
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                inputMode="decimal"
                placeholder="0.00"
                required
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isCash}
                onChange={(e) => setForm((f) => ({ ...f, isCash: e.target.checked }))}
              />
              Paid from the cash drawer (affects daily cash closing)
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={create.isPending}>
                Record expense
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function Ledger({ onPrint }: { onPrint?: (tb: TrialBalance) => void }) {
  const tb = useQuery({
    queryKey: ["trial-balance"],
    queryFn: () => api.get<TrialBalance>("/finance/trial-balance"),
  });

  return (
    <DataState loading={tb.isLoading} error={tb.error}>
      {tb.data && (
        <Card
          title="Trial balance"
          action={
            <Button variant="secondary" size="sm" onClick={() => onPrint?.(tb.data)} className="gap-1.5 font-bold text-xs shadow-xs">
              <Icon name="printer" className="h-3.5 w-3.5 text-slate-700" /> Print / Save PDF
            </Button>
          }
        >
          {!tb.data.balanced && (
            <div className="mb-3">
              <Notice tone="danger">
                Debits and credits do not match. Stop and investigate before trusting any report on
                this page.
              </Notice>
            </div>
          )}

          <Table headers={["Code", "Account", "Type", "Debit", "Credit", "Balance"]}>
            {tb.data.rows
              .filter((r) => r.debit !== 0 || r.credit !== 0)
              .map((r) => (
                <tr key={r.code}>
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{r.type.toLowerCase()}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{money(r.debit)}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-600">{money(r.credit)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {money(r.balance)}
                  </td>
                </tr>
              ))}
          </Table>

          <div className="mt-3 flex justify-end gap-6 border-t border-slate-200 pt-3 text-sm font-semibold">
            <span>Debits {money(tb.data.debits)}</span>
            <span>Credits {money(tb.data.credits)}</span>
            <span className={tb.data.balanced ? "text-teal-700" : "text-red-600"}>
              {tb.data.balanced ? "Balanced" : "Out of balance"}
            </span>
          </div>
        </Card>
      )}
    </DataState>
  );
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalStartIso(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return new Date().toISOString();
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function toLocalEndIso(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return new Date().toISOString();
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).toISOString();
}

function DailySalesSection({ onPrint }: { onPrint?: (cfg: PrintReportConfig) => void }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [departmentView, setDepartmentView] = useState<"ALL" | "TIRE" | "MUFFLER">("ALL");
  const [activePreset, setActivePreset] = useState<number | "all" | "custom">(0);
  const [from, setFrom] = useState(() => toLocalDateStr(new Date()));
  const [to, setTo] = useState(() => toLocalDateStr(new Date()));
  const [confirmDeleteInv, setConfirmDeleteInv] = useState<{ id: string; number: string; total: number } | null>(null);

  const deleteInvoiceMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      setConfirmDeleteInv(null);
      void queryClient.invalidateQueries({ queryKey: ["daily-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["receivables"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["trial-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-closing"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });

  const fromIso = useMemo(() => toLocalStartIso(from), [from]);
  const toIso = useMemo(() => toLocalEndIso(to), [to]);

  const salesQuery = useQuery({
    queryKey: ["daily-sales-report", fromIso, toIso],
    queryFn: () =>
      api.get<any>(`/reports/daily-sales?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`),
  });

  const setRangePreset = (days: number | "all") => {
    setActivePreset(days);
    const now = new Date();
    const todayStr = toLocalDateStr(now);
    if (days === "all") {
      setFrom("2020-01-01");
      setTo(todayStr);
    } else if (days === 0) {
      setFrom(todayStr);
      setTo(todayStr);
    } else if (days === 1) {
      const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const yestStr = toLocalDateStr(yest);
      setFrom(yestStr);
      setTo(yestStr);
    } else {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
      setFrom(toLocalDateStr(start));
      setTo(todayStr);
    }
  };

  const data = salesQuery.data;
  const tireShop = data?.tireShop;
  const mufflersShop = data?.mufflersShop;
  const overallTotals = data?.totals;

  return (
    <div className="space-y-5">
      {/* Date controls and Print Action Header */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                { label: "Today", days: 0 },
                { label: "Yesterday", days: 1 },
                { label: "Last 7 Days", days: 7 },
                { label: "Last 30 Days", days: 30 },
                { label: "All Sales", days: "all" },
              ] as const
            ).map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setRangePreset(p.days)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  activePreset === p.days
                    ? "bg-ink text-white shadow-2xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}

            <div className="ml-2 flex items-center gap-1.5 font-mono text-xs">
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  setActivePreset("custom");
                  setFrom(val);
                  if (val > to) setTo(val);
                }}
                className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                aria-label="Start Date"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  setActivePreset("custom");
                  setTo(val);
                  if (val < from) setFrom(val);
                }}
                className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                aria-label="End Date"
              />
            </div>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              onPrint?.({
                type: "DAILY_SALES_ALL",
                title: "Daily Sales Report",
                data,
                dateRange: { from, to },
              })
            }
          >
            <Icon name="printer" className="h-4 w-4" /> Print Daily Sales (PDF)
          </Button>
        </div>
      </Card>

      {/* Active Shop Banner — shown when a specific department is selected */}
      {departmentView !== "ALL" && (
        <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${SHOP_PALETTES[departmentView].bannerClass}`}>
          <Icon
            name={departmentView === "TIRE" ? "tire" : "pipe"}
            className={`h-4 w-4 shrink-0 ${SHOP_PALETTES[departmentView].textAccentClass}`}
          />
          <div className="flex-1">
            <span className="font-bold text-sm">
              {departmentView === "TIRE" ? "Tires Shop" : "Mufflers Shop"}
            </span>
            <span className="ml-2 text-xs opacity-75">
              Showing only {departmentView === "TIRE" ? "tire shop" : "mufflers shop"} invoices and sales — excludes other department revenue
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDepartmentView("ALL")}
            className="shrink-0 rounded-lg border border-current/20 bg-white/40 px-2.5 py-1 text-xs font-bold opacity-80 hover:opacity-100 transition"
          >
            View all departments
          </button>
        </div>
      )}

      <DataState loading={salesQuery.isLoading} error={salesQuery.error}>
        {/* Department-Specific or Overall View */}
        {departmentView === "ALL" && (
          <div className="space-y-5">
            {/* Top Summaries — Combined */}
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-xs">
              <div className="mb-3 flex items-center gap-2">
                <Icon name="store" className="h-4 w-4 text-indigo-600" />
                <span className="font-bold text-indigo-900 text-sm">All Shops — Combined Totals</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-lg bg-white border border-indigo-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Cash Collected</span>
                  <span className="font-bold font-mono text-lg text-emerald-800">
                    {overallTotals?.cashCollected !== null && overallTotals?.cashCollected !== undefined
                      ? money(overallTotals.cashCollected)
                      : "—"}
                  </span>
                  <span className="text-[10px] text-slate-400 block">{overallTotals?.paymentsCount ?? 0} payments (Cash Basis)</span>
                </div>
                <div className="rounded-lg bg-white border border-indigo-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Gross Invoiced</span>
                  <span className="font-bold font-mono text-lg text-indigo-950">{money(overallTotals?.gross ?? 0)}</span>
                  <span className="text-[10px] text-slate-400 block">{overallTotals?.count ?? 0} tickets (Accrual)</span>
                </div>
                <div className="rounded-lg bg-white border border-indigo-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Total Net Sales</span>
                  <span className="font-bold font-mono text-lg text-indigo-900">{money(overallTotals?.net ?? 0)}</span>
                  <span className="text-[10px] text-slate-400 block">Excludes sales tax</span>
                </div>
                <div className="rounded-lg bg-white border border-indigo-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Sales Tax Tracked</span>
                  <span className="font-bold font-mono text-lg text-indigo-700">{money(overallTotals?.tax ?? 0)}</span>
                  <span className="text-[10px] text-slate-400 block">Remittance liability</span>
                </div>
                <div className="rounded-lg bg-white border border-indigo-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Total Invoices</span>
                  <span className="font-bold font-mono text-lg text-indigo-900">{overallTotals?.count ?? 0}</span>
                  <span className="text-[10px] text-slate-400 block">{from} to {to}</span>
                </div>
              </div>
            </div>

            {/* Department Comparison Cards */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Tire Shop card */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-emerald-200 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
                      <Icon name="tire" className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="font-bold text-emerald-950">Tire Shop</h3>
                      <p className="text-xs text-emerald-700">Tires, mount/balance, repairs &amp; hardware</p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      onPrint?.({
                        type: "DAILY_SALES_TIRE",
                        title: "Tire Shop Daily Sales Report",
                        data,
                        dateRange: { from, to },
                      })
                    }
                  >
                    <Icon name="printer" className="h-3.5 w-3.5 text-emerald-700" /> Print
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg bg-white p-3 border border-emerald-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Cash Collected</span>
                    <span className="font-bold font-mono text-base text-emerald-800">
                      {tireShop?.totals?.cashCollected !== null && tireShop?.totals?.cashCollected !== undefined
                        ? money(tireShop.totals.cashCollected)
                        : "—"}
                    </span>
                  </div>
                  <div className="rounded-lg bg-white p-3 border border-emerald-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Gross Invoiced</span>
                    <span className="font-bold font-mono text-base text-emerald-950">{money(tireShop?.totals?.gross ?? 0)}</span>
                  </div>
                  <div className="rounded-lg bg-white p-3 border border-emerald-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Net Sales</span>
                    <span className="font-bold font-mono text-base text-slate-700">{money(tireShop?.totals?.net ?? 0)}</span>
                  </div>
                  <div className="rounded-lg bg-white p-3 border border-emerald-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Sales Tax</span>
                    <span className="font-bold font-mono text-base text-emerald-700">{money(tireShop?.totals?.tax ?? 0)}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-emerald-900">
                  <span className="font-semibold">{tireShop?.totals?.invoiceCount ?? 0} Invoices</span>
                  <span>{tireShop?.totals?.lineCount ?? 0} Itemized Services</span>
                </div>
              </div>

              {/* Mufflers Shop card */}
              <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-orange-200 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-600 text-white">
                      <Icon name="pipe" className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="font-bold text-orange-950">Mufflers Shop</h3>
                      <p className="text-xs text-orange-700">Mufflers, exhausts, pipes, catalytic &amp; welding</p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      onPrint?.({
                        type: "DAILY_SALES_MUFFLER",
                        title: "Mufflers Shop Daily Sales Report",
                        data,
                        dateRange: { from, to },
                      })
                    }
                  >
                    <Icon name="printer" className="h-3.5 w-3.5 text-orange-700" /> Print
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg bg-white p-3 border border-orange-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Cash Collected</span>
                    <span className="font-bold font-mono text-base text-orange-800">
                      {mufflersShop?.totals?.cashCollected !== null && mufflersShop?.totals?.cashCollected !== undefined
                        ? money(mufflersShop.totals.cashCollected)
                        : "—"}
                    </span>
                  </div>
                  <div className="rounded-lg bg-white p-3 border border-orange-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Gross Invoiced</span>
                    <span className="font-bold font-mono text-base text-orange-950">{money(mufflersShop?.totals?.gross ?? 0)}</span>
                  </div>
                  <div className="rounded-lg bg-white p-3 border border-orange-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Net Sales</span>
                    <span className="font-bold font-mono text-base text-slate-700">{money(mufflersShop?.totals?.net ?? 0)}</span>
                  </div>
                  <div className="rounded-lg bg-white p-3 border border-orange-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Sales Tax</span>
                    <span className="font-bold font-mono text-base text-orange-700">{money(mufflersShop?.totals?.tax ?? 0)}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-orange-900">
                  <span className="font-semibold">{mufflersShop?.totals?.invoiceCount ?? 0} Invoices</span>
                  <span>{mufflersShop?.totals?.lineCount ?? 0} Itemized Services</span>
                </div>
              </div>
            </div>

            {/* Consolidated Invoices List */}
            {data?.invoices && data.invoices.length > 0 && (
              <Card title={`All Shops — Invoices & Receipts (${data.invoices.length})`}>
                <Table headers={["Invoice #", "Customer", "Date", "Items & Services", "Total", ""]}>
                  {data.invoices.map((inv: any) => (
                    <tr key={inv.id}>
                      <td className="px-3 py-2">
                        <Link to={`/receipts/${inv.id}`} className="font-mono text-xs text-brand-700 font-bold hover:underline">
                          {inv.number}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-800 font-medium">{inv.customer}</td>
                      <td className="px-3 py-2 text-slate-500 text-xs font-mono">{dateOnly(inv.issuedAt)}</td>
                      <td className="px-3 py-2 text-xs text-slate-600 max-w-[260px] truncate">
                        {inv.lines?.map((l: any) => `${l.quantity}x ${l.description}`).join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-slate-900">
                        {money(inv.total)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link to={`/receipts/${inv.id}`} className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                            Receipt
                          </Link>
                          <Link to={`/receipts/${inv.id}?print=1`} className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand-dark">
                            Print / PDF
                          </Link>
                          {can("invoices.write") && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteInv({ id: inv.id, number: inv.number, total: inv.total })}
                              className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}
          </div>
        )}

        {departmentView === "TIRE" && (
          <div className="space-y-5">
            {/* Tire Shop banner */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-xs">
              <div className="mb-3 flex items-center gap-2">
                <Icon name="tire" className="h-4 w-4 text-emerald-700" />
                <span className="font-bold text-emerald-900 text-sm">Tire Shop — Sales Detail</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-lg bg-white border border-emerald-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Cash Collected</span>
                  <span className="font-bold font-mono text-lg text-emerald-800">
                    {tireShop?.totals?.cashCollected !== null && tireShop?.totals?.cashCollected !== undefined
                      ? money(tireShop.totals.cashCollected)
                      : "—"}
                  </span>
                  <span className="text-[10px] text-slate-400 block">{tireShop?.totals?.paymentsCount ?? 0} payments</span>
                </div>
                <div className="rounded-lg bg-white border border-emerald-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Total Sales</span>
                  <span className="font-bold font-mono text-lg text-emerald-950">{money(tireShop?.totals?.gross ?? 0)}</span>
                </div>
                <div className="rounded-lg bg-white border border-emerald-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Before Tax</span>
                  <span className="font-bold font-mono text-lg text-emerald-900">{money(tireShop?.totals?.net ?? 0)}</span>
                </div>
                <div className="rounded-lg bg-white border border-emerald-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Sales Tax</span>
                  <span className="font-bold font-mono text-lg text-emerald-700">{money(tireShop?.totals?.tax ?? 0)}</span>
                </div>
                <div className="rounded-lg bg-white border border-emerald-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Invoices</span>
                  <span className="font-bold font-mono text-lg text-emerald-900">{tireShop?.totals?.invoiceCount ?? 0}</span>
                </div>
              </div>
            </div>

            {/* Tire Invoices Register */}
            <Card
              title="Tire Shop Invoices & Receipts"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    onPrint?.({
                      type: "DAILY_SALES_TIRE",
                      title: "Tire Shop Daily Sales Report",
                      data,
                      dateRange: { from, to },
                    })
                  }
                >
                  <Icon name="printer" className="h-4 w-4 text-blue-600" /> Print Tire Report
                </Button>
              }
            >
              <Table headers={["Date", "Invoice #", "Customer", "Tire Services", "Net", "Tax", "Total", ""]}>
                {tireShop?.invoices?.map((inv: any) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2 text-xs text-slate-600">{dateOnly(inv.issuedAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs font-bold text-emerald-700">
                      <Link to={`/receipts/${inv.id}`} className="hover:underline">
                        {inv.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-sm">{inv.customer}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">
                      {inv.lines.map((l: any) => `${l.quantity}x ${l.description}`).join(", ")}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{money(inv.net)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{money(inv.tax)}</td>
                    <td className="px-3 py-2 tabular-nums font-bold text-slate-900">{money(inv.total)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link to={`/receipts/${inv.id}`} className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                          Receipt
                        </Link>
                        <Link to={`/receipts/${inv.id}?print=1`} className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand-dark">
                          Print / PDF
                        </Link>
                        {can("invoices.write") && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteInv({ id: inv.id, number: inv.number, total: inv.total })}
                            className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        )}

        {departmentView === "MUFFLER" && (
          <div className="space-y-5">
            {/* Mufflers Shop banner */}
            <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-4 shadow-xs">
              <div className="mb-3 flex items-center gap-2">
                <Icon name="pipe" className="h-4 w-4 text-orange-700" />
                <span className="font-bold text-orange-900 text-sm">Mufflers Shop — Sales Detail</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-lg bg-white border border-orange-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Cash Collected</span>
                  <span className="font-bold font-mono text-lg text-orange-800">
                    {mufflersShop?.totals?.cashCollected !== null && mufflersShop?.totals?.cashCollected !== undefined
                      ? money(mufflersShop.totals.cashCollected)
                      : "—"}
                  </span>
                  <span className="text-[10px] text-slate-400 block">{mufflersShop?.totals?.paymentsCount ?? 0} payments</span>
                </div>
                <div className="rounded-lg bg-white border border-orange-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Total Sales</span>
                  <span className="font-bold font-mono text-lg text-orange-950">{money(mufflersShop?.totals?.gross ?? 0)}</span>
                </div>
                <div className="rounded-lg bg-white border border-orange-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Before Tax</span>
                  <span className="font-bold font-mono text-lg text-orange-900">{money(mufflersShop?.totals?.net ?? 0)}</span>
                </div>
                <div className="rounded-lg bg-white border border-orange-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Sales Tax</span>
                  <span className="font-bold font-mono text-lg text-orange-700">{money(mufflersShop?.totals?.tax ?? 0)}</span>
                </div>
                <div className="rounded-lg bg-white border border-orange-100 p-3">
                  <span className="text-[11px] font-medium text-slate-500 block">Invoices</span>
                  <span className="font-bold font-mono text-lg text-orange-900">{mufflersShop?.totals?.invoiceCount ?? 0}</span>
                </div>
              </div>
            </div>

            {/* Mufflers Invoices Register */}
            <Card
              title="Mufflers Shop Invoices & Receipts"
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    onPrint?.({
                      type: "DAILY_SALES_MUFFLER",
                      title: "Mufflers Shop Daily Sales Report",
                      data,
                      dateRange: { from, to },
                    })
                  }
                >
                  <Icon name="printer" className="h-4 w-4 text-amber-600" /> Print Muffler Report
                </Button>
              }
            >
              <Table headers={["Date", "Invoice #", "Customer", "Muffler Services", "Net", "Tax", "Total", ""]}>
                {mufflersShop?.invoices?.map((inv: any) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2 text-xs text-slate-600">{dateOnly(inv.issuedAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs font-bold text-amber-800">
                      <Link to={`/receipts/${inv.id}`} className="hover:underline">
                        {inv.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-sm">{inv.customer}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">
                      {inv.lines.map((l: any) => `${l.quantity}x ${l.description}`).join(", ")}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{money(inv.net)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{money(inv.tax)}</td>
                    <td className="px-3 py-2 tabular-nums font-bold text-slate-900">{money(inv.total)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link to={`/receipts/${inv.id}`} className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                          Receipt
                        </Link>
                        <Link to={`/receipts/${inv.id}?print=1`} className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand-dark">
                          Print / PDF
                        </Link>
                        {can("invoices.write") && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteInv({ id: inv.id, number: inv.number, total: inv.total })}
                            className="rounded bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        )}
      </DataState>

      {confirmDeleteInv && (
        <Modal
          title={`Delete Invoice ${confirmDeleteInv.number}?`}
          onClose={() => setConfirmDeleteInv(null)}
        >
          <div className="space-y-4">
            <ErrorBanner error={deleteInvoiceMutation.error} />
            <p className="text-sm text-slate-700">
              Permanently delete invoice{" "}
              <span className="font-mono font-bold text-ink">{confirmDeleteInv.number}</span> (
              {money(confirmDeleteInv.total)})?
            </p>
            <p className="text-xs text-slate-500">
              This permanently removes the invoice, its payment records, and returns any serialized inventory units sold on it back to stock.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setConfirmDeleteInv(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleteInvoiceMutation.isPending}
                onClick={() => deleteInvoiceMutation.mutate(confirmDeleteInv.id)}
              >
                <Icon name="trash" className="h-4 w-4" /> Delete Invoice
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
