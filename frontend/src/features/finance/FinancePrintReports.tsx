import { useEffect } from "react";
import { dateOnly, dateTime, money } from "../../lib/format";
import { Button } from "../../components/ui";
import { Icon } from "../../components/Icon";

export type ReportType =
  | "PAYMENTS"
  | "INVOICES"
  | "CASH_CLOSING_OVERALL"
  | "CASH_CLOSING_TIRE"
  | "CASH_CLOSING_MUFFLER"
  | "RECONCILIATION"
  | "EXPENSES"
  | "LEDGER"
  | "DAILY_SALES_ALL"
  | "DAILY_SALES_TIRE"
  | "DAILY_SALES_MUFFLER"
  | "SINGLE_INVOICE";

export type PrintReportConfig = {
  type: ReportType;
  title: string;
  data: any;
  dateRange?: { from?: string | Date; to?: string | Date; date?: string };
};

export function PrintReportModal({
  config,
  onClose,
  autoPrint = false,
}: {
  config: PrintReportConfig;
  onClose: () => void;
  autoPrint?: boolean;
}) {
  const handlePrint = () => {
    const prevTitle = document.title;
    if (config.type === "SINGLE_INVOICE" && config.data?.number) {
      document.title = `Invoice-${config.data.number}`;
    } else if (config.type.startsWith("DAILY_SALES")) {
      document.title = `Daily-Sales-Report-${config.dateRange?.from ?? "Today"}`;
    }
    window.print();
    window.setTimeout(() => {
      document.title = prevTitle;
    }, 500);
  };

  // Automatically trigger print dialog on mount if autoPrint is requested
  useEffect(() => {
    if (autoPrint) {
      const timer = setTimeout(() => {
        handlePrint();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [autoPrint]);

  // Keyboard shortcut to close on Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="finance-print-modal-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/60 p-2 sm:p-4 backdrop-blur-xs print:static print:z-auto print:block print:bg-white print:p-0 print:m-0 print:overflow-visible">
      <div className="finance-print-modal-card relative flex max-h-[96vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl print:static print:max-h-none print:w-full print:max-w-none print:rounded-none print:shadow-none print:border-none print:m-0 print:p-0 print:overflow-visible">
        {/* Screen Action Bar (hidden in print) */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3 print:hidden">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-800">
              <Icon name="printer" className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900">{config.title}</h2>
              <p className="text-xs text-slate-500">Official printable report (save as PDF from destination)</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={handlePrint} className="gap-1.5 shadow-sm font-bold bg-teal-700 hover:bg-teal-800 text-white">
              <Icon name="printer" className="h-4 w-4" /> Print / Save as PDF
            </Button>
          </div>
        </div>

        {/* Printable Paper Document Container */}
        <div className="finance-print-modal-scroll flex-1 overflow-y-auto p-6 font-sans text-ink print:static print:overflow-visible print:p-0 print:m-0">
          <style>{`
            @media print {
              html, body {
                background: #ffffff !important;
                color: #000000 !important;
                height: auto !important;
                min-height: 100% !important;
                overflow: visible !important;
                margin: 0 !important;
                padding: 0 !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              /* Strict isolation: Hide ALL application shell, navigation, and background screen UI */
              aside, header, nav, footer, .print\\:hidden, .report-screen-ui, .finance-screen-ui, main > div > *:not(.finance-print-modal-overlay) {
                display: none !important;
                visibility: hidden !important;
              }
              main {
                margin: 0 !important;
                padding: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
              }
              .finance-print-modal-overlay {
                position: static !important;
                display: block !important;
                background: #ffffff !important;
                padding: 0 !important;
                margin: 0 !important;
                overflow: visible !important;
                width: 100% !important;
                height: auto !important;
                visibility: visible !important;
              }
              .finance-print-modal-card {
                position: static !important;
                display: block !important;
                max-width: 100% !important;
                max-height: none !important;
                height: auto !important;
                border: none !important;
                box-shadow: none !important;
                padding: 0 !important;
                margin: 0 !important;
                overflow: visible !important;
                background: #ffffff !important;
                visibility: visible !important;
              }
              .finance-print-modal-scroll {
                overflow: visible !important;
                height: auto !important;
                max-height: none !important;
                padding: 0 !important;
                margin: 0 !important;
                background: #ffffff !important;
                visibility: visible !important;
              }
              #printable-report-content {
                position: static !important;
                display: block !important;
                width: 100% !important;
                margin: 0 !important;
                padding: 10mm 12mm !important;
                background: #ffffff !important;
                visibility: visible !important;
              }
              #printable-report-content * {
                visibility: visible !important;
              }
              @page {
                size: letter portrait;
                margin: 0mm;
              }
              tr {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
              table {
                page-break-inside: auto !important;
                break-inside: auto !important;
              }
            }
          `}</style>

          <div id="printable-report-content" className="space-y-4">
            {/* Standard Official Header (skipped for SINGLE_INVOICE which renders its own formal Invoice Header) */}
            {config.type !== "SINGLE_INVOICE" && (
              <div className="border-b-2 border-slate-900 pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h1 className="font-display text-xl font-black uppercase tracking-tight text-slate-900">
                      MARK&apos;S TIRE SHOP &amp; MUFFLER
                    </h1>
                    <p className="text-xs text-slate-600">5229 Saint Claude Ave · New Orleans, LA 70117 · (504) 354-9396</p>
                  </div>
                  <div className="text-right">
                    <span className="inline-block rounded-md border border-slate-800 bg-slate-900 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-white">
                      {config.title}
                    </span>
                    {config.dateRange?.date && (
                      <p className="mt-1 text-xs font-semibold text-slate-800">Date: {dateOnly(config.dateRange.date)}</p>
                    )}
                    {config.dateRange?.from && config.dateRange?.to && (
                      <p className="mt-1 text-xs font-semibold text-slate-800">
                        {config.dateRange.from === config.dateRange.to
                          ? `Date: ${dateOnly(config.dateRange.from)}`
                          : `Period: ${dateOnly(config.dateRange.from)} – ${dateOnly(config.dateRange.to)}`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Document Body by Type */}
            {config.type === "SINGLE_INVOICE" && <SingleInvoiceReportBody invoice={config.data} />}
            {config.type === "PAYMENTS" && <PaymentsReportBody payments={config.data} />}
            {config.type === "INVOICES" && <InvoicesReportBody invoices={config.data} />}
            {config.type.startsWith("CASH_CLOSING") && (
              <CashClosingReportBody
                summary={config.data}
                dept={
                  config.type === "CASH_CLOSING_TIRE"
                    ? "TIRE"
                    : config.type === "CASH_CLOSING_MUFFLER"
                    ? "MUFFLER"
                    : "OVERALL"
                }
              />
            )}
            {config.type === "RECONCILIATION" && <ReconciliationReportBody data={config.data} />}
            {config.type === "EXPENSES" && <ExpensesReportBody expenses={config.data} />}
            {config.type === "LEDGER" && <LedgerReportBody tb={config.data} />}
            {config.type.startsWith("DAILY_SALES") && (
              <DailySalesReportBody
                sales={config.data}
                dept={
                  config.type === "DAILY_SALES_TIRE"
                    ? "TIRE"
                    : config.type === "DAILY_SALES_MUFFLER"
                    ? "MUFFLER"
                    : "ALL"
                }
              />
            )}

            {/* Verification Sign-off for Closing Reports */}
            {config.type.startsWith("CASH_CLOSING") && (
              <div className="mt-8 border-t border-slate-300 pt-6">
                <div className="grid grid-cols-2 gap-8 text-xs text-slate-700">
                  <div className="border-t border-slate-400 pt-1">
                    <p className="font-bold">Cashier / Staff Signature</p>
                    <p className="text-[10px] text-slate-500">I certify that the counted figures and receipts above are accurate.</p>
                  </div>
                  <div className="border-t border-slate-400 pt-1">
                    <p className="font-bold">Manager / Bookkeeper Verification</p>
                    <p className="text-[10px] text-slate-500">Verified against register closing drawer &amp; bank deposits.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. All Payments Report
// ---------------------------------------------------------------------------
function PaymentsReportBody({ payments }: { payments: any[] }) {
  const totalGross = payments.reduce((s, p) => s + (p.amount ?? 0), 0);
  const totalFees = payments.reduce((s, p) => s + (p.feeAmount ?? 0), 0);
  const netBank = totalGross - totalFees;

  return (
    <div className="space-y-4">
      {/* Summary KPI Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase">Gross Payments Collected</p>
          <p className="text-xl font-bold font-mono text-slate-900">{money(totalGross)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase">Processor Fees</p>
          <p className="text-xl font-bold font-mono text-slate-600">-{money(totalFees)}</p>
        </div>
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3">
          <p className="text-xs font-semibold text-teal-800 uppercase">Net Banked Funds</p>
          <p className="text-xl font-bold font-mono text-teal-900">{money(netBank)}</p>
        </div>
      </div>

      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b-2 border-slate-300 bg-slate-100 font-bold uppercase text-slate-700">
            <th className="py-2 px-2">Date</th>
            <th className="py-2 px-2">Customer</th>
            <th className="py-2 px-2">Method</th>
            <th className="py-2 px-2">Invoice / Ref</th>
            <th className="py-2 px-2 text-right">Gross</th>
            <th className="py-2 px-2 text-right">Fee</th>
            <th className="py-2 px-2 text-right">Net</th>
            <th className="py-2 px-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {payments.map((p) => {
            const cust = p.customer
              ? `${p.customer.firstName ?? ""} ${p.customer.lastName ?? ""}`.trim() || p.customer.companyName
              : "Walk-in";
            const invNums = p.allocations?.map((a: any) => a.invoice?.number).filter(Boolean).join(", ") || p.reference || "Counter";
            return (
              <tr key={p.id}>
                <td className="py-2 px-2 text-slate-600 whitespace-nowrap">{dateOnly(p.receivedAt)}</td>
                <td className="py-2 px-2 font-medium text-slate-900">{cust}</td>
                <td className="py-2 px-2 font-mono text-slate-700">{p.method}</td>
                <td className="py-2 px-2 font-mono text-slate-600">{invNums}</td>
                <td className="py-2 px-2 text-right font-mono font-bold text-slate-900">{money(p.amount)}</td>
                <td className="py-2 px-2 text-right font-mono text-slate-500">-{money(p.feeAmount)}</td>
                <td className="py-2 px-2 text-right font-mono font-semibold text-teal-800">{money(p.amount - p.feeAmount)}</td>
                <td className="py-2 px-2 text-center">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                    {p.status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Cash Closing Report (Overall, Tire Shop, Mufflers Shop)
// ---------------------------------------------------------------------------
function CashClosingReportBody({
  summary,
  dept,
}: {
  summary: any;
  dept: "TIRE" | "MUFFLER" | "OVERALL";
}) {
  const isTire = dept === "TIRE";
  const isMuffler = dept === "MUFFLER";
  const deptData = isTire ? summary?.tireShop : isMuffler ? summary?.mufflersShop : null;

  const cashReceipts = deptData ? deptData.cashReceipts : summary?.drawerSummary?.cashReceipts ?? 0;
  const cardReceipts = deptData ? deptData.cardReceipts : summary?.combined?.totalCard ?? 0;
  const checkReceipts = deptData ? deptData.checkReceipts : summary?.combined?.totalCheck ?? 0;
  const totalCollected = deptData ? deptData.totalCollected : summary?.combined?.totalCollected ?? 0;
  const netSales = deptData ? deptData.netSales : summary?.combined?.totalNetSales ?? 0;
  const taxCollected = deptData ? deptData.taxCollected : summary?.combined?.totalTax ?? 0;
  const cashExpenses = deptData ? deptData.cashExpenses : summary?.drawerSummary?.cashExpenses ?? 0;
  const closingBalance = deptData ? deptData.closingCashBalance : summary?.drawerSummary?.expectedTotal ?? 0;

  const payments = deptData ? deptData.payments : (summary?.tireShop?.payments || []).concat(summary?.mufflersShop?.payments || []);

  return (
    <div className="space-y-5">
      {/* Notice Banner */}
      <div className={`rounded-xl border p-3 text-xs ${
        isTire ? "border-blue-200 bg-blue-50 text-blue-900" : isMuffler ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-800"
      }`}>
        <p className="font-bold text-sm">
          {isTire ? "TIRE SHOP END-OF-DAY CLOSING ACCOUNT" : isMuffler ? "MUFFLERS SHOP END-OF-DAY CLOSING ACCOUNT" : "MAIN REGISTER CONSOLIDATED CASH CLOSING"}
        </p>
        <p className="text-[11px] mt-0.5">
          {isTire
            ? "Dedicated closing account and receipts breakdown for tire installations, balancing, rotations, repairs and parts."
            : isMuffler
            ? "Dedicated closing account and receipts breakdown for exhaust repairs, mufflers, welding, and catalytic converter services."
            : "Consolidated drawer count, float, cash receipts, and store-wide variance reconciliation."}
        </p>
      </div>

      {/* Summary KPI Grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <p className="text-[11px] font-bold uppercase text-slate-500">Cash Receipts</p>
          <p className="text-xl font-black font-mono text-emerald-700">{money(cashReceipts)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <p className="text-[11px] font-bold uppercase text-slate-500">Card / Electronic</p>
          <p className="text-xl font-black font-mono text-blue-700">{money(cardReceipts)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
          <p className="text-[11px] font-bold uppercase text-slate-500">Check / Other</p>
          <p className="text-xl font-black font-mono text-slate-700">{money(checkReceipts)}</p>
        </div>
        <div className="rounded-xl border border-slate-300 bg-slate-100 p-3 shadow-xs">
          <p className="text-[11px] font-bold uppercase text-slate-700">Total Revenue</p>
          <p className="text-xl font-black font-mono text-slate-900">{money(totalCollected)}</p>
        </div>
      </div>

      {/* Account Balances Table */}
      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-700">Closing Account Summary</h3>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="py-1.5 text-slate-600">Net Sales Revenue</td>
              <td className="py-1.5 text-right font-mono font-bold text-slate-900">{money(netSales)}</td>
            </tr>
            <tr>
              <td className="py-1.5 text-slate-600">Sales Tax Liability Collected</td>
              <td className="py-1.5 text-right font-mono text-slate-700">{money(taxCollected)}</td>
            </tr>
            <tr>
              <td className="py-1.5 text-slate-600">Attributed Cash Drawer Expenses / Paid-Outs</td>
              <td className="py-1.5 text-right font-mono text-red-600">-{money(cashExpenses)}</td>
            </tr>
            {dept === "OVERALL" && (
              <>
                <tr>
                  <td className="py-1.5 text-slate-600">Opening Cash Float</td>
                  <td className="py-1.5 text-right font-mono font-bold text-slate-800">{money(summary?.drawerSummary?.openingFloat)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-slate-600">Expected Total in Drawer</td>
                  <td className="py-1.5 text-right font-mono font-bold text-teal-800">{money(summary?.drawerSummary?.expectedTotal)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 text-slate-600">Counted Total in Drawer</td>
                  <td className="py-1.5 text-right font-mono font-black text-slate-900">
                    {summary?.drawerSummary?.countedTotal !== null ? money(summary.drawerSummary.countedTotal) : "Pending count"}
                  </td>
                </tr>
                {summary?.drawerSummary?.variance !== null && (
                  <tr>
                    <td className="py-1.5 font-bold text-slate-700">Drawer Over / Short (Variance)</td>
                    <td className={`py-1.5 text-right font-mono font-bold ${
                      summary.drawerSummary.variance === 0 ? "text-slate-600" : summary.drawerSummary.variance > 0 ? "text-emerald-700" : "text-red-600"
                    }`}>
                      {money(summary.drawerSummary.variance)}
                    </td>
                  </tr>
                )}
              </>
            )}
            <tr className="border-t border-slate-300 font-bold">
              <td className="py-2 text-slate-900">
                {dept === "OVERALL" ? "Net Cash Reconciled" : `${isTire ? "Tire Shop" : "Mufflers Shop"} Net Cash Balance`}
              </td>
              <td className="py-2 text-right font-mono text-sm text-teal-900">{money(closingBalance)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Itemized Payments List for this department */}
      {payments.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {isTire ? "Tire Shop Transactions" : isMuffler ? "Mufflers Shop Transactions" : "Consolidated Transactions"}
          </h3>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <th className="py-1.5 px-2">Time</th>
                <th className="py-1.5 px-2">Customer</th>
                <th className="py-1.5 px-2">Method</th>
                <th className="py-1.5 px-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p: any, idx: number) => (
                <tr key={p.id || idx}>
                  <td className="py-1.5 px-2 font-mono text-slate-500">{dateTime(p.receivedAt)}</td>
                  <td className="py-1.5 px-2 font-medium text-slate-900">{p.customer}</td>
                  <td className="py-1.5 px-2 font-mono text-slate-700">{p.method}</td>
                  <td className="py-1.5 px-2 text-right font-mono font-bold text-slate-900">{money(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Reconciliation Report
// ---------------------------------------------------------------------------
function ReconciliationReportBody({ data }: { data: any }) {
  const items = data?.items || [];
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
        <p className="font-bold text-slate-800">Exceptions &amp; Bank Confirmation Queue</p>
        <p className="text-slate-500">Items requiring verification, resolving notes, or settlement confirmation.</p>
      </div>

      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b-2 border-slate-300 bg-slate-100 font-bold uppercase text-slate-700">
            <th className="py-2 px-2">Date</th>
            <th className="py-2 px-2">Type</th>
            <th className="py-2 px-2">Reference</th>
            <th className="py-2 px-2">Details</th>
            <th className="py-2 px-2 text-right">Amount</th>
            <th className="py-2 px-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {items.map((it: any) => (
            <tr key={it.id}>
              <td className="py-2 px-2 text-slate-600">{dateOnly(it.createdAt)}</td>
              <td className="py-2 px-2 font-mono text-slate-800">{it.kind}</td>
              <td className="py-2 px-2 font-mono text-slate-600">{it.reference}</td>
              <td className="py-2 px-2 text-slate-700 max-w-xs">{it.detail}</td>
              <td className="py-2 px-2 text-right font-mono font-bold text-slate-900">
                {it.amount !== null ? money(it.amount) : "—"}
              </td>
              <td className="py-2 px-2 text-center">
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                  {it.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Expenses Report
// ---------------------------------------------------------------------------
function ExpensesReportBody({ expenses }: { expenses: any[] }) {
  const total = expenses.reduce((s, e) => s + (e.amount ?? 0), 0);
  const cashTotal = expenses.filter((e) => e.isCash).reduce((s, e) => s + (e.amount ?? 0), 0);
  const apTotal = total - cashTotal;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase">Total Expenses</p>
          <p className="text-xl font-bold font-mono text-slate-900">{money(total)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800 uppercase">Paid from Cash Drawer</p>
          <p className="text-xl font-bold font-mono text-amber-900">{money(cashTotal)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase">Accounts Payable</p>
          <p className="text-xl font-bold font-mono text-slate-700">{money(apTotal)}</p>
        </div>
      </div>

      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b-2 border-slate-300 bg-slate-100 font-bold uppercase text-slate-700">
            <th className="py-2 px-2">Date</th>
            <th className="py-2 px-2">Category</th>
            <th className="py-2 px-2">Vendor</th>
            <th className="py-2 px-2">Payment Source</th>
            <th className="py-2 px-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {expenses.map((e) => (
            <tr key={e.id}>
              <td className="py-2 px-2 text-slate-600">{dateOnly(e.incurredOn || e.createdAt)}</td>
              <td className="py-2 px-2 font-medium text-slate-900">{e.category}</td>
              <td className="py-2 px-2 text-slate-700">{e.vendor}</td>
              <td className="py-2 px-2 text-slate-500">{e.isCash ? "Cash Drawer" : "Accounts Payable"}</td>
              <td className="py-2 px-2 text-right font-mono font-bold text-slate-900">{money(e.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. General Ledger / Trial Balance Report
// ---------------------------------------------------------------------------
function LedgerReportBody({ tb }: { tb: any }) {
  const rows = tb?.rows || [];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
        <div>
          <p className="font-bold text-slate-900">Trial Balance Verification</p>
          <p className="text-slate-500">Subledger posting integrity test (Debits vs Credits).</p>
        </div>
        <span className={`rounded-md px-2.5 py-1 text-xs font-bold ${
          tb?.balanced ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
        }`}>
          {tb?.balanced ? "BALANCED" : "OUT OF BALANCE"}
        </span>
      </div>

      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b-2 border-slate-300 bg-slate-100 font-bold uppercase text-slate-700">
            <th className="py-2 px-2">Code</th>
            <th className="py-2 px-2">Account Title</th>
            <th className="py-2 px-2">Type</th>
            <th className="py-2 px-2 text-right">Debit</th>
            <th className="py-2 px-2 text-right">Credit</th>
            <th className="py-2 px-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.filter((r: any) => r.debit !== 0 || r.credit !== 0).map((r: any) => (
            <tr key={r.code}>
              <td className="py-2 px-2 font-mono font-bold text-slate-900">{r.code}</td>
              <td className="py-2 px-2 text-slate-900">{r.name}</td>
              <td className="py-2 px-2 text-slate-500 uppercase text-[10px]">{r.type}</td>
              <td className="py-2 px-2 text-right font-mono text-slate-700">{money(r.debit)}</td>
              <td className="py-2 px-2 text-right font-mono text-slate-700">{money(r.credit)}</td>
              <td className="py-2 px-2 text-right font-mono font-bold text-slate-900">{money(r.balance)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-800 font-bold bg-slate-50">
            <td colSpan={3} className="py-2 px-2 text-slate-900">Total Verification</td>
            <td className="py-2 px-2 text-right font-mono text-slate-900">{money(tb?.debits)}</td>
            <td className="py-2 px-2 text-right font-mono text-slate-900">{money(tb?.credits)}</td>
            <td className="py-2 px-2 text-right font-mono text-teal-800">{tb?.balanced ? "$0.00" : "DIFF"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. Daily Sales Report (Simple Header + Clean Table with Total, No Extra Cards)
// ---------------------------------------------------------------------------
function DailySalesReportBody({
  sales,
  dept,
}: {
  sales: any;
  dept: "TIRE" | "MUFFLER" | "ALL";
}) {
  const isTire = dept === "TIRE";
  const isMuffler = dept === "MUFFLER";
  const target = isTire ? sales?.tireShop : isMuffler ? sales?.mufflersShop : sales;

  const net = target?.totals?.net ?? 0;
  const tax = target?.totals?.tax ?? 0;
  const gross = target?.totals?.gross ?? 0;
  const count = target?.totals?.invoiceCount ?? target?.totals?.count ?? target?.invoices?.length ?? 0;
  const invoices: any[] = target?.invoices || [];

  return (
    <div className="space-y-3">
      {/* Invoices Table with Grand Total */}
      {invoices.length === 0 ? (
        <p className="rounded border border-slate-200 p-6 text-center text-xs text-slate-500">
          No invoices recorded for this period.
        </p>
      ) : (
        <table className="w-full border-collapse text-left text-xs border border-slate-300">
          <thead>
            <tr className="border-b-2 border-slate-300 bg-slate-100 font-bold uppercase text-slate-700">
              <th className="py-2.5 px-3">Invoice #</th>
              <th className="py-2.5 px-3">Date &amp; Time</th>
              <th className="py-2.5 px-3">Customer</th>
              <th className="py-2.5 px-3">Items &amp; Services</th>
              <th className="py-2.5 px-3 text-right">Before Tax</th>
              <th className="py-2.5 px-3 text-right">Tax</th>
              <th className="py-2.5 px-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {invoices.map((inv: any) => (
              <tr key={inv.id}>
                <td className="py-2 px-3 font-mono font-bold text-slate-900 whitespace-nowrap">{inv.number}</td>
                <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{dateTime(inv.issuedAt)}</td>
                <td className="py-2 px-3 font-semibold text-slate-800 whitespace-nowrap">{inv.customer}</td>
                <td className="py-2 px-3 text-slate-600 text-[11px]">
                  {inv.lines?.map((l: any) => `${l.quantity}x ${l.description}`).join(", ") || "—"}
                </td>
                <td className="py-2 px-3 text-right font-mono text-slate-700">{money(inv.net)}</td>
                <td className="py-2 px-3 text-right font-mono text-slate-600">{money(inv.tax)}</td>
                <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">{money(inv.total)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-900 bg-slate-50 font-black text-sm">
              <td colSpan={4} className="py-3 px-3 text-right uppercase text-slate-900">
                TOTAL ({count} {count === 1 ? "INVOICE" : "INVOICES"})
              </td>
              <td className="py-3 px-3 text-right font-mono text-slate-800">{money(net)}</td>
              <td className="py-3 px-3 text-right font-mono text-slate-800">{money(tax)}</td>
              <td className="py-3 px-3 text-right font-mono text-base font-black text-slate-950">{money(gross)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6B. Formal Individual Customer Sales Invoice (Separate from Daily Report)
// ---------------------------------------------------------------------------
function SingleInvoiceReportBody({ invoice }: { invoice: any }) {
  const lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    taxAmount: number;
    lineType?: string;
    department?: string;
  }> = invoice?.lines || [];

  const deptLabel =
    invoice?.department === "MUFFLER"
      ? "Mufflers Shop"
      : invoice?.department === "TIRE"
      ? "Tires Shop"
      : "Tires & Mufflers Shop";

  return (
    <div className="space-y-6 text-slate-900">
      {/* Formal Invoice Header */}
      <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
        <div>
          <h1 className="font-display text-2xl font-black uppercase tracking-tight text-slate-900">
            MARK&apos;S TIRE SHOP &amp; MUFFLER
          </h1>
          <p className="mt-0.5 text-xs font-medium text-slate-600">5229 Saint Claude Ave, New Orleans, LA 70117</p>
          <p className="text-xs font-medium text-slate-600">Phone: (504) 354-9396</p>
        </div>
        <div className="text-right">
          <span className="inline-block rounded-md bg-slate-900 px-3 py-1 text-xs font-black uppercase tracking-widest text-white">
            SALES INVOICE
          </span>
          <p className="mt-1.5 font-mono text-xl font-black text-slate-900">{invoice?.number}</p>
          <p className="text-xs font-medium text-slate-600">Date: {dateTime(invoice?.issuedAt)}</p>
        </div>
      </div>

      {/* Bill To & Invoice Metadata */}
      <div className="grid grid-cols-2 gap-4 rounded-xl border border-slate-300 bg-slate-50 p-4 text-xs">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Bill To (Customer)</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{invoice?.customer || "Walk-in Customer"}</p>
          <p className="mt-0.5 text-slate-600">Customer Copy — Official Sales Invoice</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Invoice Details</p>
          <p className="mt-1 font-semibold text-slate-800">Department: {deptLabel}</p>
          <p className="mt-0.5 font-bold text-emerald-700">Status: {invoice?.status || "PAID IN FULL"}</p>
        </div>
      </div>

      {/* Itemized Invoice Lines Table */}
      <div>
        <table className="w-full border-collapse border border-slate-300 text-left text-xs">
          <thead>
            <tr className="border-b-2 border-slate-800 bg-slate-100 font-bold uppercase text-slate-800">
              <th className="py-2.5 px-3 w-10">#</th>
              <th className="py-2.5 px-3">Item / Service Description</th>
              <th className="py-2.5 px-3 text-right w-16">Qty</th>
              <th className="py-2.5 px-3 text-right w-28">Unit Price</th>
              <th className="py-2.5 px-3 text-right w-24">Tax</th>
              <th className="py-2.5 px-3 text-right w-28">Line Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {lines.map((l, idx) => (
              <tr key={idx}>
                <td className="py-2.5 px-3 font-mono text-slate-500">{idx + 1}</td>
                <td className="py-2.5 px-3 font-semibold text-slate-900">{l.description}</td>
                <td className="py-2.5 px-3 text-right font-mono">{l.quantity}</td>
                <td className="py-2.5 px-3 text-right font-mono">{money(l.unitPrice)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-600">{money(l.taxAmount)}</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">{money(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invoice Totals Box */}
      <div className="flex justify-end">
        <div className="w-72 space-y-1.5 rounded-xl border-2 border-slate-900 bg-slate-50 p-4 text-xs">
          <div className="flex justify-between text-slate-700">
            <span className="font-semibold">Subtotal (Before Tax):</span>
            <span className="font-mono font-bold">{money(invoice?.net ?? 0)}</span>
          </div>
          <div className="flex justify-between text-slate-700">
            <span className="font-semibold">Sales Tax:</span>
            <span className="font-mono font-bold">{money(invoice?.tax ?? 0)}</span>
          </div>
          <div className="flex justify-between border-t-2 border-slate-900 pt-2 text-sm font-black text-slate-900">
            <span>INVOICE TOTAL:</span>
            <span className="font-mono">{money(invoice?.total ?? 0)}</span>
          </div>
          <div className="flex justify-between pt-1 text-[11px] font-bold text-emerald-700">
            <span>PAYMENT STATUS:</span>
            <span>PAID IN FULL</span>
          </div>
        </div>
      </div>

      {/* Signatures & Thank You Footer */}
      <div className="mt-8 grid grid-cols-2 gap-10 pt-6 text-xs text-slate-700">
        <div className="border-t border-slate-400 pt-1.5">
          <p className="font-bold text-slate-900">Customer Signature</p>
          <p className="text-[10px] text-slate-500">Work &amp; parts received in satisfactory condition.</p>
        </div>
        <div className="border-t border-slate-400 pt-1.5">
          <p className="font-bold text-slate-900">Authorized Shop Representative</p>
          <p className="text-[10px] text-slate-500">Mark&apos;s Tire Shop &amp; Muffler · (504) 354-9396</p>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-3 text-center text-xs text-slate-500">
        Thank you for your business! Please keep this invoice for your records.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. Invoices & Receivables Register Report
// ---------------------------------------------------------------------------
function InvoicesReportBody({ invoices }: { invoices: any[] }) {
  const getBal = (inv: any) =>
    inv.balance !== undefined
      ? Number(inv.balance || 0)
      : Math.max(0, (inv.total || 0) - (inv.amountPaid || 0) - (inv.amountCredited || 0));

  const getPaid = (inv: any) =>
    inv.amountPaid !== undefined
      ? Number(inv.amountPaid || 0)
      : Math.max(0, (inv.total || 0) - getBal(inv));

  const totalInvoiced = invoices.reduce((s, inv) => s + (inv.total || 0), 0);
  const totalPaid = invoices.reduce((s, inv) => s + getPaid(inv), 0);
  const totalBalance = invoices.reduce((s, inv) => s + getBal(inv), 0);

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase">Total Invoiced</p>
          <p className="text-xl font-bold font-mono text-slate-900">{money(totalInvoiced)}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-800 uppercase">Total Paid / Settled</p>
          <p className="text-xl font-bold font-mono text-emerald-950">{money(totalPaid)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800 uppercase">Outstanding Balance</p>
          <p className="text-xl font-bold font-mono text-amber-900">{money(totalBalance)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase">Invoices Count</p>
          <p className="text-xl font-bold font-mono text-slate-900">{invoices.length}</p>
        </div>
      </div>

      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b-2 border-slate-300 bg-slate-100 font-bold uppercase text-slate-700">
            <th className="py-2 px-2">Invoice #</th>
            <th className="py-2 px-2">Customer</th>
            <th className="py-2 px-2">Status</th>
            <th className="py-2 px-2">Issued Date</th>
            <th className="py-2 px-2 text-right">Total</th>
            <th className="py-2 px-2 text-right">Paid</th>
            <th className="py-2 px-2 text-right">Balance Due</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {invoices.map((inv: any) => {
            const bal = getBal(inv);
            const paid = getPaid(inv);
            const custName = inv.customer
              ? typeof inv.customer === "string"
                ? inv.customer
                : `${inv.customer.firstName ?? ""} ${inv.customer.lastName ?? ""}`.trim() || inv.customer.companyName || "Walk-in"
              : "Walk-in";

            return (
              <tr key={inv.id || inv.number}>
                <td className="py-2 px-2 font-mono font-bold text-slate-900">{inv.number}</td>
                <td className="py-2 px-2 text-slate-800">{custName}</td>
                <td className="py-2 px-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    bal <= 0 || inv.status === "PAID"
                      ? "bg-emerald-100 text-emerald-800"
                      : bal < (inv.total || 0) || inv.status === "PARTLY_PAID"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-red-100 text-red-800"
                  }`}>
                    {bal <= 0 ? "PAID" : bal < (inv.total || 0) ? "PARTLY PAID" : "UNPAID"}
                  </span>
                </td>
                <td className="py-2 px-2 text-slate-600">{dateOnly(inv.issuedAt)}</td>
                <td className="py-2 px-2 text-right font-mono font-semibold text-slate-900">{money(inv.total)}</td>
                <td className="py-2 px-2 text-right font-mono text-emerald-800">{money(paid)}</td>
                <td className="py-2 px-2 text-right font-mono font-bold text-slate-900">{money(bal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
