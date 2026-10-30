import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiClientError } from "../lib/api";
import { customerLabel, dateTime, timeOnly, titleCase, vehicleLabel } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { Button, DataState, ErrorBanner, Notice } from "../components/ui";
import { Icon } from "../components/Icon";
import { WalkInModal } from "../components/WalkInModal";
import { classifyTextDepartment, type ShopDepartment } from "../lib/shopDepartment";
import { SHOP_PALETTES } from "../lib/shopColors";
import type { RepairOrder, RepairOrderStatus } from "../lib/types";

type Board = { lanes: Array<{ status: RepairOrderStatus; orders: RepairOrder[] }> };

/** The primary next lane for a one-click advance. */
const PRIMARY_NEXT_LANE: Partial<Record<RepairOrderStatus, RepairOrderStatus>> = {
  SCHEDULED: "CHECKED_IN",
  CHECKED_IN: "DIAGNOSING",
  DIAGNOSING: "AWAITING_APPROVAL",
  AWAITING_APPROVAL: "IN_PROGRESS",
  AWAITING_PARTS: "IN_PROGRESS",
  IN_PROGRESS: "QUALITY_CHECK",
  QUALITY_CHECK: "READY",
  READY: "DELIVERED",
};

/** All valid transitions allowed by the backend state machine. */
const VALID_TRANSITIONS: Record<RepairOrderStatus, RepairOrderStatus[]> = {
  SCHEDULED: ["CHECKED_IN", "CANCELLED"],
  CHECKED_IN: ["DIAGNOSING", "AWAITING_APPROVAL", "IN_PROGRESS", "CANCELLED"],
  DIAGNOSING: ["AWAITING_APPROVAL", "AWAITING_PARTS", "IN_PROGRESS", "CANCELLED"],
  AWAITING_APPROVAL: ["IN_PROGRESS", "AWAITING_PARTS", "DIAGNOSING", "CANCELLED"],
  AWAITING_PARTS: ["IN_PROGRESS", "AWAITING_APPROVAL", "CANCELLED"],
  IN_PROGRESS: ["QUALITY_CHECK", "AWAITING_PARTS", "AWAITING_APPROVAL", "CANCELLED"],
  QUALITY_CHECK: ["READY", "IN_PROGRESS"],
  READY: ["DELIVERED", "IN_PROGRESS"],
  DELIVERED: [],
  CANCELLED: [],
};

type LaneConfig = {
  title: string;
  badge: string;
  accentBorder: string;
  headerBg: string;
  dotColor: string;
  icon: string;
  description: string;
};

const LANE_CONFIGS: Record<RepairOrderStatus, LaneConfig> = {
  SCHEDULED: {
    title: "Scheduled",
    badge: "bg-slate-100 text-slate-700 border-slate-200",
    accentBorder: "border-t-slate-500",
    headerBg: "bg-slate-50/80",
    dotColor: "bg-slate-400",
    icon: "calendar",
    description: "Booked arrivals",
  },
  CHECKED_IN: {
    title: "Checked In",
    badge: "bg-sky-100 text-sky-800 border-sky-200",
    accentBorder: "border-t-sky-500",
    headerBg: "bg-sky-50/70",
    dotColor: "bg-sky-500",
    icon: "car",
    description: "Keys in shop, awaiting intake",
  },
  DIAGNOSING: {
    title: "Diagnosing",
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    accentBorder: "border-t-amber-500",
    headerBg: "bg-amber-50/70",
    dotColor: "bg-amber-500",
    icon: "search",
    description: "Inspection & scanner testing",
  },
  AWAITING_APPROVAL: {
    title: "Awaiting Approval",
    badge: "bg-purple-100 text-purple-800 border-purple-200",
    accentBorder: "border-t-purple-500",
    headerBg: "bg-purple-50/70",
    dotColor: "bg-purple-500",
    icon: "receipt",
    description: "Estimate with customer",
  },
  AWAITING_PARTS: {
    title: "Awaiting Parts",
    badge: "bg-rose-100 text-rose-800 border-rose-200",
    accentBorder: "border-t-rose-500",
    headerBg: "bg-rose-50/70",
    dotColor: "bg-rose-500",
    icon: "box",
    description: "Ordered, awaiting delivery",
  },
  IN_PROGRESS: {
    title: "In Progress",
    badge: "bg-blue-100 text-blue-800 border-blue-200",
    accentBorder: "border-t-brand-600",
    headerBg: "bg-blue-50/70",
    dotColor: "bg-brand-600",
    icon: "wrench",
    description: "Active work in service bays",
  },
  QUALITY_CHECK: {
    title: "Quality Check",
    badge: "bg-teal-100 text-teal-800 border-teal-200",
    accentBorder: "border-t-teal-500",
    headerBg: "bg-teal-50/70",
    dotColor: "bg-teal-500",
    icon: "shield",
    description: "Road test & inspection",
  },
  READY: {
    title: "Ready for Pickup",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-200",
    accentBorder: "border-t-emerald-500",
    headerBg: "bg-emerald-50/70",
    dotColor: "bg-emerald-500",
    icon: "check",
    description: "Finished & parked for pickup",
  },
  DELIVERED: {
    title: "Delivered",
    badge: "bg-slate-100 text-slate-600 border-slate-200",
    accentBorder: "border-t-slate-400",
    headerBg: "bg-slate-50",
    dotColor: "bg-slate-400",
    icon: "check",
    description: "Handed over to customer",
  },
  CANCELLED: {
    title: "Cancelled",
    badge: "bg-red-100 text-red-700 border-red-200",
    accentBorder: "border-t-red-400",
    headerBg: "bg-red-50",
    dotColor: "bg-red-400",
    icon: "x",
    description: "Cancelled order",
  },
};

const AVATAR_COLORS = [
  "bg-blue-600 text-white",
  "bg-emerald-600 text-white",
  "bg-indigo-600 text-white",
  "bg-amber-600 text-white",
  "bg-rose-600 text-white",
  "bg-teal-600 text-white",
  "bg-violet-600 text-white",
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(firstName?: string, lastName?: string) {
  const f = firstName?.[0] ?? "";
  const l = lastName?.[0] ?? "";
  return (f + l).toUpperCase() || "RO";
}

type FilterMode = "all" | "overdue" | "today" | "tasks" | "ready";

export function WorkBoardPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const urlShop = searchParams.get("shop");
  const initialShop: "ALL" | "TIRE" | "MUFFLER" =
    urlShop === "tire" || urlShop === "tires"
      ? "TIRE"
      : urlShop === "muffler" || urlShop === "mufflers"
      ? "MUFFLER"
      : "ALL";

  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [shopFilter, setShopFilter] = useState<"ALL" | "TIRE" | "MUFFLER">(initialShop);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [deleteTargetRo, setDeleteTargetRo] = useState<RepairOrder | null>(null);

  const deleteJob = useMutation({
    mutationFn: (id: string) => api.delete(`/repair-orders/${id}`),
    onSuccess: () => {
      setDeleteTargetRo(null);
      void queryClient.invalidateQueries({ queryKey: ["board"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

  const handleShopFilterChange = (filter: "ALL" | "TIRE" | "MUFFLER") => {
    setShopFilter(filter);
    if (filter === "ALL") {
      searchParams.delete("shop");
    } else {
      searchParams.set("shop", filter.toLowerCase());
    }
    setSearchParams(searchParams, { replace: true });
  };

  const scrollBy = (delta: number) =>
    scrollerRef.current?.scrollBy({ left: delta, behavior: "smooth" });

  const jumpToLane = (status: RepairOrderStatus) => {
    const el = document.getElementById(`lane-${status}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  };

  const board = useQuery({
    queryKey: ["board"],
    queryFn: () => api.get<Board>("/repair-orders/board"),
    refetchInterval: 30_000,
  });

  const advance = useMutation({
    mutationFn: (vars: { id: string; status: RepairOrderStatus; version: number }) =>
      api.post<RepairOrder & { warnings?: string[] }>(`/repair-orders/${vars.id}/status`, {
        status: vars.status,
        expectedVersion: vars.version,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["board"] }),
  });

  const conflict = advance.error instanceof ApiClientError && advance.error.isConflict;

  // All orders across all lanes (raw, unfiltered)
  const allOrders = useMemo(
    () => board.data?.lanes.flatMap((l) => l.orders) ?? [],
    [board.data?.lanes]
  );

  // Orders filtered to the active shop division — drives both KPI tiles and lane cards
  const shopFilteredAllOrders = useMemo(() => {
    if (shopFilter === "ALL") return allOrders;
    return allOrders.filter((ro) => {
      const dept = classifyTextDepartment(
        `${ro.concern || ""} ${ro.tasks?.map((t) => t.description).join(" ") || ""}`,
        ro.number || ro.id,
      );
      return dept === shopFilter;
    });
  }, [allOrders, shopFilter]);

  const now = Date.now();

  // KPI metrics — always reflect the ACTIVE shop filter
  const metrics = useMemo(() => {
    const orders = shopFilteredAllOrders;
    const totalActive = orders.length;
    const inProgress = orders.filter((o) => o.status === "IN_PROGRESS").length;
    const awaitingApproval = orders.filter((o) => o.status === "AWAITING_APPROVAL").length;
    const awaitingParts = orders.filter((o) => o.status === "AWAITING_PARTS").length;
    const totalWaiting = awaitingApproval + awaitingParts;
    const ready = orders.filter((o) => o.status === "READY").length;

    const overdue = orders.filter(
      (ro) => ro.promisedAt && new Date(ro.promisedAt).getTime() < now
    ).length;

    const todayPromise = orders.filter((ro) => {
      if (!ro.promisedAt) return false;
      const t = new Date(ro.promisedAt);
      const n = new Date();
      return (
        t.getDate() === n.getDate() &&
        t.getMonth() === n.getMonth() &&
        t.getFullYear() === n.getFullYear()
      );
    }).length;

    const withOpenTasks = orders.filter(
      (ro) => ro.tasks && ro.tasks.some((t) => t.status !== "DONE")
    ).length;

    return {
      totalActive,
      inProgress,
      awaitingApproval,
      awaitingParts,
      totalWaiting,
      ready,
      overdue,
      todayPromise,
      withOpenTasks,
    };
  }, [shopFilteredAllOrders, now]);

  // Apply real-time search & filters
  const filteredLanes = useMemo(() => {
    if (!board.data?.lanes) return [];

    const q = searchQuery.toLowerCase().trim();

    return board.data.lanes.map((lane) => {
      const filteredOrders = lane.orders.filter((ro) => {
        // 1. Text Search
        if (q) {
          const numMatch = ro.number.toLowerCase().includes(q);
          const cust = `${ro.customer?.firstName ?? ""} ${ro.customer?.lastName ?? ""} ${ro.customer?.phone ?? ""}`.toLowerCase();
          const custMatch = cust.includes(q);
          const veh = `${ro.vehicle?.year ?? ""} ${ro.vehicle?.make ?? ""} ${ro.vehicle?.model ?? ""} ${ro.vehicle?.plate ?? ""}`.toLowerCase();
          const vehMatch = veh.includes(q);
          const concernMatch = (ro.concern ?? "").toLowerCase().includes(q);

          if (!numMatch && !custMatch && !vehMatch && !concernMatch) {
            return false;
          }
        }

        // 2. Shop Division Filter
        if (shopFilter !== "ALL") {
          const dept = classifyTextDepartment(
            `${ro.concern || ""} ${ro.tasks?.map((t) => t.description).join(" ") || ""}`,
            ro.number || ro.id,
          );
          if (dept !== shopFilter) {
            return false;
          }
        }

        // 3. Active Tab Filter
        if (filterMode === "overdue") {
          return ro.promisedAt && new Date(ro.promisedAt).getTime() < now;
        }
        if (filterMode === "today") {
          if (!ro.promisedAt) return false;
          const t = new Date(ro.promisedAt);
          const n = new Date();
          return (
            t.getDate() === n.getDate() &&
            t.getMonth() === n.getMonth() &&
            t.getFullYear() === n.getFullYear()
          );
        }
        if (filterMode === "tasks") {
          return ro.tasks && ro.tasks.some((t) => t.status !== "DONE");
        }
        if (filterMode === "ready") {
          return ro.status === "READY";
        }

        return true;
      });

      return {
        ...lane,
        orders: filteredOrders,
        totalRaw: lane.orders.length,
      };
    });
  }, [board.data?.lanes, searchQuery, filterMode, shopFilter, now]);

  const totalFilteredCount = useMemo(
    () => filteredLanes.reduce((acc, l) => acc + l.orders.length, 0),
    [filteredLanes]
  );

  const isFilteringActive = searchQuery.trim() !== "" || filterMode !== "all" || shopFilter !== "ALL";

  return (
    <>
      <PageHeader
        title="Work Board"
        description="Live view of every vehicle in the shop, organized by service stage."
        action={
          <div className="flex items-center gap-2">
            {can("jobs.write") && (
              <Button
                variant="primary"
                size="md"
                onClick={() => setShowWalkIn(true)}
                className="gap-2 shadow-sm"
              >
                <Icon name="plus" className="h-4 w-4" />
                <span>Check in vehicle</span>
              </Button>
            )}

            <button
              type="button"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["board"] })}
              disabled={board.isFetching}
              title="Refresh board"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-ink disabled:opacity-50"
            >
              <svg
                className={`h-4 w-4 ${board.isFetching ? "animate-spin text-brand-600" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-1.19" />
              </svg>
            </button>

            <div className="hidden items-center rounded-lg border border-slate-300 bg-white p-0.5 shadow-sm sm:flex">
              <button
                type="button"
                onClick={() => scrollBy(-360)}
                aria-label="Scroll lanes left"
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-ink transition"
              >
                <Icon name="chevronLeft" className="h-4 w-4" />
              </button>
              <div className="h-4 w-[1px] bg-slate-200" />
              <button
                type="button"
                onClick={() => scrollBy(360)}
                aria-label="Scroll lanes right"
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-ink transition"
              >
                <Icon name="chevronRight" className="h-4 w-4" />
              </button>
            </div>
          </div>
        }
      />

      {/* 5 KPI Metric Stat Cards */}
      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <button
          type="button"
          onClick={() => {
            setFilterMode("all");
            setSearchQuery("");
          }}
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition ${
            filterMode === "all" && !searchQuery
              ? "border-brand-500 bg-brand-50/50 ring-2 ring-brand-500/20 shadow-sm"
              : "border-slate-200/80 bg-white hover:border-slate-300 shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Active Fleet</span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <Icon name="car" className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-ink tabular-nums">
              {metrics.totalActive}
            </span>
            <span className="text-xs text-slate-500">vehicles</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setFilterMode("all");
            jumpToLane("IN_PROGRESS");
          }}
          className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-3.5 text-left transition hover:border-blue-300 shadow-sm"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-blue-700 uppercase tracking-wide">
            <span>In Service Bays</span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700">
              <Icon name="wrench" className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-blue-800 tabular-nums">
              {metrics.inProgress}
            </span>
            <span className="text-xs text-blue-600">in progress</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setFilterMode("all");
            jumpToLane("AWAITING_APPROVAL");
          }}
          className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-3.5 text-left transition hover:border-purple-300 shadow-sm"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-purple-700 uppercase tracking-wide">
            <span>Bottlenecks</span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-purple-700">
              <Icon name="clock" className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-purple-800 tabular-nums">
              {metrics.totalWaiting}
            </span>
            <span className="text-xs text-purple-600">approval/parts</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterMode((prev) => (prev === "ready" ? "all" : "ready"))}
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition ${
            filterMode === "ready"
              ? "border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20 shadow-sm"
              : "border-slate-200/80 bg-white hover:border-emerald-300 shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-emerald-700 uppercase tracking-wide">
            <span>Ready for Pickup</span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Icon name="check" className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-display text-2xl font-bold text-emerald-800 tabular-nums">
              {metrics.ready}
            </span>
            <span className="text-xs text-emerald-600">awaiting pickup</span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFilterMode((prev) => (prev === "overdue" ? "all" : "overdue"))}
          className={`flex flex-col justify-between rounded-xl border p-3.5 text-left transition ${
            filterMode === "overdue"
              ? "border-red-500 bg-red-50/60 ring-2 ring-red-500/20 shadow-sm"
              : metrics.overdue > 0
              ? "border-red-200 bg-red-50/30 hover:border-red-300 shadow-sm"
              : "border-slate-200/80 bg-white hover:border-slate-300 shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-red-700 uppercase tracking-wide">
            <span>Overdue Promise</span>
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full ${
                metrics.overdue > 0 ? "bg-red-500 text-white animate-pulse" : "bg-slate-100 text-slate-500"
              }`}
            >
              <Icon name="alert" className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`font-display text-2xl font-bold tabular-nums ${
                metrics.overdue > 0 ? "text-red-700" : "text-slate-400"
              }`}
            >
              {metrics.overdue}
            </span>
            <span className="text-xs text-slate-500">
              {metrics.overdue > 0 ? "past deadline" : "all on schedule"}
            </span>
          </div>
        </button>
      </section>

      {/* Active Shop Banner — visible only when a specific shop is selected */}
      {shopFilter !== "ALL" && (
        <div className={`mb-4 flex items-center gap-3 rounded-xl border px-4 py-3 ${SHOP_PALETTES[shopFilter].bannerClass}`}>
          <Icon
            name={shopFilter === "TIRE" ? "tire" : "pipe"}
            className={`h-4 w-4 shrink-0 ${SHOP_PALETTES[shopFilter].textAccentClass}`}
          />
          <div className="flex-1 min-w-0">
            <span className="font-bold text-sm">
              {shopFilter === "TIRE" ? "Tires Shop" : "Mufflers Shop"}
            </span>
            <span className="ml-2 text-xs opacity-75">
              Showing only {shopFilter === "TIRE" ? "tire service" : "muffler & exhaust"} repair orders
              {" — "}{metrics.totalActive} active {metrics.totalActive === 1 ? "job" : "jobs"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleShopFilterChange("ALL")}
            className="shrink-0 rounded-lg border border-current/20 bg-white/40 px-2.5 py-1 text-xs font-bold opacity-80 hover:opacity-100 transition"
          >
            Show all shops
          </button>
        </div>
      )}

      {/* Search, Filter Tabs & Lane Jump Toolbar */}
      <section className="mb-4 rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* Search Field */}
          <div className="relative flex-1 max-w-md">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
              <Icon name="search" className="h-4 w-4" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by RO #, vehicle, plate, customer or phone..."
              className="w-full rounded-lg border border-slate-300 bg-slate-50/50 py-2 pl-9 pr-8 text-xs text-ink placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-ink"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filter Chips & Shop Division Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Shop Switcher Pill */}
            <div className="flex items-center gap-1 rounded-2xl bg-white p-1 border border-slate-200 shadow-sm">
              <button
                type="button"
                onClick={() => handleShopFilterChange("ALL")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  shopFilter === "ALL"
                    ? SHOP_PALETTES.ALL.activeTabClass
                    : SHOP_PALETTES.ALL.inactiveTabClass
                }`}
              >
                <Icon name="store" className="h-3.5 w-3.5" /> All Shops
              </button>
              <button
                type="button"
                onClick={() => handleShopFilterChange("TIRE")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  shopFilter === "TIRE"
                    ? SHOP_PALETTES.TIRE.activeTabClass
                    : SHOP_PALETTES.TIRE.inactiveTabClass
                }`}
              >
                <Icon name="tire" className="h-3.5 w-3.5" /> Tires Shop
              </button>
              <button
                type="button"
                onClick={() => handleShopFilterChange("MUFFLER")}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  shopFilter === "MUFFLER"
                    ? SHOP_PALETTES.MUFFLER.activeTabClass
                    : SHOP_PALETTES.MUFFLER.inactiveTabClass
                }`}
              >
                <Icon name="pipe" className="h-3.5 w-3.5" /> Mufflers Shop
              </button>
            </div>

            <button
              type="button"
              onClick={() => setFilterMode("all")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                filterMode === "all"
                  ? "bg-brand-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              All ({metrics.totalActive})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("overdue")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                filterMode === "overdue"
                  ? "bg-red-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-700"
              }`}
            >
              <span>Past Promise</span>
              {metrics.overdue > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    filterMode === "overdue" ? "bg-white text-red-700" : "bg-red-100 text-red-700"
                  }`}
                >
                  {metrics.overdue}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("today")}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                filterMode === "today"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-700"
              }`}
            >
              <span>Promised Today</span>
              {metrics.todayPromise > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    filterMode === "today" ? "bg-white text-amber-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {metrics.todayPromise}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("tasks")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                filterMode === "tasks"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Open Tasks ({metrics.withOpenTasks})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode("ready")}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                filterMode === "ready"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Ready ({metrics.ready})
            </button>

            {/* Density switch */}
            <div className="ml-auto hidden items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 sm:flex">
              <button
                type="button"
                onClick={() => setDensity("comfortable")}
                title="Comfortable card view"
                className={`rounded px-2 py-1 text-xs font-medium transition ${
                  density === "comfortable" ? "bg-white text-ink shadow-xs" : "text-slate-500 hover:text-ink"
                }`}
              >
                Normal
              </button>
              <button
                type="button"
                onClick={() => setDensity("compact")}
                title="Compact view"
                className={`rounded px-2 py-1 text-xs font-medium transition ${
                  density === "compact" ? "bg-white text-ink shadow-xs" : "text-slate-500 hover:text-ink"
                }`}
              >
                Compact
              </button>
            </div>
          </div>
        </div>

        {/* Quick Lane Jump Chips */}
        <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-slate-100 no-scrollbar">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
            Jump to bay:
          </span>
          {board.data?.lanes.map((lane) => {
            const cfg = LANE_CONFIGS[lane.status] ?? {
              title: titleCase(lane.status),
              dotColor: "bg-slate-400",
            };
            return (
              <button
                key={lane.status}
                type="button"
                onClick={() => jumpToLane(lane.status)}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-slate-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700 transition"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotColor}`} />
                <span>{cfg.title}</span>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.2 text-[10px] font-bold text-slate-500">
                  {lane.orders.length}
                </span>
              </button>
            );
          })}
        </div>

        {/* Filter status indicator */}
        {isFilteringActive && (
          <div className="mt-2.5 flex items-center justify-between rounded-lg bg-brand-50/60 px-3 py-1.5 text-xs text-brand-800">
            <span>
              Showing <strong>{totalFilteredCount}</strong> of {metrics.totalActive} active repair orders
            </span>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setFilterMode("all");
              }}
              className="font-semibold text-brand-700 underline hover:text-brand-900"
            >
              Reset filters
            </button>
          </div>
        )}
      </section>

      {/* Advance Error & Optimistic Lock Notice */}
      {advance.error && (
        <div className="mb-4">
          {conflict ? (
            <Notice tone="warn">
              {(advance.error as Error).message}{" "}
              <button
                className="font-medium underline"
                onClick={() => void queryClient.invalidateQueries({ queryKey: ["board"] })}
              >
                Reload the board
              </button>
            </Notice>
          ) : (
            <ErrorBanner error={advance.error} />
          )}
        </div>
      )}

      {/* Main Board Lanes Container */}
      <DataState loading={board.isLoading} error={board.error}>
        <div
          ref={scrollerRef}
          className="scroll-x-visible flex gap-4 pb-6"
          role="region"
          aria-label="Work board lanes, scrollable horizontally"
          tabIndex={0}
          onWheel={(e) => {
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
              e.currentTarget.scrollLeft += e.deltaY;
            }
          }}
        >
          {filteredLanes.map((lane) => {
            const cfg = LANE_CONFIGS[lane.status] ?? {
              title: titleCase(lane.status),
              badge: "bg-slate-100 text-slate-700 border-slate-200",
              accentBorder: "border-t-slate-500",
              headerBg: "bg-slate-50",
              dotColor: "bg-slate-400",
              icon: "board",
              description: "",
            };

            return (
              <div
                key={lane.status}
                id={`lane-${lane.status}`}
                className="scroll-snap-item flex w-[320px] sm:w-[340px] shrink-0 flex-col rounded-2xl border border-slate-200/90 bg-slate-100/50 shadow-xs"
              >
                {/* Lane Header */}
                <div
                  className={`rounded-t-2xl border-t-4 ${cfg.accentBorder} ${cfg.headerBg} p-3.5 border-b border-slate-200/80`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${cfg.dotColor}`} />
                      <h2 className="text-sm font-bold text-ink">{cfg.title}</h2>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${cfg.badge}`}
                    >
                      {lane.orders.length}
                    </span>
                  </div>
                  {cfg.description && (
                    <p className="mt-1 text-[11px] text-slate-500 leading-tight">{cfg.description}</p>
                  )}
                </div>

                {/* Lane Cards List */}
                <div className="flex-1 space-y-3 p-3">
                  {lane.orders.length === 0 && (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300/80 bg-white/50 p-6 text-center">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                        <Icon name={cfg.icon} className="h-5 w-5" />
                      </div>
                      <p className="mt-2 text-xs font-medium text-slate-600">
                        {lane.totalRaw === 0 ? "No vehicles in this bay" : "No matching orders"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {lane.totalRaw === 0
                          ? "Vehicles will appear here as they progress."
                          : "Try adjusting your search or filters."}
                      </p>
                    </div>
                  )}

                  {lane.orders.map((ro) => {
                    const next = PRIMARY_NEXT_LANE[ro.status];
                    const validNextList = VALID_TRANSITIONS[ro.status] ?? [];
                    const alternativeTransitions = validNextList.filter((s) => s !== next);

                    const openTasks = ro.tasks?.filter((t) => t.status !== "DONE").length ?? 0;
                    const totalTasks = ro.tasks?.length ?? 0;
                    const doneTasks = totalTasks - openTasks;
                    const taskPercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

                    const overdue =
                      ro.promisedAt && new Date(ro.promisedAt).getTime() < Date.now();

                    const isPromisedToday = (() => {
                      if (!ro.promisedAt) return false;
                      const t = new Date(ro.promisedAt);
                      const n = new Date();
                      return (
                        t.getDate() === n.getDate() &&
                        t.getMonth() === n.getMonth() &&
                        t.getFullYear() === n.getFullYear()
                      );
                    })();

                    const customerName = customerLabel(ro.customer);
                    const initials = getInitials(ro.customer?.firstName, ro.customer?.lastName);
                    const avatarBg = getAvatarColor(customerName);

                    const latestEstimate = ro.estimates?.[0];

                    return (
                      <article
                        key={ro.id}
                        className={`group relative flex flex-col rounded-xl border border-slate-200/90 bg-white shadow-xs transition hover:border-brand-300 hover:shadow-md ${
                          density === "compact" ? "p-3 space-y-2" : "p-4 space-y-3"
                        }`}
                      >
                        {/* Card Top Bar: RO # & Promise Badge */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Link
                              to={`/jobs/${ro.id}`}
                              className="font-mono text-xs font-bold text-brand-700 bg-brand-50 hover:bg-brand-100 hover:text-brand-900 border border-brand-200/70 rounded-md px-2 py-0.5 transition shrink-0"
                              title="Open Job Workspace"
                            >
                              <span>#</span>
                              {ro.number}
                            </Link>
                            {(() => {
                              const dept = classifyTextDepartment(
                                `${ro.concern || ""} ${ro.tasks?.map((t) => t.description).join(" ") || ""}`,
                                ro.number || ro.id,
                              );
                              const palette = SHOP_PALETTES[dept === "TIRE" ? "TIRE" : dept === "MUFFLER" ? "MUFFLER" : "ALL"];
                              return dept === "TIRE" || dept === "MUFFLER" ? (
                                <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-extrabold uppercase shrink-0 border ${palette.badgeClass}`}>
                                  <Icon name={dept === "TIRE" ? "tire" : "pipe"} className="h-2.5 w-2.5" />
                                  {dept === "TIRE" ? "Tires" : "Mufflers"}
                                </span>
                              ) : null;
                            })()}
                          </div>

                          {overdue ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 border border-red-200 px-2 py-0.5 text-[10px] font-bold text-red-800 animate-pulse">
                              <Icon name="alert" className="h-3 w-3" />
                              Past Promise
                            </span>
                          ) : isPromisedToday ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                              <Icon name="clock" className="h-3 w-3" />
                              Today {timeOnly(ro.promisedAt)}
                            </span>
                          ) : ro.promisedAt ? (
                            <span className="text-[11px] text-slate-500 font-medium">
                              {dateTime(ro.promisedAt)}
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400 italic">No promise date</span>
                          )}
                        </div>

                        {/* Vehicle Information */}
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-display text-sm font-bold text-ink group-hover:text-brand-700 transition-colors leading-snug">
                              {vehicleLabel(ro.vehicle)}
                            </h3>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {ro.vehicle?.plate ? (
                              <span className="font-mono text-[10px] font-bold tracking-wider uppercase px-1.5 py-0.5 bg-slate-100 text-slate-800 border border-slate-300 rounded">
                                {ro.vehicle.plate}
                              </span>
                            ) : null}

                            {ro.mileageIn ? (
                              <span className="text-[11px] text-slate-500">
                                {ro.mileageIn.toLocaleString()} mi
                              </span>
                            ) : null}
                          </div>
                        </div>

                        {/* Customer & Phone */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${avatarBg}`}
                            >
                              {initials}
                            </span>
                            <span className="truncate text-xs font-semibold text-slate-700">
                              {customerName}
                            </span>
                          </div>

                          {ro.customer?.phone && (
                            <a
                              href={`tel:${ro.customer.phone}`}
                              className="shrink-0 text-slate-400 hover:text-brand-600 transition"
                              title={`Call ${customerName}`}
                            >
                              <Icon name="phone" className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>

                        {/* Customer Concern Preview */}
                        {ro.concern && (
                          <div className="rounded-lg bg-slate-50 p-2.5 border-l-2 border-brand-400 text-xs text-slate-600 leading-relaxed">
                            <p className={density === "compact" ? "line-clamp-1" : "line-clamp-2"}>
                              &ldquo;{ro.concern}&rdquo;
                            </p>
                          </div>
                        )}

                        {/* Latest Estimate Badge (if present) */}
                        {latestEstimate && (
                          <div className="flex items-center justify-between text-[11px] rounded-lg bg-slate-50 px-2 py-1 text-slate-600 border border-slate-200/60">
                            <span className="font-medium text-slate-500">
                              Est #{latestEstimate.number}
                            </span>
                            <span
                              className={`font-semibold ${
                                latestEstimate.status === "APPROVED"
                                  ? "text-emerald-700"
                                  : latestEstimate.status === "SENT"
                                  ? "text-blue-700"
                                  : "text-slate-600"
                              }`}
                            >
                              {titleCase(latestEstimate.status)}
                            </span>
                          </div>
                        )}

                        {/* Task Progress Bar */}
                        {totalTasks > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] text-slate-500">
                              <span>
                                {doneTasks}/{totalTasks} tasks complete
                              </span>
                              <span
                                className={`font-semibold ${
                                  doneTasks === totalTasks ? "text-emerald-600" : "text-slate-600"
                                }`}
                              >
                                {taskPercent}%
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  doneTasks === totalTasks ? "bg-emerald-500" : "bg-brand-600"
                                }`}
                                style={{ width: `${taskPercent}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Action Buttons & Status Advancement */}
                        <div className="pt-2 border-t border-slate-100 flex flex-col gap-1.5">
                          {can("jobs.write") && next && (
                            <button
                              type="button"
                              onClick={() =>
                                advance.mutate({ id: ro.id, status: next, version: ro.version })
                              }
                              disabled={advance.isPending}
                              className={`inline-flex items-center justify-center gap-1.5 w-full rounded-lg py-2 px-3 text-xs font-semibold shadow-xs transition active:scale-[0.98] disabled:opacity-50 ${
                                next === "DELIVERED"
                                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                  : "bg-brand-600 text-white hover:bg-brand-700"
                              }`}
                            >
                              {advance.isPending ? (
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                              ) : (
                                <>
                                  <span>Move to {titleCase(next)}</span>
                                  <span>→</span>
                                </>
                              )}
                            </button>
                          )}

                          <div className="flex items-center justify-between gap-2">
                            {/* Alternative stage transition selector */}
                            {can("jobs.write") && alternativeTransitions.length > 0 ? (
                              <select
                                onChange={(e) => {
                                  const targetStatus = e.target.value as RepairOrderStatus;
                                  if (targetStatus) {
                                    advance.mutate({
                                      id: ro.id,
                                      status: targetStatus,
                                      version: ro.version,
                                    });
                                  }
                                  e.target.value = "";
                                }}
                                disabled={advance.isPending}
                                className="flex-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                                defaultValue=""
                              >
                                <option value="" disabled>
                                  Other bay...
                                </option>
                                {alternativeTransitions.map((status) => (
                                  <option key={status} value={status}>
                                    Move to {titleCase(status)}
                                  </option>
                                ))}
                              </select>
                            ) : null}

                            <Link
                              to={`/jobs/${ro.id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 transition"
                            >
                              <span>Workspace</span>
                              <span>↗</span>
                            </Link>

                            {can("jobs.write") && (
                              <button
                                type="button"
                                onClick={() => setDeleteTargetRo(ro)}
                                className="inline-flex items-center rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 transition"
                                title="Delete job"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DataState>

      {deleteTargetRo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              Delete Job #{deleteTargetRo.number}?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently delete repair order <strong>#{deleteTargetRo.number}</strong> ({vehicleLabel(deleteTargetRo.vehicle)}) along with its tasks, estimates, and invoices. This cannot be undone.
            </p>
            {deleteJob.error && (
              <div className="mt-3">
                <ErrorBanner error={deleteJob.error} />
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setDeleteTargetRo(null)}
                disabled={deleteJob.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleteJob.isPending}
                onClick={() => deleteJob.mutate(deleteTargetRo.id)}
              >
                Yes, Delete Job
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Walk-In Check In Modal */}
      {showWalkIn && (
        <WalkInModal
          onClose={() => {
            setShowWalkIn(false);
            void queryClient.invalidateQueries({ queryKey: ["board"] });
          }}
        />
      )}
    </>
  );
}
