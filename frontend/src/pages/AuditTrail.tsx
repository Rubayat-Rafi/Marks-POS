import { useState, useMemo, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { dateTime, money } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { Card, Button, DataState, Input, Table, Select, Modal } from "../components/ui";
import { Icon } from "../components/Icon";
import { Pagination } from "../components/Pagination";

type AuditActor = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
};

type AuditEvent = {
  id: string;
  organizationId: string;
  actorId?: string | null;
  actor?: AuditActor | null;
  actorRole?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  createdAt: string;
};

type AuditResponse = {
  data: AuditEvent[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

const RESOURCE_FILTER_OPTIONS = [
  { value: "ALL", label: "All Resources" },
  { value: "invoice", label: "Invoices & Sales" },
  { value: "payment", label: "Payments" },
  { value: "inventory_unit", label: "Inventory Serials" },
  { value: "inventory_product", label: "Product Catalog" },
  { value: "organization", label: "Shop Settings" },
  { value: "booking_request", label: "Booking Requests" },
  { value: "repairOrder", label: "Repair Orders" },
  { value: "vehicle", label: "Vehicles" },
  { value: "customer", label: "Customers" },
  { value: "user", label: "User Accounts" },
];

function timeAgo(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function formatAction(action: string): { label: string; badgeClass: string; icon: string } {
  switch (action) {
    case "sale.quick":
      return { label: "Quick Sale", badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "receipt" };
    case "auth.login":
      return { label: "User Login", badgeClass: "bg-purple-50 text-purple-800 border-purple-200", icon: "user" };
    case "auth.logout":
      return { label: "User Logout", badgeClass: "bg-slate-100 text-slate-700 border-slate-200", icon: "logout" };
    case "payment.recorded_manually":
      return { label: "Manual Payment", badgeClass: "bg-teal-50 text-teal-800 border-teal-200", icon: "cash" };
    case "payment.collected":
      return { label: "Payment Collected", badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "card" };
    case "payment.refunded":
      return { label: "Payment Refunded", badgeClass: "bg-rose-50 text-rose-800 border-rose-200", icon: "alert" };
    case "inventory.removed":
      return { label: "Stock Removed", badgeClass: "bg-rose-50 text-rose-800 border-rose-200", icon: "trash" };
    case "inventory.received":
      return { label: "Stock Received", badgeClass: "bg-blue-50 text-blue-800 border-blue-200", icon: "box" };
    case "inventory.product_created":
      return { label: "Product Created", badgeClass: "bg-indigo-50 text-indigo-800 border-indigo-200", icon: "plus" };
    case "inventory.product_updated":
      return { label: "Product Updated", badgeClass: "bg-indigo-50 text-indigo-800 border-indigo-200", icon: "wrench" };
    case "inventory.unit_created":
      return { label: "Serial Added", badgeClass: "bg-blue-50 text-blue-800 border-blue-200", icon: "tag" };
    case "settings.organization_updated":
      return { label: "Settings Updated", badgeClass: "bg-amber-50 text-amber-800 border-amber-200", icon: "settings" };
    case "booking.converted_to_appointment":
      return { label: "Converted to Appointment", badgeClass: "bg-sky-50 text-sky-800 border-sky-200", icon: "calendar" };
    case "booking.created":
      return { label: "Booking Request", badgeClass: "bg-sky-50 text-sky-800 border-sky-200", icon: "calendar" };
    case "vehicle.created":
      return { label: "Vehicle Created", badgeClass: "bg-slate-100 text-slate-800 border-slate-200", icon: "car" };
    case "vehicle.updated":
      return { label: "Vehicle Updated", badgeClass: "bg-slate-100 text-slate-800 border-slate-200", icon: "car" };
    case "customer.created":
      return { label: "Customer Created", badgeClass: "bg-teal-50 text-teal-800 border-teal-200", icon: "user" };
    case "customer.updated":
      return { label: "Customer Updated", badgeClass: "bg-teal-50 text-teal-800 border-teal-200", icon: "user" };
    case "invoice.created":
      return { label: "Invoice Created", badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "receipt" };
    case "invoice.issued":
      return { label: "Invoice Issued", badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: "receipt" };
    case "repair_order.created":
      return { label: "Work Order Created", badgeClass: "bg-blue-50 text-blue-800 border-blue-200", icon: "wrench" };
    default: {
      const parts = action.split(".");
      const label = parts
        .map((p) =>
          p
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" "),
        )
        .join(": ");
      return { label, badgeClass: "bg-slate-100 text-slate-700 border-slate-200", icon: "clock" };
    }
  }
}

function formatResourceType(type: string): string {
  switch (type) {
    case "invoice":
      return "Invoice";
    case "payment":
      return "Payment";
    case "inventory_unit":
      return "Inventory Serial";
    case "inventory_product":
    case "inventoryProduct":
      return "Product Item";
    case "organization":
      return "Shop Settings";
    case "booking_request":
      return "Booking Request";
    case "repairOrder":
    case "repair_order":
      return "Repair Order";
    case "vehicle":
      return "Vehicle";
    case "customer":
      return "Customer";
    case "user":
      return "User Account";
    case "membership":
      return "Staff Member";
    case "expense":
      return "Expense";
    case "location":
      return "Shop Location";
    default:
      return type
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
  }
}

function formatResourceLink(e: AuditEvent): { label: string; href?: string } {
  const m = e.metadata;
  if (e.resourceType === "invoice") {
    const invNum = m?.number ? String(m.number) : null;
    return {
      label: invNum || `#${e.resourceId?.slice(0, 8) ?? ""}`,
      href: e.resourceId ? `/receipts/${e.resourceId}` : undefined,
    };
  }
  if (e.resourceType === "inventory_unit") {
    const serial = m?.serialNumber ? String(m.serialNumber) : null;
    return {
      label: serial ? `Serial #${serial}` : `#${e.resourceId?.slice(0, 8) ?? ""}`,
      href: "/inventory",
    };
  }
  if (e.resourceType === "inventory_product" || e.resourceType === "inventoryProduct") {
    const name = m?.name ? String(m.name) : null;
    return {
      label: name ? `"${name}"` : `#${e.resourceId?.slice(0, 8) ?? ""}`,
      href: "/inventory",
    };
  }
  if (e.resourceType === "repairOrder" || e.resourceType === "repair_order") {
    const roNum = m?.number ? String(m.number) : null;
    return {
      label: roNum || `#${e.resourceId?.slice(0, 8) ?? ""}`,
      href: "/work-orders",
    };
  }
  if (e.resourceType === "vehicle") {
    const plate = m?.plate ? String(m.plate) : null;
    return {
      label: plate ? `Plate ${plate}` : `#${e.resourceId?.slice(0, 8) ?? ""}`,
      href: "/vehicles",
    };
  }
  if (e.resourceType === "customer") {
    return {
      label: m?.name ? String(m.name) : `#${e.resourceId?.slice(0, 8) ?? ""}`,
      href: "/customers",
    };
  }
  if (e.resourceType === "organization") {
    return { label: "Main Organization", href: "/settings" };
  }
  return {
    label: e.resourceId ? `#${e.resourceId.slice(0, 8)}` : "—",
  };
}

function renderHumanDetails(e: AuditEvent): ReactNode {
  const m = e.metadata;

  if (e.action === "sale.quick") {
    const totalCents = typeof m?.total === "number" ? m.total : 0;
    const paidCents = typeof m?.paid === "number" ? m.paid : totalCents;
    const methodRaw = String(m?.method || "");
    const methodLabel =
      methodRaw === "CARD_EXTERNAL"
        ? "Card (Debit/Credit)"
        : methodRaw === "CASH"
          ? "Cash"
          : methodRaw === "CHECK"
            ? "Check"
            : methodRaw || "Payment";
    const invNum = m?.number ? String(m.number) : null;
    const serialCount = typeof m?.serials === "number" ? m.serials : 0;

    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-800">
          {invNum && (
            <span className="font-mono font-bold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded border border-brand-200/60">
              {invNum}
            </span>
          )}
          <span>
            Sale Total: <strong className="font-mono text-emerald-700 font-bold">{money(totalCents)}</strong>
          </span>
          <span className="text-slate-400">·</span>
          <span>
            Paid <strong className="font-mono text-slate-700">{money(paidCents)}</strong> via{" "}
            <span className="font-medium text-slate-800">{methodLabel}</span>
          </span>
          {serialCount > 0 && (
            <span className="text-slate-500">
              ({serialCount} {serialCount === 1 ? "serial track" : "serials tracked"})
            </span>
          )}
        </div>
      </div>
    );
  }

  if (e.action === "payment.recorded_manually" || e.action.startsWith("payment.")) {
    const amt = typeof m?.amount === "number" ? money(m.amount) : "—";
    const method = String(m?.method || "");
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-800">
        <span>
          Recorded Tender: <strong className="font-mono text-emerald-700 font-bold">{amt}</strong>
        </span>
        {method && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
            {method}
          </span>
        )}
      </div>
    );
  }

  if (e.action === "inventory.removed") {
    const serial = m?.serialNumber ? String(m.serialNumber) : null;
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-800">
        <span>Unit removed from stock:</span>
        {serial && (
          <span className="font-mono font-bold text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
            Serial #{serial}
          </span>
        )}
        {e.reason && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-800 border border-rose-200">
            {e.reason}
          </span>
        )}
      </div>
    );
  }

  if (e.action === "inventory.received") {
    const added = typeof m?.added === "number" ? m.added : 0;
    return (
      <div className="text-xs text-slate-800">
        <span>
          Received and verified <strong>{added} {added === 1 ? "unit" : "units"}</strong> in stock
        </span>
      </div>
    );
  }

  if (e.action === "inventory.product_created") {
    const name = m?.name ? String(m.name) : "";
    const serials = typeof m?.serialsAdded === "number" ? m.serialsAdded : 0;
    return (
      <div className="text-xs text-slate-800">
        <span>
          Created catalog item <strong>"{name}"</strong>
          {serials > 0 ? ` with ${serials} initial serial units` : ""}
        </span>
      </div>
    );
  }

  if (e.action === "settings.organization_updated") {
    const before = m?.before as Record<string, unknown> | undefined;
    const after = m?.after as Record<string, unknown> | undefined;
    if (before && after) {
      const changes: string[] = [];
      if (before.taxRateBps !== after.taxRateBps) {
        changes.push(
          `Sales Tax Rate: ${((before.taxRateBps as number) / 100).toFixed(2)}% → ${((after.taxRateBps as number) / 100).toFixed(2)}%`,
        );
      }
      if (before.paymentProvider !== after.paymentProvider) {
        changes.push(`Payment Gateway: ${before.paymentProvider} → ${after.paymentProvider}`);
      }
      return (
        <div className="flex flex-wrap gap-1.5 text-xs text-slate-800">
          {changes.map((c, idx) => (
            <span
              key={idx}
              className="font-medium text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200"
            >
              {c}
            </span>
          ))}
          {changes.length === 0 && <span>Shop profile and configuration updated</span>}
        </div>
      );
    }
  }

  if (e.action === "booking.converted_to_appointment") {
    return (
      <div className="text-xs text-slate-800">
        <span>Converted customer online booking request into a confirmed shop appointment</span>
      </div>
    );
  }

  if (e.action === "auth.login") {
    return (
      <div className="text-xs text-slate-600 flex items-center gap-1.5">
        <span>User logged into workstation</span>
        {e.ipAddress && (
          <span className="font-mono text-[10px] text-slate-400 bg-slate-100 px-1 py-0.5 rounded">
            IP {e.ipAddress}
          </span>
        )}
      </div>
    );
  }

  // Generic fallback: format reasons and top metadata fields
  const keys = m ? Object.keys(m) : [];
  if (keys.length === 0 && !e.reason) {
    return <span className="text-xs text-slate-400 italic">No additional metadata</span>;
  }

  return (
    <div className="text-xs text-slate-700 space-y-1">
      {e.reason && (
        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
          <span className="text-slate-400 font-normal">Reason:</span>
          <span>{e.reason}</span>
        </div>
      )}
      {keys.length > 0 && (
        <div className="flex flex-wrap gap-1 font-mono text-[11px] text-slate-600">
          {keys.slice(0, 3).map((k) => (
            <span key={k} className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              {k}: {String(m![k])}
            </span>
          ))}
          {keys.length > 3 && (
            <span className="text-[10px] text-slate-400 self-center">
              +{keys.length - 3} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function AuditTrailPage() {
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [page, setPage] = useState<number>(() => {
    const p = parseInt(searchParams.get("page") || "1", 10);
    return isNaN(p) || p < 1 ? 1 : p;
  });
  const [limit, setLimit] = useState<number>(() => {
    const l = parseInt(searchParams.get("limit") || "25", 10);
    return [10, 25, 50, 100].includes(l) ? l : 25;
  });
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">(() => {
    const s = searchParams.get("sortOrder");
    return s === "asc" ? "asc" : "desc";
  });
  const [search, setSearch] = useState<string>(searchParams.get("q") || "");
  const [resourceType, setResourceType] = useState<string>(searchParams.get("resourceType") || "ALL");

  // Inspection modal state for viewing full raw details
  const [inspectedEvent, setInspectedEvent] = useState<AuditEvent | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

  const queryParams = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sortOrder,
    ...(search.trim() ? { q: search.trim() } : {}),
    ...(resourceType !== "ALL" ? { resourceType } : {}),
  });

  const audit = useQuery({
    queryKey: ["audit-trail", page, limit, sortOrder, search, resourceType],
    queryFn: () => api.get<AuditResponse>(`/settings/audit?${queryParams.toString()}`),
    enabled: can("audit.read"),
  });

  const total = audit.data?.pagination?.total ?? audit.data?.data?.length ?? 0;
  const totalPages = audit.data?.pagination?.totalPages ?? (Math.ceil(total / limit) || 1);

  // Quick category counts based on current batch
  const categoryHighlights = useMemo(() => {
    const list = audit.data?.data || [];
    let sales = 0;
    let inventory = 0;
    let security = 0;
    for (const e of list) {
      if (e.action.startsWith("sale.") || e.action.startsWith("payment.") || e.action.startsWith("invoice.")) {
        sales++;
      } else if (e.action.startsWith("inventory.")) {
        inventory++;
      } else if (e.action.startsWith("auth.") || e.action.startsWith("settings.")) {
        security++;
      }
    }
    return { sales, inventory, security };
  }, [audit.data?.data]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages) return;
    setPage(newPage);
    searchParams.set("page", String(newPage));
    setSearchParams(searchParams, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSearchChange = (q: string) => {
    setSearch(q);
    setPage(1);
    if (q) searchParams.set("q", q);
    else searchParams.delete("q");
    searchParams.set("page", "1");
    setSearchParams(searchParams, { replace: true });
  };

  const handleResourceTypeChange = (res: string) => {
    setResourceType(res);
    setPage(1);
    if (res !== "ALL") searchParams.set("resourceType", res);
    else searchParams.delete("resourceType");
    searchParams.set("page", "1");
    setSearchParams(searchParams, { replace: true });
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
    searchParams.set("limit", String(newLimit));
    searchParams.set("page", "1");
    setSearchParams(searchParams, { replace: true });
  };

  const handleSortOrderChange = (newSort: "desc" | "asc") => {
    setSortOrder(newSort);
    setPage(1);
    searchParams.set("sortOrder", newSort);
    searchParams.set("page", "1");
    setSearchParams(searchParams, { replace: true });
  };

  const handleCopyJson = (obj: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  return (
    <>
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader
          title="Audit Trail & System Logs"
          description="Complete, tamper-evident chronological record of all administrative, financial, operational, and user actions."
        />
        <div className="flex items-center gap-2">
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs transition"
          >
            <Icon name="chevronLeft" className="h-4 w-4" />
            <span>Settings</span>
          </Link>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">Total Events</span>
          <span className="mt-1 font-mono text-xl font-extrabold text-slate-900 block">{total}</span>
          <span className="text-[11px] text-slate-500">Audit logs on record</span>
        </div>
        <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/40 p-3.5 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800 block">Sales & Tender</span>
          <span className="mt-1 font-mono text-xl font-extrabold text-emerald-900 block">{categoryHighlights.sales}</span>
          <span className="text-[11px] text-emerald-700">Financial actions in view</span>
        </div>
        <div className="rounded-2xl border border-blue-200/70 bg-blue-50/40 p-3.5 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-blue-800 block">Inventory Ops</span>
          <span className="mt-1 font-mono text-xl font-extrabold text-blue-900 block">{categoryHighlights.inventory}</span>
          <span className="text-[11px] text-blue-700">Stock & serial changes</span>
        </div>
        <div className="rounded-2xl border border-purple-200/70 bg-purple-50/40 p-3.5 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-purple-800 block">Security & Access</span>
          <span className="mt-1 font-mono text-xl font-extrabold text-purple-900 block">{categoryHighlights.security}</span>
          <span className="text-[11px] text-purple-700">Logins & system edits</span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 max-w-md">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Icon name="search" className="h-4 w-4" />
            </span>
            <Input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search by user, action, invoice #, serial, or reason..."
              className="pl-9 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <span>Category:</span>
              <Select
                value={resourceType}
                onChange={(e) => handleResourceTypeChange(e.target.value)}
                className="text-xs py-1.5 font-medium"
              >
                {RESOURCE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
              <span>Per page:</span>
              <Select
                value={limit}
                onChange={(e) => handleLimitChange(Number(e.target.value))}
                className="text-xs py-1.5 font-medium"
              >
                <option value={10}>10 rows</option>
                <option value={25}>25 rows</option>
                <option value={50}>50 rows</option>
                <option value={100}>100 rows</option>
              </Select>
            </div>

            {(search || resourceType !== "ALL") && (
              <button
                type="button"
                onClick={() => {
                  handleSearchChange("");
                  handleResourceTypeChange("ALL");
                }}
                className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition"
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>

        {/* Quick Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">Quick:</span>
          {[
            { label: "All Logs", value: "ALL" },
            { label: "🛒 Invoices & Sales", value: "invoice" },
            { label: "💵 Payments", value: "payment" },
            { label: "📦 Inventory", value: "inventory_unit" },
            { label: "⚙️ Shop Settings", value: "organization" },
            { label: "🔑 User Accounts", value: "user" },
          ].map((pill) => (
            <button
              key={pill.value}
              type="button"
              onClick={() => handleResourceTypeChange(pill.value)}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                resourceType === pill.value
                  ? "bg-brand-600 text-white shadow-2xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Audit Events Table */}
      <div className="mt-4">
        <Card
          title="System Event Logs"
          action={
            <span className="text-xs font-normal text-slate-500">
              Showing <strong>{audit.data?.data?.length ?? 0}</strong> of <strong>{total}</strong> audit events
            </span>
          }
        >
          <DataState
            loading={audit.isLoading}
            error={audit.error}
            empty={!audit.data?.data || audit.data.data.length === 0}
            emptyMessage={
              search || resourceType !== "ALL"
                ? "No audit events match your search filters."
                : "No audit events recorded yet."
            }
          >
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <Table
                headers={[
                  "Date & Time",
                  "User / Actor",
                  "Event / Action",
                  "Target Entity",
                  "Summary & Human Details",
                  "Details",
                ]}
              >
                {audit.data?.data?.map((e) => {
                  const act = formatAction(e.action);
                  const resLink = formatResourceLink(e);
                  return (
                    <tr key={e.id} className="hover:bg-slate-50/80 transition">
                      {/* Timestamp */}
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">
                        <div className="font-semibold text-slate-800">{dateTime(e.createdAt)}</div>
                        <div className="text-[11px] font-medium text-slate-400">{timeAgo(e.createdAt)}</div>
                      </td>

                      {/* User / Actor */}
                      <td className="px-3 py-3 text-xs">
                        {e.actor ? (
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700 font-bold text-xs uppercase shadow-2xs">
                              {e.actor.firstName[0]}
                              {e.actor.lastName[0]}
                            </div>
                            <div className="min-w-0">
                              <span className="block font-bold text-slate-900 leading-tight">
                                {e.actor.firstName} {e.actor.lastName}
                              </span>
                              <span className="block text-[11px] text-slate-500 font-mono leading-tight truncate">
                                {e.actor.email}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-slate-500 italic">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs">
                              ⚙️
                            </span>
                            <span className="text-xs font-medium">Automated System</span>
                          </div>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-3 py-3">
                        <div className="space-y-1">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-bold shadow-2xs ${act.badgeClass}`}
                          >
                            <Icon name={act.icon} className="h-3.5 w-3.5 shrink-0" />
                            <span>{act.label}</span>
                          </span>
                          <span className="block font-mono text-[10px] text-slate-400">
                            {e.action}
                          </span>
                        </div>
                      </td>

                      {/* Resource Type & Friendly Identifier */}
                      <td className="px-3 py-3 text-xs">
                        <span className="block font-bold text-slate-700">
                          {formatResourceType(e.resourceType)}
                        </span>
                        {resLink.href ? (
                          <Link
                            to={resLink.href}
                            className="font-mono text-xs font-semibold text-brand-600 hover:text-brand-800 hover:underline inline-flex items-center gap-1"
                          >
                            <span>{resLink.label}</span>
                            <span className="text-[10px] opacity-70">↗</span>
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-slate-500">{resLink.label}</span>
                        )}
                      </td>

                      {/* Reason & Human Details */}
                      <td className="px-3 py-3 text-xs max-w-md">
                        {renderHumanDetails(e)}
                      </td>

                      {/* View Details Modal Trigger */}
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setInspectedEvent(e)}
                          className="text-[11px] font-semibold py-1 px-2.5 text-slate-600 hover:text-slate-900 border-slate-200"
                        >
                          <Icon name="search" className="h-3 w-3 text-slate-400" />
                          <span>View JSON</span>
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            </div>

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={total}
              pageSize={limit}
              onPageChange={handlePageChange}
              onPageSizeChange={handleLimitChange}
              pageSizeOptions={[10, 25, 50, 100]}
              sortOrder={sortOrder}
              onSortOrderChange={handleSortOrderChange}
              itemName="audit events"
            />
          </DataState>
        </Card>
      </div>

      {/* Detail Inspection Modal */}
      {inspectedEvent && (
        <Modal
          title={`Audit Event: ${formatAction(inspectedEvent.action).label}`}
          onClose={() => setInspectedEvent(null)}
          wide
        >
          <div className="space-y-4">
            {/* Header banner */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Event ID & Action
                </span>
                <span className="font-mono text-sm font-bold text-slate-800">
                  {inspectedEvent.id}
                </span>
                <span className="block font-mono text-xs text-slate-500 mt-0.5">
                  Action Code: <strong>{inspectedEvent.action}</strong>
                </span>
              </div>
              <div className="text-right">
                <span className="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Timestamp
                </span>
                <span className="font-mono text-sm font-bold text-slate-800">
                  {dateTime(inspectedEvent.createdAt)}
                </span>
                <span className="block text-xs text-slate-500">
                  ({timeAgo(inspectedEvent.createdAt)})
                </span>
              </div>
            </div>

            {/* Properties Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-slate-200 p-3 bg-white space-y-1.5">
                <span className="font-bold text-slate-500 uppercase text-[10px] tracking-wider block">
                  Actor Information
                </span>
                {inspectedEvent.actor ? (
                  <div>
                    <span className="font-bold text-slate-900 block">
                      {inspectedEvent.actor.firstName} {inspectedEvent.actor.lastName}
                    </span>
                    <span className="font-mono text-slate-500 block">
                      {inspectedEvent.actor.email}
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 block">
                      ID: {inspectedEvent.actor.id}
                    </span>
                  </div>
                ) : (
                  <span className="italic text-slate-500">System Automated Task</span>
                )}
                {inspectedEvent.ipAddress && (
                  <div className="pt-1 border-t border-slate-100 text-[11px] text-slate-500">
                    IP Address: <span className="font-mono">{inspectedEvent.ipAddress}</span>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 p-3 bg-white space-y-1.5">
                <span className="font-bold text-slate-500 uppercase text-[10px] tracking-wider block">
                  Resource Target
                </span>
                <span className="font-bold text-slate-900 block">
                  {formatResourceType(inspectedEvent.resourceType)}
                </span>
                <span className="font-mono text-slate-500 block">
                  ID: {inspectedEvent.resourceId || "None"}
                </span>
                {inspectedEvent.reason && (
                  <div className="pt-1 border-t border-slate-100 text-xs">
                    <span className="text-slate-400">Reason: </span>
                    <span className="font-semibold text-rose-700">{inspectedEvent.reason}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Human Summary */}
            <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-brand-800 block mb-1">
                Human Activity Interpretation
              </span>
              <div>{renderHumanDetails(inspectedEvent)}</div>
            </div>

            {/* Raw JSON Payload */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-slate-700">Metadata Payload (JSON)</span>
                <button
                  type="button"
                  onClick={() => handleCopyJson(inspectedEvent.metadata || {})}
                  className="inline-flex items-center gap-1 rounded bg-slate-100 hover:bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 transition"
                >
                  <Icon name="check" className="h-3 w-3 text-slate-500" />
                  <span>{copiedJson ? "Copied!" : "Copy JSON"}</span>
                </button>
              </div>
              <pre className="max-h-60 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-emerald-400 shadow-inner">
                {JSON.stringify(inspectedEvent.metadata || {}, null, 2)}
              </pre>
            </div>

            {/* Footer */}
            <div className="flex justify-end pt-2 border-t border-slate-200">
              <Button variant="secondary" onClick={() => setInspectedEvent(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
