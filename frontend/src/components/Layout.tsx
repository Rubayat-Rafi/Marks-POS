import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { titleCase } from "../lib/format";
import { BrandName } from "./Brand";
import { Icon } from "./Icon";

type NavItem = {
  to: string;
  label: string;
  icon: string;
  permission: string;
  badge?: "lowStock" | "bookingRequests";
};

/** The navigation from build guide / 03, filtered by what the role may see. */
const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "home", permission: "jobs.read" },
  { to: "/quick-sale", label: "Quick sale / POS", icon: "cash", permission: "sales.quick" },
  { to: "/inventory", label: "Inventory", icon: "box", permission: "inventory.read", badge: "lowStock" },
  { to: "/board", label: "Work board", icon: "board", permission: "jobs.read" },
  { to: "/appointments", label: "Appointments", icon: "calendar", permission: "appointments.read", badge: "bookingRequests" },
  { to: "/customers", label: "Customers", icon: "users", permission: "customers.read" },
  { to: "/timeclock", label: "Time clock", icon: "clock", permission: "timeclock.use" },
  { to: "/parts-catalog", label: "Parts catalog", icon: "wrench", permission: "jobs.read" },
  { to: "/finance", label: "Finance", icon: "chart", permission: "finance.read" },
  { to: "/reports", label: "Daily Sales & Invoices", icon: "chart", permission: "reports.sales" },
  { to: "/audit", label: "Audit trail", icon: "shield", permission: "audit.read" },
  { to: "/settings", label: "Settings", icon: "settings", permission: "settings.read" },
];

/** The four tabs on a phone, with Quick sale / POS in the middle where the thumb is. */
const BOTTOM_TABS = ["/dashboard", "/quick-sale", "/inventory", "/board"];

function useLowStockCount(enabled: boolean) {
  const q = useQuery({
    queryKey: ["inventory", "low-stock"],
    queryFn: () => api.get<{ count: number }>("/inventory/low-stock"),
    enabled,
    staleTime: 60_000,
  });
  return q.data?.count ?? 0;
}

function useBookingRequestsCount(enabled: boolean) {
  const q = useQuery({
    queryKey: ["booking-requests", "badge-count"],
    queryFn: () => api.get<{ data: Array<{ status: string }> }>("/booking-requests"),
    enabled,
    refetchInterval: 20_000,
  });
  return q.data?.data.filter((r) => r.status === "NEW" || r.status === "CONTACTED").length ?? 0;
}

function Badge({ count, color = "amber" }: { count: number; color?: "amber" | "brand" }) {
  if (count <= 0) return null;
  const bg = color === "brand" ? "bg-brand-600" : "bg-amber-500";
  return (
    <span className={`ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full ${bg} px-1.5 text-[11px] font-bold text-white shadow-xs`}>
      {count}
    </span>
  );
}

export type LayoutContextType = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  fullscreenPos: boolean;
  setFullscreenPos: React.Dispatch<React.SetStateAction<boolean>>;
};

import { createContext, useContext } from "react";

import { useBrowserFullscreen } from "../lib/useBrowserFullscreen";

export const LayoutContext = createContext<LayoutContextType>({
  sidebarCollapsed: false,
  setSidebarCollapsed: () => {},
  fullscreenPos: false,
  setFullscreenPos: () => {},
});

export const useLayout = () => useContext(LayoutContext);

export function Layout() {
  const { user, signOut, can } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  const isPosPage = location.pathname.startsWith("/pos") || location.pathname.startsWith("/quick-sale");
  const { isFullscreen: isNativeFs } = useBrowserFullscreen();

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sidebar.collapsed") === "1";
    } catch {
      return false;
    }
  });

  const [fullscreenPos, setFullscreenPos] = useState<boolean>(() => {
    try {
      return localStorage.getItem("pos.fullscreen") === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("sidebar.collapsed", sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    try {
      localStorage.setItem("pos.fullscreen", fullscreenPos ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [fullscreenPos]);

  const visible = NAV.filter((item) => can(item.permission));
  const lowStock = useLowStockCount(can("inventory.read"));
  const bookingRequestsCount = useBookingRequestsCount(can("bookings.read"));
  const tabs = BOTTOM_TABS.map((to) => visible.find((n) => n.to === to)).filter(Boolean) as NavItem[];
  const moreItems = visible.filter((n) => !BOTTOM_TABS.includes(n.to));

  useEffect(() => setMoreOpen(false), [location.pathname]);

  const isDedicatedPosView = isPosPage && (fullscreenPos || isNativeFs);

  return (
    <LayoutContext.Provider value={{ sidebarCollapsed, setSidebarCollapsed, fullscreenPos, setFullscreenPos }}>
      <div className="min-h-screen bg-slate-50">
        {/* Sidebar: desktops and landscape tablets (hidden when in dedicated POS fullscreen mode). */}
        {!isDedicatedPosView && (
          <aside
            className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-slate-200 bg-white print:hidden lg:flex transition-all duration-200 ${
              sidebarCollapsed ? "w-16" : "w-64"
            }`}
          >
            <div className={`flex h-16 items-center ${sidebarCollapsed ? "justify-center px-2" : "justify-between px-5"}`}>
              <Link to="/dashboard">
                <BrandName compact={sidebarCollapsed} iconOnly={sidebarCollapsed} />
              </Link>
              {!sidebarCollapsed && (
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink"
                  title="Collapse sidebar for wider view"
                  aria-label="Collapse sidebar"
                >
                  <Icon name="chevronLeft" className="h-4 w-4" />
                </button>
              )}
            </div>

            <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
              {visible.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    `relative flex items-center rounded-xl text-sm font-semibold transition ${
                      sidebarCollapsed
                        ? "justify-center h-10 w-10 mx-auto"
                        : "gap-3 px-3 py-2.5"
                    } ${
                      isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-ink"
                    }`
                  }
                >
                  <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                  {!sidebarCollapsed && <span>{item.label}</span>}
                  {!sidebarCollapsed && item.badge === "lowStock" && <Badge count={lowStock} />}
                  {!sidebarCollapsed && item.badge === "bookingRequests" && (
                    <Badge count={bookingRequestsCount} color="brand" />
                  )}
                  {sidebarCollapsed && item.badge === "lowStock" && lowStock > 0 && (
                    <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-amber-500" />
                  )}
                  {sidebarCollapsed && item.badge === "bookingRequests" && bookingRequestsCount > 0 && (
                    <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-brand-600 ring-2 ring-white" />
                  )}
                </NavLink>
              ))}
            </nav>

            <div className="border-t border-slate-100 p-2">
              {sidebarCollapsed ? (
                <div className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(false)}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-ink"
                    title="Expand sidebar"
                    aria-label="Expand sidebar"
                  >
                    <Icon name="chevronRight" className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={signOut}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-ink"
                    title="Sign out"
                    aria-label="Sign out"
                  >
                    <Icon name="logout" className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
                    {user?.firstName?.[0]}
                    {user?.lastName?.[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="truncate text-xs text-slate-500">{titleCase(user?.role ?? "")}</p>
                  </div>
                  <button
                    type="button"
                    onClick={signOut}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-ink"
                    aria-label="Sign out"
                    title="Sign out"
                  >
                    <Icon name="logout" className="h-5 w-5" />
                  </button>
                </div>
              )}
            </div>
          </aside>
        )}

        {/* Top bar: phones and portrait tablets (hidden when in dedicated POS fullscreen mode). */}
        {!isDedicatedPosView && (
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur print:hidden lg:hidden">
            <div className="flex h-14 items-center justify-between px-4">
              <Link to="/dashboard">
                <BrandName compact />
              </Link>
              <div className="flex items-center gap-1">
                {can("sales.quick") && (
                  <Link
                    to="/quick-sale"
                    className="hidden items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white sm:inline-flex"
                  >
                    <Icon name="plus" className="h-4 w-4" /> Quick sale
                  </Link>
                )}
                <button
                  type="button"
                  onClick={signOut}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label="Sign out"
                >
                  <Icon name="logout" className="h-5 w-5" />
                </button>
              </div>
            </div>
          </header>
        )}

        {/* Main Content: automatically adopts full width & height for POS pages */}
        <main
          className={`print:m-0 print:p-0 transition-all duration-200 ${
            isDedicatedPosView
              ? "p-0 m-0 w-screen h-screen overflow-hidden"
              : isPosPage
                ? `p-2 sm:p-3 lg:p-4 ${sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"}`
                : `px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8 ${
                    sidebarCollapsed ? "lg:ml-16" : "lg:ml-64"
                  }`
          }`}
        >
          <div className={isDedicatedPosView ? "w-full h-full" : isPosPage ? "w-full max-w-full" : "mx-auto max-w-6xl"}>
            <Outlet />
          </div>
        </main>

        {/* Bottom tabs: phones and portrait tablets (hidden in dedicated POS fullscreen). */}
        {!isDedicatedPosView && (
          <nav
            className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur print:hidden lg:hidden"
            aria-label="Main"
          >
            <div className="mx-auto flex max-w-xl items-end justify-around px-2 pt-1.5">
              {tabs.map((item) => {
                const center = item.to === "/quick-sale";
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      center
                        ? "relative -mt-6 flex flex-col items-center gap-1 text-[11px] font-semibold text-ink"
                        : `relative flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold ${
                            isActive ? "text-brand-700" : "text-slate-500"
                          }`
                    }
                  >
                    {center ? (
                      <>
                        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lift ring-4 ring-white">
                          <Icon name="cash" className="h-7 w-7" />
                        </span>
                        Sale / POS
                      </>
                    ) : (
                      <>
                        <Icon name={item.icon} className="h-6 w-6" />
                        {item.label === "Dashboard" ? "Home" : item.label}
                        {item.badge === "lowStock" && lowStock > 0 && (
                          <span className="absolute right-3 top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
              <button
                type="button"
                onClick={() => setMoreOpen(true)}
                className="flex flex-1 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-500"
              >
                <Icon name="menu" className="h-6 w-6" />
                More
              </button>
            </div>
          </nav>
        )}

        {/* "More" sheet slides up from the bottom. */}
        {moreOpen && !isDedicatedPosView && (
          <div
            className="fixed inset-0 z-50 flex items-end bg-ink/40 print:hidden lg:hidden"
            onClick={(e) => e.target === e.currentTarget && setMoreOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="More"
          >
            <div className="pb-safe w-full rounded-t-3xl bg-white px-4 pt-3">
              <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />
              <div className="grid grid-cols-3 gap-2 pb-3 sm:grid-cols-4">
                {moreItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className="flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-2 py-4 text-center text-xs font-semibold text-ink active:bg-slate-100"
                  >
                    <Icon name={item.icon} className="h-6 w-6 text-brand-600" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 py-3 text-sm">
                <span className="text-slate-500">
                  {user?.firstName} {user?.lastName} · {titleCase(user?.role ?? "")}
                </span>
                <button type="button" onClick={signOut} className="font-semibold text-red-600">
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </LayoutContext.Provider>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 print:hidden">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}
