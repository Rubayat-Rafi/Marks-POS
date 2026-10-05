import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { dateOnly, money, percent } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { Card, DataState, Notice, StatTile, Table, Button, Input } from "../components/ui";
import { Icon } from "../components/Icon";
import { PrintReportModal, type PrintReportConfig } from "../features/finance/FinancePrintReports";

type ShopBreakdown = {
  shopName: string;
  totals: { net: number; tax: number; gross: number; invoiceCount: number; lineCount: number };
  days: Array<{ date: string; net: number; tax: number; gross: number; count: number }>;
  items: Array<{ description: string; quantity: number; lineTotal: number; taxAmount: number; lineType: string }>;
  invoices: Array<{
    id: string;
    number: string;
    customer: string;
    issuedAt: string;
    net: number;
    tax: number;
    total: number;
    lines: Array<{ description: string; quantity: number; unitPrice: number; lineTotal: number; taxAmount: number }>;
  }>;
};

type DailySales = {
  basis: string;
  note: string;
  days: Array<{ date: string; net: number; tax: number; gross: number; count: number }>;
  totals: { net: number; tax: number; gross: number; count?: number };
  tireShop?: ShopBreakdown;
  mufflersShop?: ShopBreakdown;
};

type JobMargins = {
  rows: Array<{
    id: string;
    number: string;
    customer: string;
    vehicle: string;
    netSales: number;
    partsCost: number;
    laborCost: number;
    directCost: number;
    grossProfit: number;
    grossMarginPct: number | null;
    provisional: boolean;
    missingCosts: boolean;
  }>;
  flaggedCount: number;
  note: string;
};

type TechHours = {
  rows: Array<{
    technicianId: string;
    name: string;
    workedHours: number;
    billedHours: number;
    jobCount: number;
    efficiency: number | null;
  }>;
};

type DatePreset =
  | "TODAY"
  | "YESTERDAY"
  | "LAST_7"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "LAST_30"
  | "THIS_YEAR"
  | "ALL_TIME"
  | "CUSTOM";

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function computePresetDates(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const todayStr = toDateString(now);

  switch (preset) {
    case "TODAY":
      return { from: todayStr, to: todayStr };
    case "YESTERDAY": {
      const yest = new Date(now.getTime() - 86_400_000);
      const s = toDateString(yest);
      return { from: s, to: s };
    }
    case "LAST_7": {
      const d7 = new Date(now.getTime() - 7 * 86_400_000);
      return { from: toDateString(d7), to: todayStr };
    }
    case "LAST_30": {
      const d30 = new Date(now.getTime() - 30 * 86_400_000);
      return { from: toDateString(d30), to: todayStr };
    }
    case "THIS_MONTH": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toDateString(first), to: todayStr };
    }
    case "LAST_MONTH": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toDateString(first), to: toDateString(last) };
    }
    case "THIS_YEAR": {
      const first = new Date(now.getFullYear(), 0, 1);
      return { from: toDateString(first), to: todayStr };
    }
    case "ALL_TIME": {
      return { from: "2020-01-01", to: todayStr };
    }
    case "CUSTOM":
    default: {
      const d30 = new Date(now.getTime() - 30 * 86_400_000);
      return { from: toDateString(d30), to: todayStr };
    }
  }
}

function downloadCsvFile(filename: string, headers: string[], rows: (string | number)[][]) {
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

export function ReportsPage() {
  const { can } = useAuth();
  const [shopTab, setShopTab] = useState<"CONSOLIDATED" | "TIRE" | "MUFFLER">("CONSOLIDATED");

  // Date Filtering State
  const [datePreset, setDatePreset] = useState<DatePreset>("LAST_30");
  const [customFrom, setCustomFrom] = useState(() => {
    const d30 = new Date(Date.now() - 30 * 86_400_000);
    return toDateString(d30);
  });
  const [customTo, setCustomTo] = useState(() => toDateString(new Date()));

  // Active Date Bounds
  const { from, to } = useMemo(() => {
    if (datePreset === "CUSTOM") {
      return {
        from: customFrom || toDateString(new Date(Date.now() - 30 * 86_400_000)),
        to: customTo || toDateString(new Date()),
      };
    }
    return computePresetDates(datePreset);
  }, [datePreset, customFrom, customTo]);

  // Print Report Modal State
  const [printConfig, setPrintConfig] = useState<PrintReportConfig | null>(null);

  // Queries with dynamic from & to
  const sales = useQuery({
    queryKey: ["daily-sales", from, to],
    queryFn: () => api.get<DailySales>(`/reports/daily-sales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: can("reports.sales"),
  });

  const margins = useQuery({
    queryKey: ["job-margins", from, to],
    queryFn: () => api.get<JobMargins>(`/reports/job-margins?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: can("reports.costs"),
  });

  const hours = useQuery({
    queryKey: ["technician-hours", from, to],
    queryFn: () => api.get<TechHours>(`/reports/technician-hours?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    enabled: can("reports.costs"),
  });

  const tireData = sales.data?.tireShop;
  const mufflerData = sales.data?.mufflersShop;

  // Handlers for Exporting CSV
  const handleExportSalesCsv = () => {
    if (!sales.data) return;

    if (shopTab === "TIRE" && tireData) {
      const headers = ["Invoice Number", "Customer", "Date", "Items Sold", "Net Sales ($)", "Sales Tax ($)", "Total Gross ($)"];
      const rows = tireData.invoices.map((inv) => [
        inv.number,
        inv.customer,
        dateOnly(inv.issuedAt),
        inv.lines.map((l) => `${l.quantity}x ${l.description}`).join("; "),
        (inv.net / 100).toFixed(2),
        (inv.tax / 100).toFixed(2),
        (inv.total / 100).toFixed(2),
      ]);
      downloadCsvFile(`tires-shop-sales_${from}_to_${to}.csv`, headers, rows);
      return;
    }

    if (shopTab === "MUFFLER" && mufflerData) {
      const headers = ["Invoice Number", "Customer", "Date", "Items Sold", "Net Sales ($)", "Sales Tax ($)", "Total Gross ($)"];
      const rows = mufflerData.invoices.map((inv) => [
        inv.number,
        inv.customer,
        dateOnly(inv.issuedAt),
        inv.lines.map((l) => `${l.quantity}x ${l.description}`).join("; "),
        (inv.net / 100).toFixed(2),
        (inv.tax / 100).toFixed(2),
        (inv.total / 100).toFixed(2),
      ]);
      downloadCsvFile(`mufflers-shop-sales_${from}_to_${to}.csv`, headers, rows);
      return;
    }

    // Consolidated daily sales
    const headers = ["Date", "Invoices Count", "Net Sales ($)", "Sales Tax ($)", "Gross Sales ($)"];
    const rows = sales.data.days.map((d) => [
      d.date,
      d.count,
      (d.net / 100).toFixed(2),
      (d.tax / 100).toFixed(2),
      (d.gross / 100).toFixed(2),
    ]);
    downloadCsvFile(`daily-sales-consolidated_${from}_to_${to}.csv`, headers, rows);
  };

  const handleExportMarginsCsv = () => {
    if (!margins.data?.rows) return;
    const headers = [
      "Job Number",
      "Customer",
      "Vehicle",
      "Net Sales ($)",
      "Parts Cost ($)",
      "Labor Cost ($)",
      "Direct Cost ($)",
      "Gross Profit ($)",
      "Gross Margin (%)",
    ];
    const rows = margins.data.rows.map((r) => [
      r.number,
      r.customer,
      r.vehicle,
      (r.netSales / 100).toFixed(2),
      (r.partsCost / 100).toFixed(2),
      (r.laborCost / 100).toFixed(2),
      (r.directCost / 100).toFixed(2),
      (r.grossProfit / 100).toFixed(2),
      r.grossMarginPct !== null ? `${r.grossMarginPct.toFixed(1)}%` : "N/A",
    ]);
    downloadCsvFile(`job-margins_${from}_to_${to}.csv`, headers, rows);
  };

  const handleExportHoursCsv = () => {
    if (!hours.data?.rows) return;
    const headers = ["Technician Name", "Jobs Count", "Worked Hours", "Billed Hours", "Efficiency (%)"];
    const rows = hours.data.rows.map((r) => [
      r.name,
      r.jobCount,
      r.workedHours.toFixed(2),
      r.billedHours.toFixed(2),
      r.efficiency !== null ? `${r.efficiency.toFixed(1)}%` : "N/A",
    ]);
    downloadCsvFile(`technician-hours_${from}_to_${to}.csv`, headers, rows);
  };

  const handleOpenPrintModal = () => {
    if (!sales.data) return;
    setPrintConfig({
      type:
        shopTab === "TIRE"
          ? "DAILY_SALES_TIRE"
          : shopTab === "MUFFLER"
            ? "DAILY_SALES_MUFFLER"
            : "DAILY_SALES_ALL",
      title:
        shopTab === "TIRE"
          ? "Tires Shop Sales Report"
          : shopTab === "MUFFLER"
            ? "Mufflers Shop Sales Report"
            : "Consolidated Daily Sales Report",
      data: sales.data,
      dateRange: { from, to },
    });
  };

  return (
    <>
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          title="Reports & Analytics"
          description="View financial performance, daily revenue, separate shop division sales, job margins, and technician efficiency."
        />

        {/* Action Controls: Division Tabs & Export Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Shop Division Tabs */}
          <div className="flex items-center gap-1 rounded-2xl bg-white p-1 shadow-sm border border-slate-200">
            <button
              type="button"
              onClick={() => setShopTab("CONSOLIDATED")}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                shopTab === "CONSOLIDATED"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              🏪 Consolidated
            </button>
            <button
              type="button"
              onClick={() => setShopTab("TIRE")}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                shopTab === "TIRE"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-emerald-700 hover:bg-emerald-50"
              }`}
            >
              <span>🛞</span> Tires Shop
            </button>
            <button
              type="button"
              onClick={() => setShopTab("MUFFLER")}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                shopTab === "MUFFLER"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-blue-700 hover:bg-blue-50"
              }`}
            >
              <span>🔧</span> Mufflers Shop
            </button>
          </div>

          {/* Download & Print Buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportSalesCsv}
              className="gap-1.5 font-bold shadow-xs border-slate-300"
              title="Download spreadsheet report as CSV"
            >
              <Icon name="tag" className="h-4 w-4 text-emerald-600" />
              <span>Download CSV</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleOpenPrintModal}
              className="gap-1.5 font-bold shadow-xs border-slate-300"
              title="Print or Save PDF report"
            >
              <Icon name="printer" className="h-4 w-4 text-slate-700" />
              <span>Print / PDF</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Date Filter Bar */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 mr-1 flex items-center gap-1">
              <Icon name="calendar" className="h-4 w-4 text-slate-400" />
              Date Filter:
            </span>
            {[
              { label: "Today", value: "TODAY" },
              { label: "Yesterday", value: "YESTERDAY" },
              { label: "Last 7 Days", value: "LAST_7" },
              { label: "Last 30 Days", value: "LAST_30" },
              { label: "This Month", value: "THIS_MONTH" },
              { label: "Last Month", value: "LAST_MONTH" },
              { label: "Year to Date", value: "THIS_YEAR" },
              { label: "All Time", value: "ALL_TIME" },
              { label: "Custom Range", value: "CUSTOM" },
            ].map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setDatePreset(p.value as DatePreset)}
                className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                  datePreset === p.value
                    ? "bg-brand-600 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700 border border-slate-200">
              {from} to {to}
            </span>
          </div>
        </div>

        {/* Custom Date Pickers (visible if Custom Range is selected) */}
        {datePreset === "CUSTOM" && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-700">From Date:</span>
              <Input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="text-xs py-1"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-700">To Date:</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="text-xs py-1"
              />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-5 mt-4">
        {can("reports.sales") && (
          <DataState loading={sales.isLoading} error={sales.error}>
            {sales.data && (
              <>
                {/* 1. CONSOLIDATED VIEW */}
                {shopTab === "CONSOLIDATED" && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <StatTile
                        label="Consolidated Net Sales"
                        value={money(sales.data.totals.net)}
                        sub="Excludes sales tax"
                      />
                      <StatTile
                        label="Sales Tax Collected"
                        value={money(sales.data.totals.tax)}
                        sub="Liability tracked"
                      />
                      <StatTile
                        label="Invoiced Gross (Both Shops)"
                        value={money(sales.data.totals.gross)}
                        sub={`${sales.data.totals.count ?? sales.data.days.reduce((s, d) => s + d.count, 0)} total tickets`}
                      />
                    </div>

                    {/* Side-by-Side Shop Breakdown Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                      {/* Tires Shop Card */}
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-xs">
                        <div className="flex items-center justify-between border-b border-emerald-200/60 pb-2 mb-3">
                          <span className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wider text-emerald-900">
                            <span>🛞</span> Tires Shop Revenue
                          </span>
                          <button
                            type="button"
                            onClick={() => setShopTab("TIRE")}
                            className="text-xs font-bold text-emerald-700 underline hover:text-emerald-900"
                          >
                            View details →
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-xs font-medium text-slate-500">Net Sales</span>
                            <p className="text-xl font-black tabular-nums text-slate-900">
                              {money(tireData?.totals.net ?? 0)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500">Gross Sales</span>
                            <p className="text-xl font-black tabular-nums text-slate-900">
                              {money(tireData?.totals.gross ?? 0)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500">Sales Tax</span>
                            <p className="text-sm font-bold tabular-nums text-slate-600">
                              {money(tireData?.totals.tax ?? 0)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500">Invoices & Items</span>
                            <p className="text-sm font-bold text-slate-700">
                              {tireData?.totals.invoiceCount ?? 0} inv · {tireData?.totals.lineCount ?? 0} items
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Mufflers Shop Card */}
                      <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-4 shadow-xs">
                        <div className="flex items-center justify-between border-b border-blue-200/60 pb-2 mb-3">
                          <span className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wider text-blue-900">
                            <span>🔧</span> Mufflers Shop Revenue
                          </span>
                          <button
                            type="button"
                            onClick={() => setShopTab("MUFFLER")}
                            className="text-xs font-bold text-blue-700 underline hover:text-blue-900"
                          >
                            View details →
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-xs font-medium text-slate-500">Net Sales</span>
                            <p className="text-xl font-black tabular-nums text-slate-900">
                              {money(mufflerData?.totals.net ?? 0)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500">Gross Sales</span>
                            <p className="text-xl font-black tabular-nums text-slate-900">
                              {money(mufflerData?.totals.gross ?? 0)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500">Sales Tax</span>
                            <p className="text-sm font-bold tabular-nums text-slate-600">
                              {money(mufflerData?.totals.tax ?? 0)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500">Invoices & Items</span>
                            <p className="text-sm font-bold text-slate-700">
                              {mufflerData?.totals.invoiceCount ?? 0} inv · {mufflerData?.totals.lineCount ?? 0} items
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <Card
                      title="Consolidated Daily Sales (Both Shops)"
                      className="mt-4"
                      action={
                        <Button variant="secondary" size="sm" onClick={handleExportSalesCsv} className="text-xs gap-1">
                          <Icon name="tag" className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Export Daily CSV</span>
                        </Button>
                      }
                    >
                      <div className="mb-3">
                        <Notice>
                          Basis: {sales.data.basis}. {sales.data.note}
                        </Notice>
                      </div>
                      <DataState
                        empty={sales.data.days.length === 0}
                        emptyMessage="No invoices issued in this period."
                      >
                        <Table headers={["Date", "Invoices", "Net sales", "Tax", "Gross"]}>
                          {sales.data.days.map((d) => (
                            <tr key={d.date}>
                              <td className="px-3 py-2 font-mono text-xs">{dateOnly(d.date)}</td>
                              <td className="px-3 py-2 tabular-nums text-slate-600 font-semibold">{d.count}</td>
                              <td className="px-3 py-2 tabular-nums font-mono">{money(d.net)}</td>
                              <td className="px-3 py-2 tabular-nums text-slate-600 font-mono">{money(d.tax)}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-slate-900">
                                {money(d.gross)}
                              </td>
                            </tr>
                          ))}
                        </Table>
                      </DataState>
                    </Card>
                  </>
                )}

                {/* 2. TIRES SHOP SEPARATE REPORT */}
                {shopTab === "TIRE" && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-4">
                      <StatTile
                        label="🛞 Tires Net Sales"
                        value={money(tireData?.totals.net ?? 0)}
                        sub="Tires & tire services"
                        tone="good"
                      />
                      <StatTile
                        label="Tires Sales Tax"
                        value={money(tireData?.totals.tax ?? 0)}
                        sub="Liability tracked"
                      />
                      <StatTile
                        label="Tires Invoiced Gross"
                        value={money(tireData?.totals.gross ?? 0)}
                      />
                      <StatTile
                        label="Total Activity"
                        value={`${tireData?.totals.invoiceCount ?? 0} Invoices`}
                        sub={`${tireData?.totals.lineCount ?? 0} items & services`}
                      />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
                      {/* Daily Trend */}
                      <Card title="🛞 Tires Shop Daily Sales Trend">
                        <DataState
                          empty={!tireData?.days.length}
                          emptyMessage="No tire sales in this period."
                        >
                          <Table headers={["Date", "Tire Invoices", "Net Sales", "Gross"]}>
                            {tireData?.days.map((d) => (
                              <tr key={d.date}>
                                <td className="px-3 py-2 font-mono text-xs">{dateOnly(d.date)}</td>
                                <td className="px-3 py-2 tabular-nums text-slate-600 font-semibold">{d.count}</td>
                                <td className="px-3 py-2 tabular-nums font-mono font-semibold text-emerald-800">
                                  {money(d.net)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-slate-900">
                                  {money(d.gross)}
                                </td>
                              </tr>
                            ))}
                          </Table>
                        </DataState>
                      </Card>

                      {/* Top Selling Items */}
                      <Card title="Top Selling Tires & Services">
                        <DataState
                          empty={!tireData?.items.length}
                          emptyMessage="No tire products sold in this period."
                        >
                          <Table headers={["Description", "Type", "Qty", "Revenue"]}>
                            {tireData?.items.map((it) => (
                              <tr key={it.description}>
                                <td className="px-3 py-2 font-medium text-slate-900">{it.description}</td>
                                <td className="px-3 py-2 text-xs text-slate-500 font-mono">{it.lineType}</td>
                                <td className="px-3 py-2 tabular-nums text-slate-700 font-bold">{it.quantity}</td>
                                <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-emerald-800">
                                  {money(it.lineTotal)}
                                </td>
                              </tr>
                            ))}
                          </Table>
                        </DataState>
                      </Card>
                    </div>

                    {/* Invoices List */}
                    <Card
                      title="Tires Shop Invoices"
                      action={
                        <Button variant="secondary" size="sm" onClick={handleExportSalesCsv} className="text-xs gap-1">
                          <Icon name="tag" className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Export Tire Invoices CSV</span>
                        </Button>
                      }
                    >
                      <DataState
                        empty={!tireData?.invoices.length}
                        emptyMessage="No tire invoices in this period."
                      >
                        <Table headers={["Invoice #", "Customer", "Date", "Items", "Tires Total", ""]}>
                          {tireData?.invoices.map((inv) => (
                            <tr key={inv.id}>
                              <td className="px-3 py-2">
                                <Link
                                  to={`/receipts/${inv.id}`}
                                  className="font-mono text-xs text-brand-700 font-bold hover:underline"
                                >
                                  {inv.number}
                                </Link>
                              </td>
                              <td className="px-3 py-2 text-slate-700 font-medium">{inv.customer}</td>
                              <td className="px-3 py-2 text-slate-500 text-xs font-mono">{dateOnly(inv.issuedAt)}</td>
                              <td className="px-3 py-2 text-xs text-slate-600">
                                {inv.lines.map((l) => `${l.quantity}x ${l.description}`).join(", ")}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-slate-900">
                                {money(inv.total)}
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
                          ))}
                        </Table>
                      </DataState>
                    </Card>
                  </>
                )}

                {/* 3. MUFFLERS SHOP SEPARATE REPORT */}
                {shopTab === "MUFFLER" && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-4">
                      <StatTile
                        label="🔧 Mufflers Net Sales"
                        value={money(mufflerData?.totals.net ?? 0)}
                        sub="Exhaust & muffler services"
                        tone="good"
                      />
                      <StatTile
                        label="Mufflers Sales Tax"
                        value={money(mufflerData?.totals.tax ?? 0)}
                        sub="Liability tracked"
                      />
                      <StatTile
                        label="Mufflers Invoiced Gross"
                        value={money(mufflerData?.totals.gross ?? 0)}
                      />
                      <StatTile
                        label="Total Activity"
                        value={`${mufflerData?.totals.invoiceCount ?? 0} Invoices`}
                        sub={`${mufflerData?.totals.lineCount ?? 0} items & services`}
                      />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
                      {/* Daily Trend */}
                      <Card title="🔧 Mufflers Shop Daily Sales Trend">
                        <DataState
                          empty={!mufflerData?.days.length}
                          emptyMessage="No muffler sales in this period."
                        >
                          <Table headers={["Date", "Muffler Invoices", "Net Sales", "Gross"]}>
                            {mufflerData?.days.map((d) => (
                              <tr key={d.date}>
                                <td className="px-3 py-2 font-mono text-xs">{dateOnly(d.date)}</td>
                                <td className="px-3 py-2 tabular-nums text-slate-600 font-semibold">{d.count}</td>
                                <td className="px-3 py-2 tabular-nums font-mono font-semibold text-blue-800">
                                  {money(d.net)}
                                </td>
                                <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-slate-900">
                                  {money(d.gross)}
                                </td>
                              </tr>
                            ))}
                          </Table>
                        </DataState>
                      </Card>

                      {/* Top Selling Items */}
                      <Card title="Top Selling Mufflers & Exhaust Services">
                        <DataState
                          empty={!mufflerData?.items.length}
                          emptyMessage="No muffler products sold in this period."
                        >
                          <Table headers={["Description", "Type", "Qty", "Revenue"]}>
                            {mufflerData?.items.map((it) => (
                              <tr key={it.description}>
                                <td className="px-3 py-2 font-medium text-slate-900">{it.description}</td>
                                <td className="px-3 py-2 text-xs text-slate-500 font-mono">{it.lineType}</td>
                                <td className="px-3 py-2 tabular-nums text-slate-700 font-bold">{it.quantity}</td>
                                <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-blue-800">
                                  {money(it.lineTotal)}
                                </td>
                              </tr>
                            ))}
                          </Table>
                        </DataState>
                      </Card>
                    </div>

                    {/* Invoices List */}
                    <Card
                      title="Mufflers Shop Invoices"
                      action={
                        <Button variant="secondary" size="sm" onClick={handleExportSalesCsv} className="text-xs gap-1">
                          <Icon name="tag" className="h-3.5 w-3.5 text-blue-600" />
                          <span>Export Muffler Invoices CSV</span>
                        </Button>
                      }
                    >
                      <DataState
                        empty={!mufflerData?.invoices.length}
                        emptyMessage="No muffler invoices in this period."
                      >
                        <Table headers={["Invoice #", "Customer", "Date", "Items", "Mufflers Total", ""]}>
                          {mufflerData?.invoices.map((inv) => (
                            <tr key={inv.id}>
                              <td className="px-3 py-2">
                                <Link
                                  to={`/receipts/${inv.id}`}
                                  className="font-mono text-xs text-brand-700 font-bold hover:underline"
                                >
                                  {inv.number}
                                </Link>
                              </td>
                              <td className="px-3 py-2 text-slate-700 font-medium">{inv.customer}</td>
                              <td className="px-3 py-2 text-slate-500 text-xs font-mono">{dateOnly(inv.issuedAt)}</td>
                              <td className="px-3 py-2 text-xs text-slate-600">
                                {inv.lines.map((l) => `${l.quantity}x ${l.description}`).join(", ")}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-slate-900">
                                {money(inv.total)}
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
                          ))}
                        </Table>
                      </DataState>
                    </Card>
                  </>
                )}
              </>
            )}
          </DataState>
        )}

        {/* Cost & Margin Section */}
        {can("reports.costs") ? (
          <>
            <Card
              title="Job Margins"
              action={
                <Button variant="secondary" size="sm" onClick={handleExportMarginsCsv} className="text-xs gap-1">
                  <Icon name="tag" className="h-3.5 w-3.5 text-teal-600" />
                  <span>Export Margins CSV</span>
                </Button>
              }
            >
              <DataState
                loading={margins.isLoading}
                error={margins.error}
                empty={margins.data?.rows.length === 0}
                emptyMessage="No invoiced jobs in this period."
              >
                {margins.data && margins.data.flaggedCount > 0 && (
                  <div className="mb-3">
                    <Notice tone="warn">
                      {margins.data.flaggedCount} job(s) have provisional or missing costs. Those
                      margins are not final. {margins.data.note}
                    </Notice>
                  </div>
                )}
                <Table
                  headers={["Job", "Customer", "Net sales", "Parts", "Labor", "Gross profit", "Margin", ""]}
                >
                  {margins.data?.rows.map((r) => (
                    <tr key={r.id} className={r.missingCosts ? "bg-amber-50/50" : ""}>
                      <td className="px-3 py-2">
                        <Link to={`/jobs/${r.id}`} className="font-mono text-xs text-teal-700 hover:underline">
                          {r.number}
                        </Link>
                        <div className="text-xs text-slate-500">{r.vehicle}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600 font-medium">{r.customer}</td>
                      <td className="px-3 py-2 tabular-nums font-mono">{money(r.netSales)}</td>
                      <td className="px-3 py-2 tabular-nums font-mono text-slate-600">
                        {money(r.partsCost)}
                      </td>
                      <td className="px-3 py-2 tabular-nums font-mono text-slate-600">
                        {money(r.laborCost)}
                      </td>
                      <td className="px-3 py-2 tabular-nums font-mono font-bold text-slate-900">
                        {money(r.grossProfit)}
                      </td>
                      <td className="px-3 py-2 tabular-nums font-mono font-semibold text-emerald-700">
                        {percent(r.grossMarginPct)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        {r.missingCosts && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                            costs incomplete
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </Table>
              </DataState>
            </Card>

            <Card
              title="Technician Billed Versus Worked Hours"
              action={
                <Button variant="secondary" size="sm" onClick={handleExportHoursCsv} className="text-xs gap-1">
                  <Icon name="tag" className="h-3.5 w-3.5 text-blue-600" />
                  <span>Export Hours CSV</span>
                </Button>
              }
            >
              <DataState
                loading={hours.isLoading}
                error={hours.error}
                empty={hours.data?.rows.length === 0}
                emptyMessage="No time logged in this period."
              >
                <Table headers={["Technician", "Jobs", "Worked hours", "Billed hours", "Efficiency"]}>
                  {hours.data?.rows.map((r) => (
                    <tr key={r.technicianId}>
                      <td className="px-3 py-2 font-medium text-slate-900">{r.name}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-600 font-semibold">{r.jobCount}</td>
                      <td className="px-3 py-2 tabular-nums font-mono">{r.workedHours.toFixed(2)}h</td>
                      <td className="px-3 py-2 tabular-nums font-mono font-semibold text-slate-800">{r.billedHours.toFixed(2)}h</td>
                      <td className="px-3 py-2 tabular-nums font-mono font-bold text-teal-800">
                        {percent(r.efficiency)}
                      </td>
                    </tr>
                  ))}
                </Table>
              </DataState>
            </Card>
          </>
        ) : (
          <Notice tone="warn">
            Cost and margin reports are restricted to owners, managers and bookkeepers.
          </Notice>
        )}
      </div>

      {/* Print Report Modal */}
      {printConfig && (
        <PrintReportModal config={printConfig} onClose={() => setPrintConfig(null)} />
      )}
    </>
  );
}
