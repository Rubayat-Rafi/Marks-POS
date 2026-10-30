import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { customerLabel, dateOnly, money, timeOnly, vehicleLabel } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { Card, DataState, StatTile, StatusBadge, Table } from "../components/ui";
import { ClockWidget } from "../components/ClockWidget";
import { WalkInModal } from "../components/WalkInModal";
import { SwipeRow, type SwipeAction } from "../components/SwipeRow";
import { Icon } from "../components/Icon";
import { classifyTextDepartment } from "../lib/shopDepartment";
import { SHOP_PALETTES } from "../lib/shopColors";
import { DepartmentBadge } from "../components/DepartmentBadge";
import type { BookingRequest, DashboardData, InServiceJob } from "../lib/types";

/**
 * The first screen after sign-in. For the people running the counter it
 * answers three questions at a glance: what is in the bays, what has come in
 * today, and what needs collecting, with "Collect payment" one tap away.
 * A technician gets their own assigned work and the clock instead. The server
 * strips the figures a role may not see (build guide / 03); this file only
 * decides layout.
 */
export function DashboardPage() {
  const { user } = useAuth();

  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/reports/dashboard"),
    // The bays and bookings change all day; keep the board fresh without a reload.
    refetchInterval: 15_000,
  });

  if (user?.role === "TECHNICIAN") {
    return <WorkerDashboard data={dashboard.data} loading={dashboard.isLoading} error={dashboard.error} />;
  }
  return <CounterDashboard data={dashboard.data} loading={dashboard.isLoading} error={dashboard.error} />;
}

type DashboardProps = { data?: DashboardData; loading: boolean; error: unknown };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// ---------------------------------------------------------------------------
// Owner, manager, advisor, bookkeeper: the counter
// ---------------------------------------------------------------------------

function CounterDashboard({ data, loading, error }: DashboardProps) {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [walkIn, setWalkIn] = useState(false);
  const [shopFilter, setShopFilter] = useState<"ALL" | "TIRE" | "MUFFLER">("ALL");

  type DailySalesSnapshot = {
    totals: { net: number; tax: number; gross: number; count: number };
    tireShop: {
      shopName: string;
      totals: { net: number; tax: number; gross: number; invoiceCount: number; lineCount: number };
    };
    mufflersShop: {
      shopName: string;
      totals: { net: number; tax: number; gross: number; invoiceCount: number; lineCount: number };
    };
  };

  const sales = useQuery({
    queryKey: ["daily-sales", "dashboard-snapshot"],
    queryFn: () => api.get<DailySalesSnapshot>("/reports/daily-sales"),
    enabled: user?.role === "OWNER" && can("reports.sales"),
  });

  const filteredInService = useMemo(() => {
    if (!data?.inService) return [];
    if (shopFilter === "ALL") return data.inService;
    return data.inService.filter(
      (j) => (j.department ?? classifyTextDepartment(j.concern, j.number || j.id)) === shopFilter,
    );
  }, [data?.inService, shopFilter]);

  const filteredAppointments = useMemo(() => {
    if (!data?.appointmentsToday) return [];
    if (shopFilter === "ALL") return data.appointmentsToday;
    return data.appointmentsToday.filter(
      (a) => (a.department ?? classifyTextDepartment(a.concern, a.id)) === shopFilter,
    );
  }, [data?.appointmentsToday, shopFilter]);

  const collectable = filteredInService.filter((j) => (j.invoice?.balance ?? 0) > 0);

  const tireRev = data?.revenueByShop?.tireShop;
  const mufflerRev = data?.revenueByShop?.mufflersShop;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          title={`${greeting()}, ${user?.firstName}`}
          description={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        />

        {/* Shop / Division Selector Pill */}
        <div className="flex items-center gap-1.5 rounded-2xl bg-white p-1.5 shadow-sm border border-slate-200">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-2">Shop:</span>
          <button
            type="button"
            onClick={() => setShopFilter("ALL")}
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
            onClick={() => setShopFilter("TIRE")}
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
            onClick={() => setShopFilter("MUFFLER")}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              shopFilter === "MUFFLER"
                ? SHOP_PALETTES.MUFFLER.activeTabClass
                : SHOP_PALETTES.MUFFLER.inactiveTabClass
            }`}
          >
            <Icon name="pipe" className="h-3.5 w-3.5" /> Mufflers Shop
          </button>
        </div>
      </div>

      {/* One-tap actions. Quick Sale / Register is the primary action on the screen. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 mt-2">
        {(can("sales.quick") || can("payments.collect")) && (
          <ActionTile
            to={shopFilter === "ALL" ? "/quick-sale" : `/quick-sale?shop=${shopFilter.toLowerCase()}`}
            icon="cash"
            title="Quick Sale / POS"
            sub={
              collectable.length > 0
                ? `${collectable.length} ready to collect`
                : shopFilter === "TIRE"
                ? "Tires Counter sales"
                : shopFilter === "MUFFLER"
                ? "Mufflers Counter sales"
                : "Counter sales (Both Shops)"
            }
            primary
          />
        )}
        {can("jobs.write") && (
          <ActionTile onClick={() => setWalkIn(true)} icon="plus" title="Check in a car" sub="Walk-in" />
        )}
        {can("inventory.receive") && (
          <ActionTile
            to={shopFilter === "ALL" ? "/inventory" : `/inventory?kind=${shopFilter}`}
            icon="box"
            title="Inventory"
            sub={
              shopFilter === "TIRE"
                ? "Tires & wheels inventory"
                : shopFilter === "MUFFLER"
                ? "Exhaust & mufflers inventory"
                : "Tires & mufflers"
            }
          />
        )}
        {can("reports.sales") && (
          <ActionTile
            to={shopFilter === "ALL" ? "/reports" : `/reports?shop=${shopFilter.toLowerCase()}`}
            icon="receipt"
            title="Reports"
            sub={
              shopFilter === "TIRE"
                ? "Tires Shop Reports"
                : shopFilter === "MUFFLER"
                ? "Mufflers Shop Reports"
                : "Separate Revenue Breakdown"
            }
          />
        )}
      </div>
      {walkIn && <WalkInModal onClose={() => setWalkIn(false)} />}

      <DataState loading={loading} error={error}>
        {data && (
          <>
            {/* Active filter banner when a specific shop is selected */}
            {shopFilter !== "ALL" && (
              <div
                className={`mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-2.5 ${
                  shopFilter === "TIRE"
                    ? SHOP_PALETTES.TIRE.bannerClass
                    : SHOP_PALETTES.MUFFLER.bannerClass
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-black uppercase tracking-wider ${
                      shopFilter === "TIRE"
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "bg-orange-600 text-white shadow-xs"
                    }`}
                  >
                    <span>{shopFilter === "TIRE" ? "🛞" : "🔧"}</span>
                    {shopFilter === "TIRE" ? "Tires Shop Only" : "Mufflers Shop Only"}
                  </span>
                  <span className="text-xs font-medium text-slate-600">
                    Showing metrics, bays, and appointments exclusively for {shopFilter === "TIRE" ? "Tires Shop" : "Mufflers Shop"}.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShopFilter("ALL")}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    shopFilter === "TIRE"
                      ? "text-emerald-800 hover:bg-emerald-100/60"
                      : "text-orange-900 hover:bg-orange-100/60"
                  }`}
                >
                  ✕ Show All Shops (Combined)
                </button>
              </div>
            )}

            {/* Main Revenue & Metrics Dashboard */}
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {shopFilter === "ALL" ? (
                <>
                  {/* ALL SHOPS CARD 1: Today's Total Revenue (Combined) */}
                  {data.cashCollectedToday !== null ? (
                    <StatTile
                      label="Today's Total Revenue"
                      value={money(data.cashCollectedToday ?? 0)}
                      sub={`${data.paymentsToday} payment(s) today • 30d: ${money(sales.data?.totals?.net ?? 0)}`}
                      tone="good"
                    />
                  ) : (
                    <StatTile label="Payments today" value={String(data.paymentsToday)} sub="Amounts restricted for your role" />
                  )}

                  {/* ALL SHOPS CARD 2: Tires Shop Breakdown (clickable) */}
                  <div
                    onClick={() => setShopFilter("TIRE")}
                    className="cursor-pointer rounded-2xl border border-emerald-200/90 bg-gradient-to-b from-emerald-50/40 to-white p-4 transition hover:border-emerald-400 hover:shadow-md hover:shadow-emerald-600/10 shadow-xs"
                    title="Click to view Tires Shop only"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-emerald-800">
                        <span>🛞</span> Tires Shop
                      </span>
                      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-extrabold text-emerald-800">
                        {tireRev?.paymentsCount ?? 0} today
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Today's Revenue</span>
                        <p className="text-2xl font-black tabular-nums text-slate-900">
                          {tireRev?.revenue !== null ? money(tireRev?.revenue ?? 0) : "—"}
                        </p>
                      </div>
                      {sales.data?.tireShop && (
                        <div className="text-right">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">30d Sales</span>
                          <p className="text-sm font-extrabold tabular-nums text-emerald-700">
                            {money(sales.data.tireShop.totals.net)}
                          </p>
                        </div>
                      )}
                    </div>
                    <p className="mt-1.5 pt-1.5 border-t border-emerald-100 text-xs text-slate-500 flex items-center justify-between">
                      <span>Invoiced today: <strong className="font-semibold text-slate-700">{tireRev?.invoiced !== null ? money(tireRev?.invoiced ?? 0) : "—"}</strong> ({tireRev?.invoicedCount ?? 0} inv)</span>
                      <span className="text-[10px] font-bold text-emerald-700 underline">Isolate →</span>
                    </p>
                  </div>

                  {/* ALL SHOPS CARD 3: Mufflers Shop Breakdown (clickable) */}
                  <div
                    onClick={() => setShopFilter("MUFFLER")}
                    className="cursor-pointer rounded-2xl border border-orange-200/90 bg-gradient-to-b from-orange-50/40 to-white p-4 transition hover:border-orange-400 hover:shadow-md hover:shadow-orange-600/10 shadow-xs"
                    title="Click to view Mufflers Shop only"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-orange-900">
                        <span>🔧</span> Mufflers Shop
                      </span>
                      <span className="rounded-md bg-orange-100 px-2 py-0.5 text-[11px] font-extrabold text-orange-900">
                        {mufflerRev?.paymentsCount ?? 0} today
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Today's Revenue</span>
                        <p className="text-2xl font-black tabular-nums text-slate-900">
                          {mufflerRev?.revenue !== null ? money(mufflerRev?.revenue ?? 0) : "—"}
                        </p>
                      </div>
                      {sales.data?.mufflersShop && (
                        <div className="text-right">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">30d Sales</span>
                          <p className="text-sm font-extrabold tabular-nums text-orange-700">
                            {money(sales.data.mufflersShop.totals.net)}
                          </p>
                        </div>
                      )}
                    </div>
                    <p className="mt-1.5 pt-1.5 border-t border-orange-100 text-xs text-slate-500 flex items-center justify-between">
                      <span>Invoiced today: <strong className="font-semibold text-slate-700">{mufflerRev?.invoiced !== null ? money(mufflerRev?.invoiced ?? 0) : "—"}</strong> ({mufflerRev?.invoicedCount ?? 0} inv)</span>
                      <span className="text-[10px] font-bold text-orange-700 underline">Isolate →</span>
                    </p>
                  </div>

                  {/* ALL SHOPS CARD 4: Combined In The Bays */}
                  <StatTile
                    label="Cars in the bays"
                    value={`${filteredInService.length} vehicle(s)`}
                    sub={
                      filteredInService.length === 0
                        ? "No cars in the shop"
                        : `${filteredInService.filter((j) => (j.department ?? classifyTextDepartment(j.concern, j.number || j.id)) === "TIRE").length} Tires · ${filteredInService.filter((j) => (j.department ?? classifyTextDepartment(j.concern, j.number || j.id)) === "MUFFLER").length} Mufflers`
                    }
                  />
                </>
              ) : shopFilter === "TIRE" ? (
                <>
                  {/* TIRES ONLY CARD 1: Tires Today's Revenue */}
                  <StatTile
                    label="🛞 Tires Today's Revenue"
                    value={tireRev?.revenue !== null ? money(tireRev?.revenue ?? 0) : "—"}
                    sub={`${tireRev?.paymentsCount ?? 0} tire payment(s) today`}
                    tone="good"
                  />

                  {/* TIRES ONLY CARD 2: Tires Invoiced Today */}
                  <StatTile
                    label="🛞 Tires Invoiced Today"
                    value={tireRev?.invoiced !== null ? money(tireRev?.invoiced ?? 0) : "—"}
                    sub={`${tireRev?.invoicedCount ?? 0} invoice(s) generated today`}
                  />

                  {/* TIRES ONLY CARD 3: Tires 30-Day Net Sales */}
                  <StatTile
                    label="🛞 Tires 30-Day Sales"
                    value={sales.data?.tireShop ? money(sales.data.tireShop.totals.net) : "—"}
                    sub={`${sales.data?.tireShop?.totals?.invoiceCount ?? 0} invoices (excl. sales tax)`}
                  />

                  {/* TIRES ONLY CARD 4: Tires In The Bays */}
                  <StatTile
                    label="🛞 Tires in the bays"
                    value={`${filteredInService.length} vehicle(s)`}
                    sub="Active tire service jobs"
                  />
                </>
              ) : (
                <>
                  {/* MUFFLERS ONLY CARD 1: Mufflers Today's Revenue */}
                  <StatTile
                    label="🔧 Mufflers Today's Revenue"
                    value={mufflerRev?.revenue !== null ? money(mufflerRev?.revenue ?? 0) : "—"}
                    sub={`${mufflerRev?.paymentsCount ?? 0} muffler payment(s) today`}
                    tone="good"
                  />

                  {/* MUFFLERS ONLY CARD 2: Mufflers Invoiced Today */}
                  <StatTile
                    label="🔧 Mufflers Invoiced Today"
                    value={mufflerRev?.invoiced !== null ? money(mufflerRev?.invoiced ?? 0) : "—"}
                    sub={`${mufflerRev?.invoicedCount ?? 0} invoice(s) generated today`}
                  />

                  {/* MUFFLERS ONLY CARD 3: Mufflers 30-Day Net Sales */}
                  <StatTile
                    label="🔧 Mufflers 30-Day Sales"
                    value={sales.data?.mufflersShop ? money(sales.data.mufflersShop.totals.net) : "—"}
                    sub={`${sales.data?.mufflersShop?.totals?.invoiceCount ?? 0} invoices (excl. sales tax)`}
                  />

                  {/* MUFFLERS ONLY CARD 4: Mufflers In The Bays */}
                  <StatTile
                    label="🔧 Mufflers in the bays"
                    value={`${filteredInService.length} vehicle(s)`}
                    sub="Active muffler service jobs"
                  />
                </>
              )}
            </div>

            <Alerts data={data} shopFilter={shopFilter} />

            <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_1fr] [&>*]:min-w-0">
              <Card
                title={`In the bays ${shopFilter === "ALL" ? "" : shopFilter === "TIRE" ? "(Tires Shop)" : "(Mufflers Shop)"}`}
                action={
                  <Link
                    to={shopFilter === "ALL" ? "/board" : `/board?shop=${shopFilter.toLowerCase()}`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
                  >
                    <span>Work board</span>
                    {shopFilter !== "ALL" && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                          shopFilter === "TIRE"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-blue-100 text-blue-800"
                        }`}
                      >
                        {shopFilter === "TIRE" ? "Tires" : "Mufflers"}
                      </span>
                    )}
                  </Link>
                }
              >
                <DataState
                  empty={filteredInService.length === 0}
                  emptyMessage={
                    shopFilter === "ALL"
                      ? "No cars checked in right now."
                      : `No ${shopFilter === "TIRE" ? "Tires" : "Mufflers"} Shop cars checked in right now.`
                  }
                >
                  <p className="mb-3 text-xs text-slate-500 sm:hidden">Swipe a car left to collect or open it.</p>
                  <ul className="-mx-1 space-y-2">
                    {filteredInService.map((job) => (
                      <li key={job.id}>
                        <BayRow job={job} onNavigate={navigate} canCollect={can("payments.collect")} />
                      </li>
                    ))}
                  </ul>
                </DataState>
              </Card>

              <div className="min-w-0 space-y-5">
                {can("bookings.read") && <BookingRequests shopFilter={shopFilter} />}
                <AppointmentsCard
                  appointments={filteredAppointments}
                  totalRequests={
                    shopFilter === "TIRE"
                      ? data.newBookingRequestsByShop?.tireShop ?? data.newBookingRequests
                      : shopFilter === "MUFFLER"
                      ? data.newBookingRequestsByShop?.mufflersShop ?? data.newBookingRequests
                      : data.newBookingRequests
                  }
                  shopFilter={shopFilter}
                />
              </div>
            </div>

          </>
        )}
      </DataState>
    </>
  );
}

function ActionTile({
  to,
  onClick,
  icon,
  title,
  sub,
  primary,
}: {
  to?: string;
  onClick?: () => void;
  icon: string;
  title: string;
  sub: string;
  primary?: boolean;
}) {
  const className = `group flex min-h-[104px] flex-col justify-between rounded-2xl p-4 text-left transition active:scale-[0.98] ${
    primary
      ? "bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-lift hover:from-brand-500 hover:to-brand-700"
      : "border border-slate-200/80 bg-white text-ink shadow-card hover:border-brand-200"
  }`;
  const body = (
    <>
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-xl ${
          primary ? "bg-white/15" : "bg-brand-50 text-brand-600 group-hover:bg-brand-600 group-hover:text-white"
        }`}
      >
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="mt-3 block">
        <span className="block font-display text-base font-bold sm:text-lg">{title}</span>
        <span className={`block text-xs ${primary ? "text-brand-100" : "text-slate-500"}`}>{sub}</span>
      </span>
    </>
  );
  return to ? (
    <Link to={to} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

function Alerts({
  data,
  shopFilter = "ALL",
}: {
  data: DashboardData;
  shopFilter?: "ALL" | "TIRE" | "MUFFLER";
}) {
  const { can } = useAuth();
  const items: Array<{ icon: string; text: React.ReactNode; to: string; cta: string; tone: string }> = [];

  const lowStock =
    shopFilter === "TIRE"
      ? data.lowStockCountByShop?.tireShop ?? data.lowStockCount ?? 0
      : shopFilter === "MUFFLER"
      ? data.lowStockCountByShop?.mufflersShop ?? data.lowStockCount ?? 0
      : data.lowStockCount ?? 0;

  if (lowStock > 0) {
    items.push({
      icon: "box",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
      text: (
        <>
          <strong>
            {lowStock} {shopFilter === "TIRE" ? "tire" : shopFilter === "MUFFLER" ? "muffler" : ""} item
            {lowStock === 1 ? "" : "s"}
          </strong>{" "}
          at or below the reorder point. Time to order more{" "}
          {shopFilter === "TIRE" ? "tires." : shopFilter === "MUFFLER" ? "mufflers." : "tires or mufflers."}
        </>
      ),
      to: shopFilter === "ALL" ? "/inventory?view=low" : `/inventory?view=low&kind=${shopFilter}`,
      cta: "See what to reorder",
    });
  }

  const bookingReqCount =
    shopFilter === "TIRE"
      ? data.newBookingRequestsByShop?.tireShop ?? data.newBookingRequests ?? 0
      : shopFilter === "MUFFLER"
      ? data.newBookingRequestsByShop?.mufflersShop ?? data.newBookingRequests ?? 0
      : data.newBookingRequests ?? 0;

  if (bookingReqCount > 0 && can("bookings.read")) {
    items.push({
      icon: "calendar",
      tone: "border-brand-200 bg-brand-50 text-brand-950 shadow-xs",
      text: (
        <>
          <strong>
            {bookingReqCount} {shopFilter === "TIRE" ? "Tires Shop" : shopFilter === "MUFFLER" ? "Mufflers Shop" : "website"}{" "}
            booking request{bookingReqCount === 1 ? "" : "s"}
          </strong>{" "}
          received online. Call to confirm or add directly to the appointment calendar.
        </>
      ),
      to:
        shopFilter === "ALL"
          ? "/appointments?tab=requests"
          : `/appointments?tab=requests&shop=${shopFilter.toLowerCase()}`,
      cta: "Review requests",
    });
  }
  if (shopFilter === "ALL" && data.openReconciliationItems > 0 && can("finance.reconcile")) {
    items.push({
      icon: "alert",
      tone: "border-slate-200 bg-white text-ink",
      text: (
        <>
          <strong>{data.openReconciliationItems}</strong> payment exception(s) need a look.
        </>
      ),
      to: "/finance",
      cta: "Open",
    });
  }
  if (items.length === 0) return null;

  return (
    <div className="mt-4 space-y-2">
      {items.map((item) => (
        <div key={item.to} className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${item.tone}`}>
          <Icon name={item.icon} className="h-5 w-5 shrink-0" />
          <p className="min-w-0 flex-1">{item.text}</p>
          <Link to={item.to} className="font-semibold underline-offset-2 hover:underline">
            {item.cta}
          </Link>
        </div>
      ))}
    </div>
  );
}

function BayRow({
  job,
  onNavigate,
  canCollect,
}: {
  job: InServiceJob;
  onNavigate: (to: string) => void;
  canCollect: boolean;
}) {
  const inv = job.invoice;
  const owes = (inv?.balance ?? 0) > 0;
  const actions: SwipeAction[] = [];
  if (inv && owes && canCollect) {
    actions.push({ label: "Collect", icon: "cash", tone: "brand", onAction: () => onNavigate(`/quick-sale/${inv.id}`) });
  }
  if (inv && inv.status === "PAID") {
    actions.push({ label: "Receipt", icon: "printer", tone: "green", onAction: () => onNavigate(`/receipts/${inv.id}`) });
  }
  actions.push({ label: "Open", icon: "chevronRight", tone: "slate", onAction: () => onNavigate(`/jobs/${job.id}`) });

  return (
    <SwipeRow actions={actions} onOpen={() => onNavigate(`/jobs/${job.id}`)}>
      <div className="flex items-center gap-3 border border-slate-100 bg-white px-3 py-3 sm:rounded-xl sm:border-0">
        <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 sm:flex">
          <Icon name="wrench" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold text-ink">{vehicleLabel(job.vehicle)}</p>
            {(() => {
              const dept = job.department ?? classifyTextDepartment(job.concern, job.number || job.id);
              return <DepartmentBadge department={dept} size="xs" />;
            })()}
          </div>
          <p className="truncate text-xs text-slate-500">
            {customerLabel(job.customer)} · <span className="font-mono">{job.number}</span>
            {job.checkedInAt && ` · in ${timeOnly(job.checkedInAt)}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={job.status} />
          {inv && inv.balance !== null && (
            <span className={`text-xs font-semibold tabular-nums ${owes ? "text-amber-700" : "text-emerald-700"}`}>
              {owes ? `${money(inv.balance)} due` : "Paid"}
            </span>
          )}
        </div>
      </div>
    </SwipeRow>
  );
}

function BookingRequests({ shopFilter = "ALL" }: { shopFilter?: "ALL" | "TIRE" | "MUFFLER" }) {
  const queryClient = useQueryClient();
  const requests = useQuery({
    queryKey: ["booking-requests"],
    queryFn: () => api.get<{ data: BookingRequest[] }>("/booking-requests"),
    refetchInterval: 15_000,
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BookingRequest["status"] }) =>
      api.patch(`/booking-requests/${id}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const convert = useMutation({
    mutationFn: (id: string) =>
      api.post<{ appointment: { id: string }; message: string }>(`/booking-requests/${id}/convert`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/booking-requests/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  void ({
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["appointments"] });
    },
  });

  const allRequests = requests.data?.data ?? [];
  const filteredRequests = useMemo(() => {
    if (shopFilter === "ALL") return allRequests;
    return allRequests.filter(
      (r) => classifyTextDepartment(`${r.service} ${r.notes || ""}`, r.id) === shopFilter,
    );
  }, [allRequests, shopFilter]);

  if (shopFilter !== "ALL" && filteredRequests.length === 0 && !requests.isLoading) {
    return null;
  }

  return (
    <Card
      title={`Website booking requests ${shopFilter === "ALL" ? "" : shopFilter === "TIRE" ? "(Tires Shop)" : "(Mufflers Shop)"}`}
      action={
        <Link
          to={shopFilter === "ALL" ? "/appointments?tab=requests" : `/appointments?tab=requests&shop=${shopFilter.toLowerCase()}`}
          className="text-xs font-semibold text-brand-600 hover:underline"
        >
          View all requests →
        </Link>
      }
    >
      <DataState
        loading={requests.isLoading}
        error={requests.error}
        empty={filteredRequests.length === 0}
        emptyMessage={shopFilter === "ALL" ? "All caught up." : `No pending ${shopFilter === "TIRE" ? "Tires" : "Mufflers"} Shop requests.`}
      >
        <ul className="divide-y divide-slate-100">
          {filteredRequests.map((r) => {
            const dept = classifyTextDepartment(`${r.service} ${r.notes || ""}`, r.id);
            return (
              <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-ink">
                        {r.name} <span className="font-normal text-slate-500">· {r.service}</span>
                      </p>
                      {shopFilter === "ALL" && (
                        <DepartmentBadge department={dept} size="xs" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {[r.vehicle, r.preferredDate && `wants ${dateOnly(r.preferredDate)}`, r.preferredTime]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {r.notes && <p className="mt-1 text-sm text-slate-600 italic">“{r.notes}”</p>}
                  </div>
                  <StatusBadge status={r.status === "NEW" ? "PENDING" : r.status} />
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => convert.mutate(r.id)}
                    disabled={convert.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition"
                  >
                    <Icon name="check" className="h-3.5 w-3.5" />
                    <span>{convert.isPending ? "Booking..." : "Book to Calendar"}</span>
                  </button>
                  <a
                    href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 transition"
                  >
                    <Icon name="phone" className="h-3.5 w-3.5" /> {r.phone}
                  </a>
                  {r.status === "NEW" && (
                    <button
                      type="button"
                      onClick={() => update.mutate({ id: r.id, status: "CONTACTED" })}
                      className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Mark Contacted
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => update.mutate({ id: r.id, status: "CLOSED" })}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-red-600"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete booking request from ${r.name}?`)) {
                        remove.mutate(r.id);
                      }
                    }}
                    disabled={remove.isPending}
                    className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </DataState>
    </Card>
  );
}

function AppointmentsCard({
  appointments,
  totalRequests,
  shopFilter = "ALL",
}: {
  appointments: DashboardData["appointmentsToday"];
  totalRequests?: number | null;
  shopFilter?: "ALL" | "TIRE" | "MUFFLER";
}) {
  return (
    <Card
      title={`Today's appointments ${shopFilter === "ALL" ? "" : shopFilter === "TIRE" ? "(Tires Shop)" : "(Mufflers Shop)"}`}
      action={
        <Link
          to={shopFilter === "ALL" ? "/appointments" : `/appointments?shop=${shopFilter.toLowerCase()}`}
          className="text-sm font-semibold text-brand-600 hover:underline"
        >
          All
        </Link>
      }
    >
      {(totalRequests ?? 0) > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-brand-50 p-2.5 text-xs text-brand-900 border border-brand-200/80">
          <span className="flex items-center gap-1.5 font-medium">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
              {totalRequests}
            </span>
            <span>
              {shopFilter === "TIRE"
                ? "Tires Shop booking request(s) waiting for review"
                : shopFilter === "MUFFLER"
                ? "Mufflers Shop booking request(s) waiting for review"
                : "Online booking request(s) waiting for review"}
            </span>
          </span>
          <Link
            to={shopFilter === "ALL" ? "/appointments?tab=requests" : `/appointments?tab=requests&shop=${shopFilter.toLowerCase()}`}
            className="font-bold underline hover:text-brand-700"
          >
            Review
          </Link>
        </div>
      )}
      <DataState
        empty={appointments.length === 0}
        emptyMessage={
          shopFilter === "ALL"
            ? "No appointments booked for today."
            : `No ${shopFilter === "TIRE" ? "Tires" : "Mufflers"} Shop appointments booked for today.`
        }
      >
        <ul className="divide-y divide-slate-100">
          {appointments.map((appt) => {
            const dept = appt.department ?? classifyTextDepartment(appt.concern, appt.id);
            return (
              <li key={appt.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="w-16 shrink-0 text-sm font-bold tabular-nums text-ink">{timeOnly(appt.scheduledFor)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">{customerLabel(appt.customer)}</p>
                    {shopFilter === "ALL" && (
                      <DepartmentBadge department={dept} size="xs" />
                    )}
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {vehicleLabel(appt.vehicle)} · {appt.concern}
                  </p>
                </div>
                <StatusBadge status={appt.status} />
              </li>
            );
          })}
        </ul>
      </DataState>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Technician: my jobs and the clock
// ---------------------------------------------------------------------------

function WorkerDashboard({ data, loading, error }: DashboardProps) {
  const { user } = useAuth();

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user?.firstName}`}
        description={data ? `Your assigned work. Times shown in ${data.timezone}.` : undefined}
      />

      <DataState loading={loading} error={error}>
        {data && (
          <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              <ClockWidget />
              <div className="grid grid-cols-2 gap-4">
                <StatTile label="My open tasks" value={String(data.myOpenTasks.length)} />
                <StatTile label="Cars in the shop" value={String(data.inService.length)} />
              </div>
            </div>

            <div className="space-y-5">
              <Card title="My open tasks">
                <DataState empty={data.myOpenTasks.length === 0} emptyMessage="Nothing assigned to you right now.">
                  <Table headers={["Job", "Vehicle", "Task", "Status", ""]}>
                    {data.myOpenTasks.map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2 font-mono text-xs">{t.repairOrder.number}</td>
                        <td className="px-3 py-2 text-slate-600">{vehicleLabel(t.repairOrder.vehicle)}</td>
                        <td className="px-3 py-2 text-slate-600">{t.description}</td>
                        <td className="px-3 py-2">
                          <StatusBadge status={t.status} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link to={`/jobs/${t.repairOrder.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </Table>
                </DataState>
              </Card>

              <AppointmentsCard appointments={data.appointmentsToday} totalRequests={data.newBookingRequests} />
            </div>
          </div>
        )}
      </DataState>
    </>
  );
}
