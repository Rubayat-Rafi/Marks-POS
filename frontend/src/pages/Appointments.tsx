import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { customerLabel, dateOnly, timeOnly, titleCase, vehicleLabel } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import {
  Button,
  Card,
  DataState,
  ErrorBanner,
  Field,
  Input,
  Modal,
  Select,
  StatusBadge,
  Table,
} from "../components/ui";
import { Icon } from "../components/Icon";
import { classifyTextDepartment, type ShopDepartment } from "../lib/shopDepartment";
import type { BookingRequest, Customer, RepairOrder, Vehicle } from "../lib/types";

type Appointment = {
  id: string;
  scheduledFor: string;
  estimatedHours: string;
  concern: string;
  requestedWork: string | null;
  mileageIn: number | null;
  status: string;
  customer: Customer;
  vehicle: Vehicle;
  repairOrder: { id: string; number: string; status: string } | null;
};

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Step 1 of the workflow: book and check in (build guide / 04).
 *
 * Check-in creates the repair order and carries the customer, vehicle, mileage
 * and concern across. Nothing is re-entered.
 */
export function AppointmentsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") === "requests" ? "requests" : "schedule";

  const [from, setFrom] = useState(isoDay(0));
  const [to, setTo] = useState(isoDay(7));
  const [booking, setBooking] = useState(false);
  const [shopFilter, setShopFilter] = useState<"ALL" | "TIRE" | "MUFFLER">("ALL");

  const appointments = useQuery({
    queryKey: ["appointments", from, to],
    queryFn: () =>
      api.get<{ data: Appointment[] }>(
        `/appointments?from=${new Date(from).toISOString()}&to=${new Date(`${to}T23:59:59`).toISOString()}`,
      ),
  });

  const bookingRequests = useQuery({
    queryKey: ["booking-requests"],
    queryFn: () => api.get<{ data: BookingRequest[] }>("/booking-requests"),
    enabled: can("bookings.read"),
    refetchInterval: 15_000,
  });

  const pendingRequests =
    bookingRequests.data?.data.filter((r) => r.status === "NEW" || r.status === "CONTACTED") ?? [];

  const checkIn = useMutation({
    mutationFn: (vars: { id: string; mileageIn?: number }) =>
      api.post<RepairOrder>(`/appointments/${vars.id}/check-in`, {
        mileageIn: vars.mileageIn,
      }),
    onSuccess: (ro) => {
      void queryClient.invalidateQueries({ queryKey: ["appointments"] });
      void queryClient.invalidateQueries({ queryKey: ["board"] });
      navigate(`/jobs/${ro.id}`);
    },
  });

  const updateRequest = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BookingRequest["status"] }) =>
      api.patch(`/booking-requests/${id}`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const convertRequest = useMutation({
    mutationFn: (id: string) =>
      api.post<{ appointment: Appointment; message: string }>(`/booking-requests/${id}/convert`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["booking-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["appointments"] });
      setSearchParams({ tab: "schedule" });
    },
  });

  // Group by calendar day so the advisor reads a schedule, not a flat list.
  const byDay = new Map<string, Appointment[]>();
  for (const appt of appointments.data?.data ?? []) {
    const dept = classifyTextDepartment(`${appt.concern} ${appt.requestedWork || ""}`);
    if (shopFilter !== "ALL" && dept !== shopFilter) continue;
    const key = appt.scheduledFor.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), appt]);
  }

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Booked work. Checking in creates the repair order and records the mileage."
        action={
          can("appointments.write") ? (
            <Button onClick={() => setBooking(true)}>Book appointment</Button>
          ) : undefined
        }
      />

      {/* Shop Division Switcher & View Tabs */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchParams({ tab: "schedule" })}
            className={`border-b-2 py-2.5 px-4 text-sm font-bold transition ${
              currentTab === "schedule"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-ink"
            }`}
          >
            Calendar Schedule
          </button>
          {can("bookings.read") && (
            <button
              type="button"
              onClick={() => setSearchParams({ tab: "requests" })}
              className={`inline-flex items-center gap-2 border-b-2 py-2.5 px-4 text-sm font-bold transition ${
                currentTab === "requests"
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-slate-500 hover:text-ink"
              }`}
            >
              <span>Website Requests</span>
              {pendingRequests.length > 0 && (
                <span className="rounded-full bg-brand-600 px-2 py-0.2 text-[11px] font-bold text-white shadow-xs">
                  {pendingRequests.length}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Shop Switcher Pill */}
        <div className="flex items-center rounded-xl bg-slate-100 p-1 border border-slate-200 shadow-2xs">
          <span className="px-2 text-xs font-bold text-slate-500">Shop:</span>
          <button
            type="button"
            onClick={() => setShopFilter("ALL")}
            className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
              shopFilter === "ALL"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            All Shops
          </button>
          <button
            type="button"
            onClick={() => setShopFilter("TIRE")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition ${
              shopFilter === "TIRE"
                ? "bg-amber-600 text-white shadow-xs"
                : "text-amber-800 hover:bg-amber-50"
            }`}
          >
            <span>🛞</span>
            <span>Tires Shop</span>
          </button>
          <button
            type="button"
            onClick={() => setShopFilter("MUFFLER")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-bold transition ${
              shopFilter === "MUFFLER"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-blue-800 hover:bg-blue-50"
            }`}
          >
            <span>🔧</span>
            <span>Mufflers Shop</span>
          </button>
        </div>
      </div>

      {currentTab === "requests" ? (
        <Card
          title="Website Booking Requests"
          action={
            <span className="text-xs text-slate-500">
              Auto-refreshes · {pendingRequests.length} pending
            </span>
          }
        >
          <DataState
            loading={bookingRequests.isLoading}
            error={bookingRequests.error}
            empty={(bookingRequests.data?.data.length ?? 0) === 0}
            emptyMessage="No website booking requests yet. Requests from the public homepage will appear here."
          >
            <div className="space-y-4">
              {bookingRequests.data?.data
                .filter((req) => {
                  if (shopFilter === "ALL") return true;
                  const dept = classifyTextDepartment(`${req.service} ${req.notes || ""}`);
                  return dept === shopFilter;
                })
                .map((req) => {
                  const reqDept = classifyTextDepartment(`${req.service} ${req.notes || ""}`);
                  return (
                <div
                  key={req.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs transition hover:border-brand-300 hover:shadow-sm sm:flex-row sm:items-center gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-base font-bold text-ink">{req.name}</h3>
                      <span className={`text-[9px] font-extrabold px-1.5 py-0.2 rounded border ${
                        reqDept === "TIRE"
                          ? "bg-amber-100 text-amber-900 border-amber-300"
                          : reqDept === "MUFFLER"
                          ? "bg-blue-100 text-blue-900 border-blue-300"
                          : "bg-slate-100 text-slate-700 border-slate-300"
                      }`}>
                        {reqDept === "TIRE" ? "🛞 Tires" : reqDept === "MUFFLER" ? "🔧 Mufflers" : "General"}
                      </span>
                      <StatusBadge status={req.status} />
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      {req.vehicle && (
                        <span className="font-semibold text-ink flex items-center gap-1">
                          <Icon name="car" className="h-3.5 w-3.5 text-slate-400" />
                          {req.vehicle}
                        </span>
                      )}
                      <span className="font-medium text-brand-700 bg-brand-50 px-2 py-0.5 rounded border border-brand-200/50">
                        {req.service}
                      </span>
                      {req.preferredDate && (
                        <span className="flex items-center gap-1">
                          <Icon name="calendar" className="h-3.5 w-3.5 text-slate-400" />
                          Prefers: {dateOnly(req.preferredDate)} ({req.preferredTime || "Any time"})
                        </span>
                      )}
                    </div>

                    {req.notes && (
                      <p className="mt-1 text-xs italic text-slate-600 bg-slate-50 p-2 rounded border-l-2 border-brand-400">
                        &ldquo;{req.notes}&rdquo;
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <a
                      href={`tel:${req.phone.replace(/[^\d+]/g, "")}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-brand-700 transition"
                      title="Call customer"
                    >
                      <Icon name="phone" className="h-3.5 w-3.5" />
                      <span>{req.phone}</span>
                    </a>

                    {can("appointments.write") && req.status !== "BOOKED" && (
                      <button
                        type="button"
                        onClick={() => convertRequest.mutate(req.id)}
                        disabled={convertRequest.isPending}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50 transition"
                      >
                        <Icon name="check" className="h-3.5 w-3.5" />
                        <span>
                          {convertRequest.isPending ? "Adding to calendar..." : "Confirm & Add to Calendar"}
                        </span>
                      </button>
                    )}

                    {req.status === "NEW" && (
                      <button
                        type="button"
                        onClick={() => updateRequest.mutate({ id: req.id, status: "CONTACTED" })}
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Mark Contacted
                      </button>
                    )}

                    {req.status !== "CLOSED" && (
                      <button
                        type="button"
                        onClick={() => updateRequest.mutate({ id: req.id, status: "CLOSED" })}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-red-600"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            </div>
          </DataState>
        </Card>
      ) : (
        <>
          {/* Notice banner if website requests are waiting */}
          {pendingRequests.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                  {pendingRequests.length}
                </span>
                <span>
                  You have <strong>{pendingRequests.length} online booking request{pendingRequests.length === 1 ? "" : "s"}</strong> waiting for confirmation.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSearchParams({ tab: "requests" })}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-brand-700 transition"
              >
                View requests & add to calendar →
              </button>
            </div>
          )}

          <Card>
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <Field label="From">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To">
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Button
                variant="secondary"
                onClick={() => {
                  setFrom(isoDay(0));
                  setTo(isoDay(0));
                }}
              >
                Today only
              </Button>
            </div>

            <ErrorBanner error={checkIn.error} />

            <DataState
              loading={appointments.isLoading}
              error={appointments.error}
              empty={(appointments.data?.data.length ?? 0) === 0}
              emptyMessage="Nothing booked in this range."
            >
              <div className="space-y-5">
                {[...byDay.entries()].map(([day, items]) => (
                  <div key={day}>
                    <h2 className="mb-2 text-sm font-semibold text-ink">{dateOnly(day)}</h2>
                    <Table
                      headers={["Time", "Customer", "Vehicle", "Concern", "Est.", "Status", ""]}
                    >
                      {items.map((appt) => (
                        <tr key={appt.id}>
                          <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
                            {timeOnly(appt.scheduledFor)}
                          </td>
                          <td className="px-3 py-2">
                            <Link
                              to={`/customers/${appt.customer.id}`}
                              className="hover:text-teal-700"
                            >
                              {customerLabel(appt.customer)}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{vehicleLabel(appt.vehicle)}</td>
                          <td className="max-w-xs truncate px-3 py-2">
                            {(() => {
                              const dept = classifyTextDepartment(`${appt.concern} ${appt.requestedWork || ""}`);
                              return (
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.2 text-[9px] font-extrabold uppercase shrink-0 border ${
                                    dept === "TIRE"
                                      ? "bg-amber-100 text-amber-900 border-amber-300"
                                      : dept === "MUFFLER"
                                      ? "bg-blue-100 text-blue-900 border-blue-300"
                                      : "bg-slate-100 text-slate-700 border-slate-300"
                                  }`}>
                                    {dept === "TIRE" ? "🛞 Tires" : dept === "MUFFLER" ? "🔧 Mufflers" : "General"}
                                  </span>
                                  <span className="truncate">{appt.concern}</span>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="px-3 py-2 tabular-nums">{appt.estimatedHours}h</td>
                          <td className="px-3 py-2">
                            <StatusBadge status={appt.status} />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right">
                            {appt.repairOrder ? (
                              <Link
                                to={`/jobs/${appt.repairOrder.id}`}
                                className="font-semibold text-teal-700 hover:underline"
                              >
                                RO #{appt.repairOrder.number} ({titleCase(appt.repairOrder.status)})
                              </Link>
                            ) : can("jobs.write") &&
                              appt.status !== "CHECKED_IN" &&
                              appt.status !== "CANCELLED" ? (
                              <button
                                type="button"
                                onClick={() => checkIn.mutate({ id: appt.id })}
                                disabled={checkIn.isPending}
                                className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                              >
                                Check in
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </div>
                ))}
              </div>
            </DataState>
          </Card>
        </>
      )}

      {booking && <BookModal onClose={() => setBooking(false)} />}
    </>
  );
}

function BookModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    scheduledFor: `${isoDay(1)}T09:00`,
    estimatedHours: "1",
    concern: "",
    requestedWork: "",
    mileageIn: "",
  });

  const customers = useQuery({
    queryKey: ["customers", search],
    queryFn: () => api.get<{ data: Customer[] }>(`/customers?q=${encodeURIComponent(search)}`),
  });

  // Vehicles are scoped to the chosen customer, so a job cannot be booked
  // against someone else's car.
  const vehicles = useQuery({
    queryKey: ["vehicles", customerId],
    queryFn: () => api.get<{ data: Vehicle[] }>(`/vehicles?customerId=${customerId}`),
    enabled: Boolean(customerId),
  });

  const book = useMutation({
    mutationFn: () =>
      api.post("/appointments", {
        customerId,
        vehicleId,
        scheduledFor: new Date(form.scheduledFor).toISOString(),
        estimatedHours: Number(form.estimatedHours || 1),
        concern: form.concern,
        requestedWork: form.requestedWork || null,
        mileageIn: form.mileageIn ? Number(form.mileageIn) : null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["appointments"] });
      onClose();
    },
  });

  return (
    <Modal title="Book appointment" onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          book.mutate();
        }}
      >
        <ErrorBanner error={book.error} />

        <Field label="Find customer">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, phone or email"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer" required>
            <Select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setVehicleId("");
              }}
              required
            >
              <option value="">Select a customer…</option>
              {customers.data?.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {customerLabel(c)}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Vehicle"
            required
            hint={
              customerId && vehicles.data?.data.length === 0
                ? "This customer has no vehicle on file yet."
                : undefined
            }
          >
            <Select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              disabled={!customerId}
              required
            >
              <option value="">Select a vehicle…</option>
              {vehicles.data?.data.map((v) => (
                <option key={v.id} value={v.id}>
                  {vehicleLabel(v)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="Date and time" required>
              <Input
                type="datetime-local"
                value={form.scheduledFor}
                onChange={(e) => setForm((f) => ({ ...f, scheduledFor: e.target.value }))}
                required
              />
            </Field>
          </div>
          <Field label="Estimated hours">
            <Input
              value={form.estimatedHours}
              onChange={(e) => setForm((f) => ({ ...f, estimatedHours: e.target.value }))}
              inputMode="decimal"
            />
          </Field>
        </div>

        <Field label="Customer concern" required hint="In the customer's own words.">
          <Input
            value={form.concern}
            onChange={(e) => setForm((f) => ({ ...f, concern: e.target.value }))}
            required
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Requested work">
            <Input
              value={form.requestedWork}
              onChange={(e) => setForm((f) => ({ ...f, requestedWork: e.target.value }))}
              placeholder="What they asked for, if different"
            />
          </Field>
          <Field label="Mileage">
            <Input
              value={form.mileageIn}
              onChange={(e) => setForm((f) => ({ ...f, mileageIn: e.target.value }))}
              inputMode="numeric"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={book.isPending} disabled={!customerId || !vehicleId}>
            Book appointment
          </Button>
        </div>
      </form>
    </Modal>
  );
}
