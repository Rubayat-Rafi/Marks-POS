import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { dateOnly, money, percent } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { Card, DataState, Notice, StatTile, Table, Button, Input } from "../components/ui";
import { Icon } from "../components/Icon";
import { PrintReportModal, type PrintReportConfig } from "../features/finance/FinancePrintReports";
import { SHOP_PALETTES } from "../lib/shopColors";
import { DepartmentBadge } from "../components/DepartmentBadge";

type ShopBreakdown = {
  shopName: string;
  totals: {
    net: number;
    tax: number;
    gross: number;
    invoiceCount: number;
    lineCount: number;
    cashCollected?: number | null;
    paymentsCount?: number;
  };
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

type DailySalesInvoice = {
  id: string;
  number: string;
  customer: string;
  issuedAt: string;
  net: number;
  tax: number;
  total: number;
  status?: string;
  department?: "TIRE" | "MUFFLER" | "BOTH";
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    taxAmount: number;
    lineType?: string;
    department?: string;
  }>;
};

type DailySales = {
  basis: string;
  note: string;
  days: Array<{ date: string; net: number; tax: number; gross: number; count: number }>;
  totals: {
    net: number;
    tax: number;
    gross: number;
    count?: number;
    cashCollected?: number | null;
    paymentsCount?: number;
  };
  invoices?: DailySalesInvoice[];
  items?: Array<{ description: string; quantity: number; lineTotal: number; taxAmount: number; lineType: string }>;
  tireShop?: ShopBreakdown;
  mufflersShop?: ShopBreakdown;
};

type JobMargins = {
  rows: Array<{
    id: string;
    number: string;
    customer: string;
    vehicle: string;
    department?: "TIRE" | "MUFFLER";
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
    tireWorkedHours?: number;
    tireBilledHours?: number;
    tireJobCount?: number;
    tireEfficiency?: number | null;
    mufflerWorkedHours?: number;
    mufflerBilledHours?: number;
    mufflerJobCount?: number;
    mufflerEfficiency?: number | null;
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

function toShopDateString(d: Date, timeZone = "America/Chicago"): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

function computePresetDates(preset: DatePreset, timeZone = "America/Chicago"): { from: string; to: string } {
  const now = new Date();
  const todayStr = toShopDateString(now, timeZone);

  switch (preset) {
    case "TODAY":
      return { from: todayStr, to: todayStr };
    case "YESTERDAY": {
      const yest = new Date(now.getTime() - 86_400_000);
      const s = toShopDateString(yest, timeZone);
      return { from: s, to: s };
    }
    case "LAST_7": {
      const d7 = new Date(now.getTime() - 7 * 86_400_000);
      return { from: toShopDateString(d7, timeZone), to: todayStr };
    }
    case "LAST_30": {
      const d30 = new Date(now.getTime() - 30 * 86_400_000);
      return { from: toShopDateString(d30, timeZone), to: todayStr };
    }
    case "THIS_MONTH": {
      const ym = todayStr.slice(0, 7);
      return { from: `${ym}-01`, to: todayStr };
    }
    case "LAST_MONTH": {
      const [y, m] = todayStr.split("-").map(Number);
      const prevDate = new Date(y, m - 2, 1);
      const lastMonthStr = toShopDateString(prevDate, timeZone).slice(0, 7);
      const lastDayOfPrevMonth = new Date(y, m - 1, 0).getDate();
      return { from: `${lastMonthStr}-01`, to: `${lastMonthStr}-${String(lastDayOfPrevMonth).padStart(2, "0")}` };
    }
    case "THIS_YEAR": {
      const yr = todayStr.slice(0, 4);
      return { from: `${yr}-01-01`, to: todayStr };
    }
    case "ALL_TIME": {
      return { from: "2020-01-01", to: todayStr };
    }
    case "CUSTOM":
    default: {
      return { from: todayStr, to: todayStr };
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
  const { user, can } = useAuth();
  const shopTimezone = user?.organization?.timezone || "America/Chicago";
  const [searchParams, setSearchParams] = useSearchParams();
  const shopParam = (searchParams.get("shop") || "").toUpperCase();
  const initialTab: "CONSOLIDATED" | "TIRE" | "MUFFLER" =
    shopParam === "TIRE" ? "TIRE" : shopParam === "MUFFLER" ? "MUFFLER" : "CONSOLIDATED";
  const [shopTab, setShopTabState] = useState<"CONSOLIDATED" | "TIRE" | "MUFFLER">(initialTab);

  const setShopTab = (tab: "CONSOLIDATED" | "TIRE" | "MUFFLER") => {
    setShopTabState(tab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "CONSOLIDATED") next.delete("shop");
        else next.set("shop", tab.toLowerCase());
        return next;
      },
      { replace: true }
    );
  };

  // Date Filtering State (defaults to TODAY in shop timezone)
  const [datePreset, setDatePreset] = useState<DatePreset>(() => {
    const presetParam = (searchParams.get("preset") || "").toUpperCase() as DatePreset;
    const validPresets: DatePreset[] = [
      "TODAY",
      "YESTERDAY",
      "LAST_7",
      "LAST_30",
      "THIS_MONTH",
      "LAST_MONTH",
      "THIS_YEAR",
      "ALL_TIME",
      "CUSTOM",
    ];
    return validPresets.includes(presetParam) ? presetParam : "TODAY";
  });
  const [customFrom, setCustomFrom] = useState(() => toShopDateString(new Date(), shopTimezone));
  const [customTo, setCustomTo] = useState(() => toShopDateString(new Date(), shopTimezone));

  // Active Date Bounds respecting shop's operational timezone
  const { from, to } = useMemo(() => {
    if (datePreset === "CUSTOM") {
      return {
        from: customFrom || toShopDateString(new Date(), shopTimezone),
        to: customTo || toShopDateString(new Date(), shopTimezone),
      };
    }
    return computePresetDates(datePreset, shopTimezone);
  }, [datePreset, customFrom, customTo, shopTimezone]);

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

  // Filtered Job Margins based on selected Shop
  const filteredMarginsRows = useMemo(() => {
    if (!margins.data?.rows) return [];
    if (shopTab === "CONSOLIDATED") return margins.data.rows;
    return margins.data.rows.filter((r) => r.department === shopTab);
  }, [margins.data?.rows, shopTab]);

  const marginsSummary = useMemo(() => {
    const net = filteredMarginsRows.reduce((s, r) => s + r.netSales, 0);
    const parts = filteredMarginsRows.reduce((s, r) => s + r.partsCost, 0);
    const labor = filteredMarginsRows.reduce((s, r) => s + r.laborCost, 0);
    const cost = filteredMarginsRows.reduce((s, r) => s + r.directCost, 0);
    const profit = net - cost;
    const margin = net > 0 ? (profit / net) * 100 : null;
    const flagged = filteredMarginsRows.filter((r) => r.missingCosts).length;
    return { net, parts, labor, cost, profit, margin, flagged, count: filteredMarginsRows.length };
  }, [filteredMarginsRows]);

  // Filtered Technician Hours based on selected Shop
  const filteredHoursRows = useMemo(() => {
    if (!hours.data?.rows) return [];
    if (shopTab === "CONSOLIDATED") return hours.data.rows;
    if (shopTab === "TIRE") {
      return hours.data.rows
        .filter((r) => (r.tireJobCount ?? 0) > 0 || (r.tireWorkedHours ?? 0) > 0)
        .map((r) => ({
          technicianId: r.technicianId,
          name: r.name,
          workedHours: r.tireWorkedHours ?? 0,
          billedHours: r.tireBilledHours ?? 0,
          jobCount: r.tireJobCount ?? 0,
          efficiency: r.tireEfficiency ?? null,
        }));
    }
    return hours.data.rows
      .filter((r) => (r.mufflerJobCount ?? 0) > 0 || (r.mufflerWorkedHours ?? 0) > 0)
      .map((r) => ({
        technicianId: r.technicianId,
        name: r.name,
        workedHours: r.mufflerWorkedHours ?? 0,
        billedHours: r.mufflerBilledHours ?? 0,
        jobCount: r.mufflerJobCount ?? 0,
        efficiency: r.mufflerEfficiency ?? null,
      }));
  }, [hours.data?.rows, shopTab]);

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
    if (!filteredMarginsRows.length) return;
    const headers = [
      "Job Number",
      "Customer",
      "Vehicle",
      "Department",
      "Net Sales ($)",
      "Parts Cost ($)",
      "Labor Cost ($)",
      "Direct Cost ($)",
      "Gross Profit ($)",
      "Gross Margin (%)",
    ];
    const rows = filteredMarginsRows.map((r) => [
      r.number,
      r.customer,
      r.vehicle,
      r.department ?? "OTHER",
      (r.netSales / 100).toFixed(2),
      (r.partsCost / 100).toFixed(2),
      (r.laborCost / 100).toFixed(2),
      (r.directCost / 100).toFixed(2),
      (r.grossProfit / 100).toFixed(2),
      r.grossMarginPct !== null ? `${r.grossMarginPct.toFixed(1)}%` : "N/A",
    ]);
    const prefix = shopTab === "TIRE" ? "tires-shop" : shopTab === "MUFFLER" ? "mufflers-shop" : "consolidated";
    downloadCsvFile(`${prefix}-job-margins_${from}_to_${to}.csv`, headers, rows);
  };

  const handleExportHoursCsv = () => {
    if (!filteredHoursRows.length) return;
    const headers = ["Technician Name", "Jobs Count", "Worked Hours", "Billed Hours", "Efficiency (%)"];
    const rows = filteredHoursRows.map((r) => [
      r.name,
      r.jobCount,
      r.workedHours.toFixed(2),
      r.billedHours.toFixed(2),
      r.efficiency !== null ? `${r.efficiency.toFixed(1)}%` : "N/A",
    ]);
    const prefix = shopTab === "TIRE" ? "tires-shop" : shopTab === "MUFFLER" ? "mufflers-shop" : "consolidated";
    downloadCsvFile(`${prefix}-technician-hours_${from}_to_${to}.csv`, headers, rows);
  };

  const handlePrintSpecific = (targetShop: "CONSOLIDATED" | "TIRE" | "MUFFLER") => {
    if (!sales.data) return;
    setPrintConfig({
      type:
        targetShop === "TIRE"
          ? "DAILY_SALES_TIRE"
          : targetShop === "MUFFLER"
            ? "DAILY_SALES_MUFFLER"
            : "DAILY_SALES_ALL",
      title:
        targetShop === "TIRE"
          ? "Tires Shop Sales Report"
          : targetShop === "MUFFLER"
            ? "Mufflers Shop Sales Report"
            : "Consolidated Daily Sales Report",
      data: sales.data,
      dateRange: { from, to },
    });
  };

  const handleOpenPrintModal = () => {
    handlePrintSpecific(shopTab);
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
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                shopTab === "CONSOLIDATED"
                  ? SHOP_PALETTES.ALL.activeTabClass
                  : SHOP_PALETTES.ALL.inactiveTabClass
              }`}
            >
              <Icon name="store" className="h-3.5 w-3.5" /> All Shops (Combined)
            </button>
            <button
              type="button"
              onClick={() => setShopTab("TIRE")}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                shopTab === "TIRE"
                  ? SHOP_PALETTES.TIRE.activeTabClass
                  : SHOP_PALETTES.TIRE.inactiveTabClass
              }`}
            >
              <Icon name="tire" className="h-3.5 w-3.5" /> Tires Shop
            </button>
            <button
              type="button"
              onClick={() => setShopTab("MUFFLER")}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                shopTab === "MUFFLER"
                  ? SHOP_PALETTES.MUFFLER.activeTabClass
                  : SHOP_PALETTES.MUFFLER.inactiveTabClass
              }`}
            >
              <Icon name="pipe" className="h-3.5 w-3.5" /> Mufflers Shop
            </button>
          </div>

          {/* Print / Save PDF Action Group */}
          <div className="flex flex-wrap items-center gap-1.5">
            {shopTab === "CONSOLIDATED" ? (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handlePrintSpecific("CONSOLIDATED")}
                  className="gap-1.5 font-bold shadow-xs bg-brand-600 hover:bg-brand-700 text-white"
                  title="Print or Save Combined PDF Report"
                >
                  <Icon name="printer" className="h-4 w-4" />
                  <span>Print Combined Report (PDF)</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handlePrintSpecific("TIRE")}
                  className="gap-1.5 font-bold border-emerald-300 text-emerald-800 hover:bg-emerald-50"
                  title="Print or Save Tires Shop Report"
                >
                  <span>🛞</span>
                  <span>Tires PDF</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handlePrintSpecific("MUFFLER")}
                  className="gap-1.5 font-bold border-orange-300 text-orange-800 hover:bg-orange-50"
                  title="Print or Save Mufflers Shop Report"
                >
                  <span>🔧</span>
                  <span>Mufflers PDF</span>
                </Button>
              </>
            ) : shopTab === "TIRE" ? (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handlePrintSpecific("TIRE")}
                  className="gap-1.5 font-bold shadow-xs bg-emerald-700 hover:bg-emerald-800 text-white"
                  title="Print or Save Tires Shop PDF Report"
                >
                  <Icon name="printer" className="h-4 w-4" />
                  <span>🛞 Print Tires Sales Report (PDF)</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handlePrintSpecific("CONSOLIDATED")}
                  className="gap-1.5 font-bold text-slate-700 hover:bg-slate-100"
                  title="Print or Save Combined PDF Report"
                >
                  <span>Combined PDF</span>
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handlePrintSpecific("MUFFLER")}
                  className="gap-1.5 font-bold shadow-xs bg-orange-600 hover:bg-orange-700 text-white"
                  title="Print or Save Mufflers Shop PDF Report"
                >
                  <Icon name="printer" className="h-4 w-4" />
                  <span>🔧 Print Mufflers Sales Report (PDF)</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handlePrintSpecific("CONSOLIDATED")}
                  className="gap-1.5 font-bold text-slate-700 hover:bg-slate-100"
                  title="Print or Save Combined PDF Report"
                >
                  <span>Combined PDF</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Active Shop Filter Banner */}
      {shopTab !== "CONSOLIDATED" && (
        <div
          className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-2.5 ${
            shopTab === "TIRE"
              ? SHOP_PALETTES.TIRE.bannerClass
              : SHOP_PALETTES.MUFFLER.bannerClass
          }`}
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-black uppercase tracking-wider ${
                shopTab === "TIRE"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-orange-600 text-white shadow-xs"
              }`}
            >
              <span>{shopTab === "TIRE" ? "🛞" : "🔧"}</span>
              {shopTab === "TIRE" ? "Tires Shop Reports Only" : "Mufflers Shop Reports Only"}
            </span>
            <span className="text-xs font-medium text-slate-600">
              Showing sales, margins, invoices, and technician hours exclusively for {shopTab === "TIRE" ? "Tires Shop" : "Mufflers Shop"}.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShopTab("CONSOLIDATED")}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
              shopTab === "TIRE"
                ? "text-emerald-800 hover:bg-emerald-100/60"
                : "text-orange-900 hover:bg-orange-100/60"
            }`}
          >
            ✕ Show All Shops (Combined)
          </button>
        </div>
      )}

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
            <span className="text-[11px] text-slate-400 font-medium">({shopTimezone})</span>
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
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <StatTile
                        label="Cash Collected (Payments)"
                        value={
                          sales.data.totals.cashCollected !== null &&
                          sales.data.totals.cashCollected !== undefined
                            ? money(sales.data.totals.cashCollected)
                            : "—"
                        }
                        sub={`${sales.data.totals.paymentsCount ?? 0} payments (Cash Basis)`}
                        tone="good"
                      />
                      <StatTile
                        label="Consolidated Net Sales"
                        value={money(sales.data.totals.net)}
                        sub="Excludes sales tax (Accrual)"
                      />
                      <StatTile
                        label="Sales Tax Tracked"
                        value={money(sales.data.totals.tax)}
                        sub="Tax remittance liability"
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
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handlePrintSpecific("TIRE")}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 hover:bg-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-800 transition shadow-2xs"
                              title="Print Tires Shop Report"
                            >
                              <Icon name="printer" className="h-3.5 w-3.5 text-emerald-700" />
                              Print Tires PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => setShopTab("TIRE")}
                              className="text-xs font-bold text-emerald-700 underline hover:text-emerald-900"
                            >
                              Details →
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-xs font-medium text-slate-500">Cash Collected</span>
                            <p className="text-xl font-black tabular-nums text-emerald-800">
                              {tireData?.totals.cashCollected !== null && tireData?.totals.cashCollected !== undefined
                                ? money(tireData.totals.cashCollected)
                                : "—"}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500">Gross Invoiced</span>
                            <p className="text-xl font-black tabular-nums text-slate-900">
                              {money(tireData?.totals.gross ?? 0)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500">Net Sales</span>
                            <p className="text-sm font-bold tabular-nums text-slate-600">
                              {money(tireData?.totals.net ?? 0)}
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
                      <div className="rounded-2xl border border-orange-200 bg-gradient-to-b from-orange-50/50 to-white p-4 shadow-xs">
                        <div className="flex items-center justify-between border-b border-orange-200/60 pb-2 mb-3">
                          <span className="flex items-center gap-1.5 text-sm font-extrabold uppercase tracking-wider text-orange-950">
                            <span>🔧</span> Mufflers Shop Revenue
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handlePrintSpecific("MUFFLER")}
                              className="inline-flex items-center gap-1 rounded-lg bg-orange-100 hover:bg-orange-200 px-2.5 py-1 text-xs font-bold text-orange-900 transition shadow-2xs"
                              title="Print Mufflers Shop Report"
                            >
                              <Icon name="printer" className="h-3.5 w-3.5 text-orange-700" />
                              Print Mufflers PDF
                            </button>
                            <button
                              type="button"
                              onClick={() => setShopTab("MUFFLER")}
                              className="text-xs font-bold text-orange-700 underline hover:text-orange-900"
                            >
                              Details →
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <span className="text-xs font-medium text-slate-500">Cash Collected</span>
                            <p className="text-xl font-black tabular-nums text-orange-800">
                              {mufflerData?.totals.cashCollected !== null && mufflerData?.totals.cashCollected !== undefined
                                ? money(mufflerData.totals.cashCollected)
                                : "—"}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500">Gross Invoiced</span>
                            <p className="text-xl font-black tabular-nums text-slate-900">
                              {money(mufflerData?.totals.gross ?? 0)}
                            </p>
                          </div>
                          <div>
                            <span className="text-xs font-medium text-slate-500">Net Sales</span>
                            <p className="text-sm font-bold tabular-nums text-slate-600">
                              {money(mufflerData?.totals.net ?? 0)}
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
                      title="Consolidated Daily Sales Trend (Both Shops)"
                      className="mt-4"
                      action={
                        <Button variant="secondary" size="sm" onClick={handleOpenPrintModal} className="text-xs gap-1 font-bold">
                          <Icon name="printer" className="h-3.5 w-3.5 text-slate-700" />
                          <span>Print / Save PDF</span>
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

                    {/* Consolidated Invoices & Receipts */}
                    <Card
                      title={`Consolidated Invoices & Receipts (${sales.data.invoices?.length ?? sales.data.totals.count ?? 0})`}
                      className="mt-4"
                      action={
                        <Button variant="secondary" size="sm" onClick={handleOpenPrintModal} className="text-xs gap-1 font-bold">
                          <Icon name="printer" className="h-3.5 w-3.5 text-slate-700" />
                          <span>Print / Save PDF</span>
                        </Button>
                      }
                    >
                      <DataState
                        empty={!sales.data.invoices?.length}
                        emptyMessage="No invoices issued in this period."
                      >
                        <Table headers={["Invoice #", "Customer", "Division", "Date", "Items & Services", "Total", ""]}>
                          {sales.data.invoices?.map((inv) => (
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
                              <td className="px-3 py-2">
                                {inv.department === "MUFFLER" ? (
                                  <DepartmentBadge department="MUFFLER" size="xs" />
                                ) : inv.department === "BOTH" ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800">
                                    🛞 / 🔧 Both
                                  </span>
                                ) : (
                                  <DepartmentBadge department="TIRE" size="xs" />
                                )}
                              </td>
                              <td className="px-3 py-2 text-slate-500 text-xs font-mono">{dateOnly(inv.issuedAt)}</td>
                              <td className="px-3 py-2 text-xs text-slate-600 max-w-[260px] truncate">
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

                {/* 2. TIRES SHOP SEPARATE REPORT */}
                {shopTab === "TIRE" && (
                  <>
                    <div className="grid gap-4 sm:grid-cols-4">
                      <StatTile
                        label="🛞 Tires Cash Collected"
                        value={
                          tireData?.totals.cashCollected !== null && tireData?.totals.cashCollected !== undefined
                            ? money(tireData.totals.cashCollected)
                            : "—"
                        }
                        sub={`${tireData?.totals.paymentsCount ?? 0} payments received`}
                        tone="good"
                      />
                      <StatTile
                        label="Tires Net Sales"
                        value={money(tireData?.totals.net ?? 0)}
                        sub="Tires & tire services (Net)"
                      />
                      <StatTile
                        label="Tires Invoiced Gross"
                        value={money(tireData?.totals.gross ?? 0)}
                        sub={`Incl. ${money(tireData?.totals.tax ?? 0)} tax`}
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
                        <Button variant="secondary" size="sm" onClick={() => handlePrintSpecific("TIRE")} className="text-xs gap-1 font-bold text-emerald-800 border-emerald-300 hover:bg-emerald-50">
                          <Icon name="printer" className="h-3.5 w-3.5 text-emerald-700" />
                          <span>Print Tires Report (PDF)</span>
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
                        label="🔧 Mufflers Cash Collected"
                        value={
                          mufflerData?.totals.cashCollected !== null && mufflerData?.totals.cashCollected !== undefined
                            ? money(mufflerData.totals.cashCollected)
                            : "—"
                        }
                        sub={`${mufflerData?.totals.paymentsCount ?? 0} payments received`}
                        tone="good"
                      />
                      <StatTile
                        label="Mufflers Net Sales"
                        value={money(mufflerData?.totals.net ?? 0)}
                        sub="Exhaust & muffler services (Net)"
                      />
                      <StatTile
                        label="Mufflers Invoiced Gross"
                        value={money(mufflerData?.totals.gross ?? 0)}
                        sub={`Incl. ${money(mufflerData?.totals.tax ?? 0)} tax`}
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
                                <td className="px-3 py-2 tabular-nums font-mono font-semibold text-orange-800">
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
                                <td className="px-3 py-2 text-right tabular-nums font-mono font-bold text-orange-800">
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
                        <Button variant="secondary" size="sm" onClick={() => handlePrintSpecific("MUFFLER")} className="text-xs gap-1 font-bold text-orange-900 border-orange-300 hover:bg-orange-50">
                          <Icon name="printer" className="h-3.5 w-3.5 text-orange-700" />
                          <span>Print Mufflers Report (PDF)</span>
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
              title={
                shopTab === "CONSOLIDATED"
                  ? "Consolidated Job Margins (Both Shops)"
                  : shopTab === "TIRE"
                  ? "🛞 Tires Shop Job Margins"
                  : "🔧 Mufflers Shop Job Margins"
              }
            >
              {filteredMarginsRows.length > 0 && (
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Jobs Invoiced</span>
                    <p className="text-lg font-black text-slate-900">{marginsSummary.count} jobs</p>
                  </div>
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Net Sales</span>
                    <p className="text-lg font-black text-slate-900">{money(marginsSummary.net)}</p>
                  </div>
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Gross Profit</span>
                    <p className="text-lg font-black text-slate-900">{money(marginsSummary.profit)}</p>
                  </div>
                  <div>
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Avg Gross Margin</span>
                    <p className="text-lg font-black text-emerald-700">{percent(marginsSummary.margin)}</p>
                  </div>
                </div>
              )}

              <DataState
                loading={margins.isLoading}
                error={margins.error}
                empty={filteredMarginsRows.length === 0}
                emptyMessage={
                  shopTab === "CONSOLIDATED"
                    ? "No invoiced jobs in this period."
                    : `No invoiced ${shopTab === "TIRE" ? "Tires" : "Mufflers"} Shop jobs in this period.`
                }
              >
                {margins.data && marginsSummary.flagged > 0 && (
                  <div className="mb-3">
                    <Notice tone="warn">
                      {marginsSummary.flagged} job(s) have provisional or missing costs. Those
                      margins are not final. {margins.data.note}
                    </Notice>
                  </div>
                )}
                <Table
                  headers={["Job", "Customer", "Net sales", "Parts", "Labor", "Gross profit", "Margin", ""]}
                >
                  {filteredMarginsRows.map((r) => (
                    <tr key={r.id} className={r.missingCosts ? "bg-amber-50/50" : ""}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Link to={`/jobs/${r.id}`} className="font-mono text-xs text-teal-700 hover:underline">
                            {r.number}
                          </Link>
                          {shopTab === "CONSOLIDATED" && (
                            <DepartmentBadge department={r.department} size="xs" />
                          )}
                        </div>
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
              title={
                shopTab === "CONSOLIDATED"
                  ? "Technician Billed Versus Worked Hours (Both Shops)"
                  : shopTab === "TIRE"
                  ? "🛞 Tires Shop Technician Hours"
                  : "🔧 Mufflers Shop Technician Hours"
              }
            >
              <DataState
                loading={hours.isLoading}
                error={hours.error}
                empty={filteredHoursRows.length === 0}
                emptyMessage={
                  shopTab === "CONSOLIDATED"
                    ? "No time logged in this period."
                    : `No time logged on ${shopTab === "TIRE" ? "Tires" : "Mufflers"} Shop jobs in this period.`
                }
              >
                <Table headers={["Technician", "Jobs", "Worked hours", "Billed hours", "Efficiency"]}>
                  {filteredHoursRows.map((r) => (
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
