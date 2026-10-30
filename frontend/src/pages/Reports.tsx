import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { Card, DataState, ErrorBanner, Modal, Table, Button, Input } from "../components/ui";
import { Icon } from "../components/Icon";
import { PrintReportModal, type PrintReportConfig } from "../features/finance/FinancePrintReports";
import { DepartmentBadge } from "../components/DepartmentBadge";
import { SHOP_PALETTES } from "../lib/shopColors";

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

type DatePreset = "TODAY" | "YESTERDAY" | "LAST_7" | "THIS_MONTH" | "ALL_TIME" | "CUSTOM";
type ShopSelection = "ALL" | "TIRE" | "MUFFLER";

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localDayStartIso(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return new Date().toISOString();
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

function localDayEndIso(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return new Date().toISOString();
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).toISOString();
}

function computePresetDates(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const todayStr = toLocalDateString(now);

  switch (preset) {
    case "TODAY":
      return { from: todayStr, to: todayStr };
    case "YESTERDAY": {
      const yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const s = toLocalDateString(yest);
      return { from: s, to: s };
    }
    case "LAST_7": {
      const d7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return { from: toLocalDateString(d7), to: todayStr };
    }
    case "THIS_MONTH": {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: toLocalDateString(firstOfMonth), to: todayStr };
    }
    case "ALL_TIME":
    default:
      return { from: "2020-01-01", to: todayStr };
  }
}

const PRESET_OPTIONS: Array<{ id: DatePreset; label: string }> = [
  { id: "TODAY", label: "Today" },
  { id: "YESTERDAY", label: "Yesterday" },
  { id: "LAST_7", label: "Last 7 Days" },
  { id: "THIS_MONTH", label: "This Month" },
  { id: "ALL_TIME", label: "All Sales" },
];

export function ReportsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawShop = (searchParams.get("shop") || "ALL").toUpperCase();
  const selectedShop: ShopSelection =
    rawShop === "TIRE" ? "TIRE" : rawShop === "MUFFLER" ? "MUFFLER" : "ALL";

  const setSelectedShop = (shop: ShopSelection) => {
    const next = new URLSearchParams(searchParams);
    if (shop === "ALL") next.delete("shop");
    else next.set("shop", shop);
    setSearchParams(next, { replace: true });
  };

  const [preset, setPreset] = useState<DatePreset>("TODAY");
  const initialRange = useMemo(() => computePresetDates("TODAY"), []);
  const [fromDate, setFromDate] = useState<string>(initialRange.from);
  const [toDate, setToDate] = useState<string>(initialRange.to);
  const [searchQuery, setSearchQuery] = useState("");
  const [printConfig, setPrintConfig] = useState<PrintReportConfig | null>(null);
  const [autoPrintModal, setAutoPrintModal] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; number: string; customer: string; total: number } | null>(null);

  const deleteInvoiceMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-sales-report"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      void queryClient.invalidateQueries({ queryKey: ["receivables"] });
      void queryClient.invalidateQueries({ queryKey: ["payments"] });
      void queryClient.invalidateQueries({ queryKey: ["finance"] });
      void queryClient.invalidateQueries({ queryKey: ["trial-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["daily-closing"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });

  function selectPreset(p: DatePreset) {
    setPreset(p);
    if (p !== "CUSTOM") {
      const r = computePresetDates(p);
      setFromDate(r.from);
      setToDate(r.to);
    }
  }

  const fromIso = useMemo(() => localDayStartIso(fromDate), [fromDate]);
  const toIso = useMemo(() => localDayEndIso(toDate), [toDate]);

  const sales = useQuery({
    queryKey: ["reports", "daily-sales", fromIso, toIso],
    queryFn: () =>
      api.get<DailySales>(
        `/reports/daily-sales?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
      ),
  });

  const periodLabel = useMemo(() => {
    const found = PRESET_OPTIONS.find((p) => p.id === preset);
    if (preset === "TODAY") return `Today (${fromDate})`;
    if (preset === "YESTERDAY") return `Yesterday (${fromDate})`;
    if (found && preset !== "CUSTOM") return `${found.label} (${fromDate} to ${toDate})`;
    return `${fromDate} to ${toDate}`;
  }, [preset, fromDate, toDate]);

  const tireData: ShopBreakdown = sales.data?.tireShop ?? {
    shopName: "Tire Shop",
    totals: { net: 0, tax: 0, gross: 0, invoiceCount: 0, lineCount: 0, cashCollected: 0, paymentsCount: 0 },
    days: [],
    items: [],
    invoices: [],
  };

  const mufflerData: ShopBreakdown = sales.data?.mufflersShop ?? {
    shopName: "Mufflers Shop",
    totals: { net: 0, tax: 0, gross: 0, invoiceCount: 0, lineCount: 0, cashCollected: 0, paymentsCount: 0 },
    days: [],
    items: [],
    invoices: [],
  };

  const activeTotals = useMemo(() => {
    if (selectedShop === "TIRE") {
      return {
        gross: tireData.totals.gross,
        net: tireData.totals.net,
        tax: tireData.totals.tax,
        invoiceCount: tireData.totals.invoiceCount,
      };
    }
    if (selectedShop === "MUFFLER") {
      return {
        gross: mufflerData.totals.gross,
        net: mufflerData.totals.net,
        tax: mufflerData.totals.tax,
        invoiceCount: mufflerData.totals.invoiceCount,
      };
    }
    return {
      gross: sales.data?.totals.gross ?? 0,
      net: sales.data?.totals.net ?? 0,
      tax: sales.data?.totals.tax ?? 0,
      invoiceCount: sales.data?.totals.count ?? (sales.data?.invoices?.length ?? 0),
    };
  }, [selectedShop, sales.data, tireData, mufflerData]);

  // Invoices strictly for the selected shop (Tire Shop uses tireData.invoices, Mufflers Shop uses mufflerData.invoices)
  const filteredInvoices = useMemo<DailySalesInvoice[]>(() => {
    let source: DailySalesInvoice[];
    if (selectedShop === "TIRE") {
      source = tireData.invoices.map((inv) => ({ ...inv, department: "TIRE" as const }));
    } else if (selectedShop === "MUFFLER") {
      source = mufflerData.invoices.map((inv) => ({ ...inv, department: "MUFFLER" as const }));
    } else {
      source = sales.data?.invoices ?? [];
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return source;
    return source.filter(
      (inv) =>
        inv.number.toLowerCase().includes(q) ||
        inv.customer.toLowerCase().includes(q) ||
        inv.lines.some((l) => l.description.toLowerCase().includes(q)),
    );
  }, [selectedShop, sales.data?.invoices, tireData.invoices, mufflerData.invoices, searchQuery]);

  function openDailySalesReportModal(autoPrint = false) {
    if (!sales.data) return;
    setAutoPrintModal(autoPrint);
    if (selectedShop === "TIRE") {
      setPrintConfig({
        type: "DAILY_SALES_TIRE",
        title: `Tire Shop Daily Sales Report — ${periodLabel}`,
        data: sales.data,
        dateRange: { from: fromDate, to: toDate },
      });
      return;
    }
    if (selectedShop === "MUFFLER") {
      setPrintConfig({
        type: "DAILY_SALES_MUFFLER",
        title: `Mufflers Shop Daily Sales Report — ${periodLabel}`,
        data: sales.data,
        dateRange: { from: fromDate, to: toDate },
      });
      return;
    }
    setPrintConfig({
      type: "DAILY_SALES_ALL",
      title: `Daily Sales Report — ${periodLabel}`,
      data: sales.data,
      dateRange: { from: fromDate, to: toDate },
    });
  }

  function openSingleInvoiceModal(inv: DailySalesInvoice, autoPrint = false) {
    setAutoPrintModal(autoPrint);
    setPrintConfig({
      type: "SINGLE_INVOICE",
      title: `Sales Invoice ${inv.number}`,
      data: inv,
      dateRange: { date: inv.issuedAt },
    });
  }

  function downloadInvoicesCsv() {
    const lines = [
      ["Invoice #", "Date & Time", "Shop", "Customer", "Items Sold", "Before Tax ($)", "Sales Tax ($)", "Total ($)"],
      ...filteredInvoices.map((inv) => [
        inv.number,
        new Date(inv.issuedAt).toLocaleString(),
        inv.department === "MUFFLER" ? "Mufflers Shop" : inv.department === "TIRE" ? "Tire Shop" : "Both Shops",
        `"${inv.customer.replace(/"/g, '""')}"`,
        `"${inv.lines.map((l) => `${l.quantity}x ${l.description}`).join("; ").replace(/"/g, '""')}"`,
        (inv.net / 100).toFixed(2),
        (inv.tax / 100).toFixed(2),
        (inv.total / 100).toFixed(2),
      ]),
    ];
    const csvContent = "data:text/csv;charset=utf-8," + lines.map((r) => r.join(",")).join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    const shopSlug = selectedShop === "TIRE" ? "tire-shop" : selectedShop === "MUFFLER" ? "mufflers-shop" : "all-shops";
    link.setAttribute("download", `daily-sales-${shopSlug}-${fromDate}-to-${toDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <>
      <PageHeader
        title="Daily Sales & Invoices"
        description={
          selectedShop === "TIRE"
            ? "Showing Tires Shop sales and invoices only."
            : selectedShop === "MUFFLER"
            ? "Showing Mufflers Shop sales and invoices only."
            : "View daily sales totals, filter by Tires Shop or Mufflers Shop, and print or download any invoice."
        }
        action={
          <div className="flex flex-wrap items-center gap-3">
            {/* Shop / Division Selector Pill */}
            <div className="flex items-center gap-1.5 rounded-2xl bg-white p-1.5 shadow-sm border border-slate-200">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-2">Shop:</span>
              <button
                type="button"
                onClick={() => setSelectedShop("ALL")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  selectedShop === "ALL"
                    ? SHOP_PALETTES.ALL.activeTabClass
                    : SHOP_PALETTES.ALL.inactiveTabClass
                }`}
              >
                <Icon name="store" className="h-3.5 w-3.5" /> All Shops
              </button>
              <button
                type="button"
                onClick={() => setSelectedShop("TIRE")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  selectedShop === "TIRE"
                    ? SHOP_PALETTES.TIRE.activeTabClass
                    : SHOP_PALETTES.TIRE.inactiveTabClass
                }`}
              >
                <Icon name="tire" className="h-3.5 w-3.5" /> Tires Shop
              </button>
              <button
                type="button"
                onClick={() => setSelectedShop("MUFFLER")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  selectedShop === "MUFFLER"
                    ? SHOP_PALETTES.MUFFLER.activeTabClass
                    : SHOP_PALETTES.MUFFLER.inactiveTabClass
                }`}
              >
                <Icon name="pipe" className="h-3.5 w-3.5" /> Mufflers Shop
              </button>
            </div>

            {sales.data && (
              <>
                <Button variant="primary" onClick={() => openDailySalesReportModal(true)}>
                  <Icon name="printer" className="h-4 w-4" />{" "}
                  {selectedShop === "TIRE"
                    ? "Print Tires Shop Report (PDF)"
                    : selectedShop === "MUFFLER"
                    ? "Print Mufflers Report (PDF)"
                    : "Print Daily Sales (PDF)"}
                </Button>
                <Button variant="secondary" onClick={downloadInvoicesCsv}>
                  <Icon name="download" className="h-4 w-4" /> Download CSV
                </Button>
              </>
            )}
            {can("sales.quick") && (
              <Link to="/quick-sale">
                <Button variant="success">
                  <Icon name="plus" className="h-4 w-4" /> New Sale
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {/* Filter Bar: Date Presets + From / To Date Picker */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Date Preset Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESET_OPTIONS.map((p) => {
                const active = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPreset(p.id)}
                    className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                      active
                        ? "bg-ink text-white shadow-sm"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Date Picker */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500">From</span>
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  setPreset("CUSTOM");
                  setFromDate(val);
                  if (val > toDate) setToDate(val);
                }}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-500">To</span>
              <input
                type="date"
                value={toDate}
                min={fromDate}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  setPreset("CUSTOM");
                  setToDate(val);
                  if (val < fromDate) setFromDate(val);
                }}
                className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink focus:border-brand focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <DataState loading={sales.isLoading} error={sales.error}>
        {sales.data && (
          <div className="space-y-6">
            {/* Helper banner if Today has 0 sales */}
            {preset === "TODAY" && activeTotals.invoiceCount === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <span>
                  No {selectedShop === "TIRE" ? "Tire Shop " : selectedShop === "MUFFLER" ? "Mufflers Shop " : ""}
                  sales recorded for today ({fromDate}) yet.
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => selectPreset("YESTERDAY")}>
                    View Yesterday
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => selectPreset("THIS_MONTH")}>
                    View This Month
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => selectPreset("ALL_TIME")}>
                    View All Sales
                  </Button>
                </div>
              </div>
            )}

            {/* Summary Cards — Adapts when Tire Shop or Mufflers Shop is selected */}
            {selectedShop === "ALL" ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50/60 p-5 shadow-sm">
                  <p className="text-xs font-extrabold uppercase tracking-wider text-emerald-800">
                    {preset === "TODAY" ? "Total Sales Today" : "Total Sales"}
                  </p>
                  <p className="mt-1 font-mono text-3xl font-black text-emerald-950">
                    {money(activeTotals.gross)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-emerald-700">
                    {activeTotals.invoiceCount} {activeTotals.invoiceCount === 1 ? "Invoice" : "Invoices"}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                    Sales Breakdown
                  </p>
                  <p className="mt-1 font-mono text-2xl font-black text-ink">
                    {money(activeTotals.net)} <span className="text-xs font-semibold text-slate-400">before tax</span>
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-600">
                    Sales Tax: <span className="font-mono font-bold text-ink">{money(activeTotals.tax)}</span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedShop("TIRE")}
                  className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 text-left shadow-sm transition hover:border-amber-400 hover:bg-amber-50"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-extrabold uppercase tracking-wider text-amber-900">🛞 Tire Shop</p>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                      {tireData.totals.invoiceCount} {tireData.totals.invoiceCount === 1 ? "sale" : "sales"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-2xl font-black text-amber-950">
                    {money(tireData.totals.gross)}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    Before tax: {money(tireData.totals.net)}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedShop("MUFFLER")}
                  className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 text-left shadow-sm transition hover:border-blue-400 hover:bg-blue-50"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-extrabold uppercase tracking-wider text-blue-900">🔧 Mufflers Shop</p>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-900">
                      {mufflerData.totals.invoiceCount} {mufflerData.totals.invoiceCount === 1 ? "sale" : "sales"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-2xl font-black text-blue-950">
                    {money(mufflerData.totals.gross)}
                  </p>
                  <p className="mt-1 text-xs text-blue-800">
                    Before tax: {money(mufflerData.totals.net)}
                  </p>
                </button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <div
                  className={`rounded-2xl border-2 p-5 shadow-sm ${
                    selectedShop === "TIRE"
                      ? "border-amber-500 bg-amber-50/70"
                      : "border-blue-600 bg-blue-50/70"
                  }`}
                >
                  <p className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                    {selectedShop === "TIRE" ? "🛞 Tire Shop Total Sales" : "🔧 Mufflers Shop Total Sales"}
                  </p>
                  <p className="mt-1 font-mono text-3xl font-black text-ink">
                    {money(activeTotals.gross)}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-600">
                    {periodLabel}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                    {selectedShop === "TIRE" ? "Tire Shop Breakdown" : "Mufflers Shop Breakdown"}
                  </p>
                  <p className="mt-1 font-mono text-2xl font-black text-ink">
                    {money(activeTotals.net)} <span className="text-xs font-semibold text-slate-400">before tax</span>
                  </p>
                  <p className="mt-1 text-xs font-semibold text-slate-600">
                    Sales Tax: <span className="font-mono font-bold text-ink">{money(activeTotals.tax)}</span>
                  </p>
                </div>

                <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
                      {selectedShop === "TIRE" ? "Tire Shop Invoices" : "Mufflers Shop Invoices"}
                    </p>
                    <p className="mt-1 font-mono text-2xl font-black text-ink">
                      {activeTotals.invoiceCount} {activeTotals.invoiceCount === 1 ? "Invoice" : "Invoices"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedShop("ALL")}
                    className="mt-2 self-start text-xs font-bold text-brand hover:underline"
                  >
                    ← Show All Shops
                  </button>
                </div>
              </div>
            )}

            {/* Single Clean Invoices Table */}
            <Card
              title={
                selectedShop === "TIRE"
                  ? `🛞 Tire Shop Invoices (${filteredInvoices.length})`
                  : selectedShop === "MUFFLER"
                  ? `🔧 Mufflers Shop Invoices (${filteredInvoices.length})`
                  : `All Sales Invoices (${filteredInvoices.length})`
              }
              action={
                <div className="w-64">
                  <Input
                    placeholder="Search invoice # or customer..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              }
            >
              <DataState
                empty={filteredInvoices.length === 0}
                emptyMessage={`No invoices found for ${
                  selectedShop === "TIRE"
                    ? "Tire Shop"
                    : selectedShop === "MUFFLER"
                    ? "Mufflers Shop"
                    : "All Shops"
                } in ${periodLabel}.`}
              >
                <Table
                  headers={[
                    "Invoice #",
                    "Date & Time",
                    "Shop",
                    "Customer",
                    "Items & Services Sold",
                    "Subtotal / Tax",
                    "Total",
                    "Invoice Actions",
                  ]}
                >
                  {filteredInvoices.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => openSingleInvoiceModal(r, false)}
                          className="font-mono text-sm font-extrabold text-brand hover:underline"
                        >
                          {r.number}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-medium text-slate-600">
                        {new Date(r.issuedAt).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-3 py-2.5">
                        <DepartmentBadge department={r.department} />
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-ink">{r.customer}</td>
                      <td className="px-3 py-2.5">
                        <div className="max-w-md space-y-0.5 text-xs text-slate-600">
                          {r.lines.slice(0, 2).map((l, idx) => (
                            <div key={idx} className="truncate">
                              <span className="font-bold text-slate-800">{l.quantity}×</span> {l.description}
                            </div>
                          ))}
                          {r.lines.length > 2 && (
                            <div className="text-[11px] font-semibold text-slate-400">
                              +{r.lines.length - 2} more items
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-slate-600">
                        <div className="font-mono">{money(r.net)}</div>
                        <div className="text-[11px] text-slate-400">Tax {money(r.tax)}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="font-mono text-sm font-black text-ink">{money(r.total)}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => openSingleInvoiceModal(r, false)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                          >
                            View Invoice
                          </button>
                          <button
                            type="button"
                            onClick={() => openSingleInvoiceModal(r, true)}
                            className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1.5 text-xs font-bold text-white hover:bg-brand-dark"
                          >
                            <Icon name="printer" className="h-3.5 w-3.5" /> Print / PDF
                          </button>
                          {can("invoices.write") && (
                            <button
                              type="button"
                              onClick={() =>
                                setDeleteTarget({
                                  id: r.id,
                                  number: r.number,
                                  customer: r.customer,
                                  total: r.total,
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100"
                              title="Delete Invoice"
                            >
                              <Icon name="trash" className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </DataState>
            </Card>
          </div>
        )}
      </DataState>

      {printConfig && (
        <PrintReportModal
          config={printConfig}
          onClose={() => setPrintConfig(null)}
          autoPrint={autoPrintModal}
        />
      )}

      {deleteTarget && (
        <Modal title={`Delete Invoice ${deleteTarget.number}?`} onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4">
            <ErrorBanner error={deleteInvoiceMutation.error} />
            <p className="text-sm text-slate-700">
              Are you sure you want to permanently delete invoice{" "}
              <span className="font-mono font-bold text-ink">{deleteTarget.number}</span> for{" "}
              <span className="font-semibold text-ink">{deleteTarget.customer}</span> ({money(deleteTarget.total)})?
            </p>
            <p className="text-xs text-slate-500">
              This will permanently remove the invoice, its associated payment and accounting entries,
              and return any serialized tires or mufflers sold on this invoice back to stock.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleteInvoiceMutation.isPending}
                onClick={() => deleteInvoiceMutation.mutate(deleteTarget.id)}
              >
                <Icon name="trash" className="h-4 w-4" /> Permanently Delete
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
