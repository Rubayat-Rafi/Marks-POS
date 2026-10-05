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
  "receivables",
  "payments",
  "cash closing",
  "reconciliation",
  "expenses",
  "ledger",
  "daily sales",
] as const;
type Tab = (typeof TABS)[number];

export function FinancePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>("receivables");
  const [printConfig, setPrintConfig] = useState<PrintReportConfig | null>(null);

  return (
    <>
      <PageHeader
        title="Finance"
        description="An operational subledger for job and payment reporting. It is not a general ledger, a tax return or an audited statement."
      />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize transition ${
              tab === t
                ? "border-teal-600 text-teal-700 font-bold"
                : "border-transparent text-slate-500 hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "receivables" && <Receivables />}
      {tab === "payments" && (
        <Payments onPrint={(payments) => setPrintConfig({ type: "PAYMENTS", title: "All Payments Register", data: payments })} />
      )}
      {tab === "cash closing" && (
        <CashClosing onPrint={(cfg) => setPrintConfig(cfg)} />
      )}
      {tab === "reconciliation" && can("finance.reconcile") && (
        <ReconciliationQueue onPrint={(data) => setPrintConfig({ type: "RECONCILIATION", title: "Reconciliation & Exceptions Report", data })} />
      )}
      {tab === "reconciliation" && !can("finance.reconcile") && (
        <Notice tone="warn">Your role cannot open the reconciliation queue.</Notice>
      )}
      {tab === "expenses" && (
        <Expenses onPrint={(expenses) => setPrintConfig({ type: "EXPENSES", title: "Operating Expenses Report", data: expenses })} />
      )}
      {tab === "ledger" && (
        <Ledger onPrint={(tb) => setPrintConfig({ type: "LEDGER", title: "General Ledger Trial Balance", data: tb })} />
      )}
      {tab === "daily sales" && (
        <DailySalesSection onPrint={(cfg) => setPrintConfig(cfg)} />
      )}

      {printConfig && (
        <PrintReportModal config={printConfig} onClose={() => setPrintConfig(null)} />
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

function Receivables() {
  const [viewMode, setViewMode] = useState<"UNPAID" | "ALL">("UNPAID");

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
  const totalSettledRevenue = invoicesList.reduce((s, inv) => s + (inv.amountPaid || 0), 0);

  const handleExportCsv = () => {
    if (viewMode === "UNPAID") {
      const headers = ["Invoice #", "Customer", "Issued Date", "Age (Days)", "Total ($)", "Balance Due ($)"];
      const rows = (data?.rows || []).map((r) => [
        r.number,
        customerLabel(r.customer),
        dateOnly(r.issuedAt),
        r.ageDays,
        (r.total / 100).toFixed(2),
        (r.balance / 100).toFixed(2),
      ]);
      downloadFinanceCsv(`outstanding-receivables_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    } else {
      const headers = ["Invoice #", "Customer", "Status", "Issued Date", "Total ($)", "Paid ($)", "Balance Due ($)"];
      const rows = invoicesList.map((inv) => {
        const bal = inv.total - inv.amountPaid - inv.amountCredited;
        const custName = inv.customer
          ? `${inv.customer.firstName ?? ""} ${inv.customer.lastName ?? ""}`.trim() || inv.customer.companyName || "—"
          : "—";
        return [
          inv.number,
          custName,
          inv.status,
          dateOnly(inv.issuedAt),
          (inv.total / 100).toFixed(2),
          (inv.amountPaid / 100).toFixed(2),
          (bal / 100).toFixed(2),
        ];
      });
      downloadFinanceCsv(`all-invoices-register_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    }
  };

  return (
    <DataState loading={receivables.isLoading} error={receivables.error}>
      {data && (
        <div className="space-y-5">
          {/* Aging Buckets */}
          <div className="grid gap-4 sm:grid-cols-5">
            <StatTile label="Current (0-30d)" value={money(data.buckets.current)} />
            <StatTile label="31-60 days" value={money(data.buckets.d30)} />
            <StatTile label="61-90 days" value={money(data.buckets.d60)} tone="warn" />
            <StatTile label="91-120 days" value={money(data.buckets.d90)} tone="warn" />
            <StatTile label="Over 120 days" value={money(data.buckets.over90)} tone="warn" />
          </div>

          {/* Educational clarification banner when nothing is outstanding */}
          {data.rows.length === 0 && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-xs">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 text-base font-bold shadow-2xs">
                  ✓
                </span>
                <div className="text-xs space-y-1">
                  <h4 className="font-bold text-emerald-950 text-sm">
                    All Customer Invoices Are 100% Settled ($0.00 Outstanding)
                  </h4>
                  <p className="text-emerald-800 leading-relaxed">
                    <strong>Why does this show $0.00?</strong> Accounts Receivable (AR Aging) tracks{" "}
                    <strong>unpaid customer credit</strong> and overdue debts. Because every invoice created at your
                    shop was paid directly at checkout, there are currently <strong>0 unpaid invoices</strong> (
                    <strong className="text-emerald-950">{money(totalSettledRevenue)}</strong> total collected across{" "}
                    {invoicesList.length} sales).
                  </p>
                  <p className="text-emerald-700">
                    If a customer selects <em>"Pay Later"</em> on the register or a Work Order is invoiced without
                    immediate payment, it will immediately appear here with its age and balance due.
                  </p>
                  <div className="pt-1.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setViewMode("ALL")}
                      className="font-bold text-emerald-900 underline hover:text-emerald-950 cursor-pointer"
                    >
                      View All Settled Invoices ({invoicesList.length}) →
                    </button>
                    <span className="text-emerald-400">·</span>
                    <Link
                      to="/reports"
                      className="font-bold text-emerald-900 underline hover:text-emerald-950"
                    >
                      View Revenue Reports & Daily Sales →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main Card with View Mode Toggle */}
          <Card
            title={
              viewMode === "UNPAID"
                ? `Outstanding Invoices — ${money(data.totalOutstanding)}`
                : `All Invoices & Payment Register (${invoicesList.length} Invoices)`
            }
            action={
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs">
                  <button
                    type="button"
                    onClick={() => setViewMode("UNPAID")}
                    className={`px-2.5 py-1 rounded-md font-bold transition ${
                      viewMode === "UNPAID"
                        ? "bg-white text-slate-900 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Unpaid Only ({data.rows.length})
                  </button>
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
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleExportCsv}
                  className="text-xs gap-1 font-bold border-slate-300"
                  title="Download table data as CSV"
                >
                  <Icon name="tag" className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Download CSV</span>
                </Button>
              </div>
            }
          >
            {viewMode === "UNPAID" ? (
              <DataState empty={data.rows.length === 0} emptyMessage="Nothing outstanding. All customer invoices are settled.">
                <Table headers={["Invoice", "Customer", "Issued", "Age", "Total", "Balance"]}>
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
                          <Link
                            to={`/receipts/${inv.id}`}
                            className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                          >
                            Receipt
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
              </DataState>
            )}
          </Card>
        </div>
      )}
    </DataState>
  );
}

function ReconciliationQueue({ onPrint }: { onPrint?: (data: any) => void }) {
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
              <Button variant="secondary" size="sm" onClick={() => onPrint?.(queue.data)}>
                <Icon name="printer" className="h-4 w-4" /> Print Reconciliation
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
                    <Button variant="secondary" onClick={() => setResolving(item.id)}>
                      Resolve
                    </Button>
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
  allocations: Array<{ id: string; amount: number; invoice: { number: string } }>;
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

  const payments = useQuery({
    queryKey: ["payments"],
    queryFn: () => api.get<{ data: PaymentRow[] }>("/payments"),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["payments"] });
    void queryClient.invalidateQueries({ queryKey: ["receivables"] });
    void queryClient.invalidateQueries({ queryKey: ["trial-balance"] });
  };

  return (
    <>
      <Card
        title="Payments received"
        action={
          payments.data?.data?.length ? (
            <Button variant="secondary" size="sm" onClick={() => onPrint?.(payments.data.data)}>
              <Icon name="printer" className="h-4 w-4" /> Print All Payments
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
                <td className="px-3 py-2 text-xs text-slate-600">
                  {p.method.toLowerCase().replace("_", " ")}
                  <span className="ml-1 text-slate-400">({p.provider})</span>
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
                  {p.provider === "manual" ? (
                    <span className="text-xs text-slate-500">at the counter</span>
                  ) : p.bankConfirmedAt ? (
                    <span className="text-xs font-medium text-teal-700">in the bank</span>
                  ) : (
                    <span className="text-xs font-medium text-amber-700">
                      processor clearing
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    {can("finance.reconcile") &&
                      p.provider !== "manual" &&
                      !p.bankConfirmedAt && (
                        <Button variant="secondary" onClick={() => setConfirming(p)}>
                          Confirm payout
                        </Button>
                      )}
                    {can("payments.refund") && p.amountRefunded < p.amount && (
                      <Button variant="secondary" onClick={() => setRefunding(p)}>
                        Refund
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
              >
                <Icon name="printer" className="h-4 w-4 text-blue-600" /> Print Tire Shop Closing
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
              >
                <Icon name="printer" className="h-4 w-4 text-amber-600" /> Print Mufflers Shop Closing
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
              >
                <Icon name="printer" className="h-4 w-4 text-slate-700" /> Print Drawer Closing
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
              headers={["Opened", "Closed", "Float", "Expected", "Counted", "Variance", "Note"]}
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

  return (
    <>
      <Card
        title="Expenses"
        action={
          <div className="flex items-center gap-2">
            {expenses.data?.data?.length ? (
              <Button variant="secondary" size="sm" onClick={() => onPrint?.(expenses.data.data)}>
                <Icon name="printer" className="h-4 w-4" /> Print Expenses
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
          <Table headers={["Date", "Category", "Vendor", "Paid from", "Amount"]}>
            {expenses.data?.data.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2 text-slate-600">{dateOnly(e.incurredOn)}</td>
                <td className="px-3 py-2">{e.category}</td>
                <td className="px-3 py-2 text-slate-600">{e.vendor}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {e.isCash ? "Cash drawer" : "Accounts payable"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{money(e.amount)}</td>
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
            <Button variant="secondary" size="sm" onClick={() => onPrint?.(tb.data)}>
              <Icon name="printer" className="h-4 w-4" /> Print Ledger / Trial Balance
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

function DailySalesSection({ onPrint }: { onPrint?: (cfg: PrintReportConfig) => void }) {
  const [departmentView, setDepartmentView] = useState<"ALL" | "TIRE" | "MUFFLER">("ALL");
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const salesQuery = useQuery({
    queryKey: ["daily-sales-report", from, to],
    queryFn: () => api.get<any>(`/reports/daily-sales?from=${from}&to=${to}`),
  });

  const setRangePreset = (days: number) => {
    const now = new Date();
    const endStr = now.toISOString().slice(0, 10);
    const start = new Date();
    if (days === 0) {
      setFrom(endStr);
      setTo(endStr);
    } else if (days === 1) {
      start.setDate(start.getDate() - 1);
      const yestStr = start.toISOString().slice(0, 10);
      setFrom(yestStr);
      setTo(yestStr);
    } else {
      start.setDate(start.getDate() - days);
      setFrom(start.toISOString().slice(0, 10));
      setTo(endStr);
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
          <div>
            <h2 className="text-base font-bold text-slate-900">Daily Sales &amp; Department Performance</h2>
            <p className="text-xs text-slate-500">
              Complete invoice registers and separated sales accounting for Tire and Muffler shops.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Quick Ranges:</span>
            <button
              type="button"
              onClick={() => setRangePreset(0)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setRangePreset(1)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Yesterday
            </button>
            <button
              type="button"
              onClick={() => setRangePreset(7)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => setRangePreset(30)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Last 30 Days
            </button>

            <div className="ml-2 flex items-center gap-1.5 font-mono text-xs">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                aria-label="Start Date"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 rounded-md border border-slate-300 px-2 text-xs"
                aria-label="End Date"
              />
            </div>
          </div>
        </div>

        {/* Separated Print Buttons Bar */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setDepartmentView("ALL")}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                departmentView === "ALL" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All Departments Combined
            </button>
            <button
              type="button"
              onClick={() => setDepartmentView("TIRE")}
              className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition ${
                departmentView === "TIRE" ? "bg-white text-blue-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Icon name="tag" className="h-3.5 w-3.5" /> Tire Shop Sales
            </button>
            <button
              type="button"
              onClick={() => setDepartmentView("MUFFLER")}
              className={`flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold transition ${
                departmentView === "MUFFLER" ? "bg-white text-amber-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Icon name="wrench" className="h-3.5 w-3.5" /> Mufflers Shop Sales
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
              <Icon name="printer" className="h-4 w-4 text-blue-600" /> Print Tire Shop Sales
            </Button>
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
              <Icon name="printer" className="h-4 w-4 text-amber-600" /> Print Mufflers Shop Sales
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onPrint?.({
                  type: "DAILY_SALES_ALL",
                  title: "Consolidated Daily Sales Report",
                  data,
                  dateRange: { from, to },
                })
              }
            >
              <Icon name="printer" className="h-4 w-4 text-slate-700" /> Print All Sales
            </Button>
          </div>
        </div>
      </Card>

      <DataState loading={salesQuery.isLoading} error={salesQuery.error}>
        {/* Department-Specific or Overall View */}
        {departmentView === "ALL" && (
          <div className="space-y-5">
            {/* Top Summaries */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Total Net Sales" value={money(overallTotals?.net ?? 0)} sub="Excludes sales tax" />
              <StatTile label="Sales Tax Collected" value={money(overallTotals?.tax ?? 0)} sub="Remittance liability" />
              <StatTile label="Gross Invoiced" value={money(overallTotals?.gross ?? 0)} sub="Total revenue" />
              <StatTile label="Total Invoices" value={String(overallTotals?.count ?? 0)} sub={`${from} to ${to}`} />
            </div>

            {/* Department Comparison Cards */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-blue-200 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white font-bold">T</span>
                    <div>
                      <h3 className="font-bold text-blue-950">Tire Shop Performance</h3>
                      <p className="text-xs text-blue-700">Tires, mount/balance, tire repairs &amp; hardware</p>
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
                    <Icon name="printer" className="h-3.5 w-3.5 text-blue-600" /> Print
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-white p-3 border border-blue-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Net Sales</span>
                    <span className="font-bold font-mono text-base text-blue-950">{money(tireShop?.totals?.net ?? 0)}</span>
                  </div>
                  <div className="rounded-lg bg-white p-3 border border-blue-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Sales Tax</span>
                    <span className="font-bold font-mono text-base text-amber-700">{money(tireShop?.totals?.tax ?? 0)}</span>
                  </div>
                  <div className="rounded-lg bg-white p-3 border border-blue-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Gross Sales</span>
                    <span className="font-bold font-mono text-base text-emerald-700">{money(tireShop?.totals?.gross ?? 0)}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-blue-900">
                  <span>{tireShop?.totals?.invoiceCount ?? 0} Invoices</span>
                  <span>{tireShop?.totals?.lineCount ?? 0} Itemized Tire Services</span>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-5 shadow-2xs">
                <div className="flex items-center justify-between border-b border-amber-200 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-600 text-white font-bold">M</span>
                    <div>
                      <h3 className="font-bold text-amber-950">Mufflers Shop Performance</h3>
                      <p className="text-xs text-amber-700">Mufflers, exhausts, pipes, catalytic &amp; welding</p>
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
                    <Icon name="printer" className="h-3.5 w-3.5 text-amber-600" /> Print
                  </Button>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-white p-3 border border-amber-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Net Sales</span>
                    <span className="font-bold font-mono text-base text-amber-950">{money(mufflersShop?.totals?.net ?? 0)}</span>
                  </div>
                  <div className="rounded-lg bg-white p-3 border border-amber-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Sales Tax</span>
                    <span className="font-bold font-mono text-base text-amber-700">{money(mufflersShop?.totals?.tax ?? 0)}</span>
                  </div>
                  <div className="rounded-lg bg-white p-3 border border-amber-100">
                    <span className="text-[11px] font-medium text-slate-500 block">Gross Sales</span>
                    <span className="font-bold font-mono text-base text-emerald-700">{money(mufflersShop?.totals?.gross ?? 0)}</span>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-amber-900">
                  <span>{mufflersShop?.totals?.invoiceCount ?? 0} Invoices</span>
                  <span>{mufflersShop?.totals?.lineCount ?? 0} Itemized Muffler Services</span>
                </div>
              </div>
            </div>

            {/* Daily Chronological Summary */}
            <Card title="Daily Sales Summary">
              <Table headers={["Date", "Invoices", "Net Sales", "Sales Tax", "Gross Revenue"]}>
                {data?.days?.map((d: any) => (
                  <tr key={d.date}>
                    <td className="px-3 py-2 font-medium">{dateOnly(d.date)}</td>
                    <td className="px-3 py-2 text-slate-600">{d.count}</td>
                    <td className="px-3 py-2 tabular-nums">{money(d.net)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-600">{money(d.tax)}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold">{money(d.gross)}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        )}

        {departmentView === "TIRE" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Tire Net Sales" value={money(tireShop?.totals?.net ?? 0)} sub="Pure sales volume" />
              <StatTile label="Tire Sales Tax" value={money(tireShop?.totals?.tax ?? 0)} sub="Tax liability" />
              <StatTile label="Tire Gross Revenue" value={money(tireShop?.totals?.gross ?? 0)} sub="Total received" />
              <StatTile label="Tire Invoices" value={String(tireShop?.totals?.invoiceCount ?? 0)} sub={`${tireShop?.totals?.lineCount ?? 0} services rendered`} />
            </div>

            {/* Tire Items / Services Breakdown */}
            <Card title="Top Tire Items & Services Sold">
              <Table headers={["Item / Service", "Type", "Units Sold", "Total Sales", "Tax Attributed"]}>
                {tireShop?.items?.map((item: any) => (
                  <tr key={item.description}>
                    <td className="px-3 py-2 font-medium text-slate-900">{item.description}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{item.lineType}</td>
                    <td className="px-3 py-2 tabular-nums font-mono">{item.quantity}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-emerald-700">{money(item.lineTotal)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{money(item.taxAmount)}</td>
                  </tr>
                ))}
              </Table>
            </Card>

            {/* Tire Invoices Register */}
            <Card
              title="Tire Shop Invoices Register"
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
              <Table headers={["Date", "Invoice #", "Customer", "Tire Services", "Net", "Tax", "Total"]}>
                {tireShop?.invoices?.map((inv: any) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2 text-xs text-slate-600">{dateOnly(inv.issuedAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs font-bold text-blue-700">{inv.number}</td>
                    <td className="px-3 py-2 text-sm">{inv.customer}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">
                      {inv.lines.map((l: any) => `${l.quantity}x ${l.description}`).join(", ")}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{money(inv.net)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{money(inv.tax)}</td>
                    <td className="px-3 py-2 tabular-nums font-bold text-slate-900">{money(inv.total)}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        )}

        {departmentView === "MUFFLER" && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Mufflers Net Sales" value={money(mufflersShop?.totals?.net ?? 0)} sub="Pure sales volume" />
              <StatTile label="Mufflers Sales Tax" value={money(mufflersShop?.totals?.tax ?? 0)} sub="Tax liability" />
              <StatTile label="Mufflers Gross Revenue" value={money(mufflersShop?.totals?.gross ?? 0)} sub="Total received" />
              <StatTile label="Muffler Invoices" value={String(mufflersShop?.totals?.invoiceCount ?? 0)} sub={`${mufflersShop?.totals?.lineCount ?? 0} services rendered`} />
            </div>

            {/* Mufflers Items / Services Breakdown */}
            <Card title="Top Muffler Items & Services Sold">
              <Table headers={["Item / Service", "Type", "Units Sold", "Total Sales", "Tax Attributed"]}>
                {mufflersShop?.items?.map((item: any) => (
                  <tr key={item.description}>
                    <td className="px-3 py-2 font-medium text-slate-900">{item.description}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{item.lineType}</td>
                    <td className="px-3 py-2 tabular-nums font-mono">{item.quantity}</td>
                    <td className="px-3 py-2 tabular-nums font-semibold text-emerald-700">{money(item.lineTotal)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{money(item.taxAmount)}</td>
                  </tr>
                ))}
              </Table>
            </Card>

            {/* Mufflers Invoices Register */}
            <Card
              title="Mufflers Shop Invoices Register"
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
              <Table headers={["Date", "Invoice #", "Customer", "Muffler Services", "Net", "Tax", "Total"]}>
                {mufflersShop?.invoices?.map((inv: any) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2 text-xs text-slate-600">{dateOnly(inv.issuedAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs font-bold text-amber-800">{inv.number}</td>
                    <td className="px-3 py-2 text-sm">{inv.customer}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">
                      {inv.lines.map((l: any) => `${l.quantity}x ${l.description}`).join(", ")}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{money(inv.net)}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-500">{money(inv.tax)}</td>
                    <td className="px-3 py-2 tabular-nums font-bold text-slate-900">{money(inv.total)}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        )}
      </DataState>
    </div>
  );
}
