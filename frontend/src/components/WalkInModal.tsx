import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { customerLabel, vehicleLabel } from "../lib/format";
import { Button, ErrorBanner, Field, Input, Modal } from "./ui";
import type { Customer, RepairOrder, Vehicle } from "../lib/types";

type Step = "customer" | "vehicle" | "concern";

/**
 * Quick walk-in check-in, reachable straight from the dashboard.
 *
 * This is the same underlying action as "Start job" from a customer's page
 * (POST /repair-orders): a customer, a vehicle, a concern. What is new here is
 * not finding a customer first — search for one, or create one on the spot,
 * without leaving the dashboard (build guide / 04 step 1, "book and check
 * in").
 */
export function WalkInModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("customer");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerSummary, setCustomerSummary] = useState<Customer | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [vehicleSummary, setVehicleSummary] = useState<Vehicle | null>(null);

  const [customerSearch, setCustomerSearch] = useState("");
  const [newCustomer, setNewCustomer] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
  });

  const [newVehicle, setNewVehicle] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({
    plate: "",
    year: "",
    make: "",
    model: "",
  });

  const [department, setDepartment] = useState<"TIRE" | "MUFFLER">("TIRE");
  const [concern, setConcern] = useState("");
  const [mileageIn, setMileageIn] = useState("");

  const customers = useQuery({
    queryKey: ["customers", "walkin", customerSearch],
    queryFn: () => api.get<{ data: Customer[] }>(`/customers?q=${encodeURIComponent(customerSearch)}`),
    enabled: step === "customer" && !newCustomer,
  });

  const vehicles = useQuery({
    queryKey: ["vehicles", "walkin", customerId],
    queryFn: () => api.get<{ data: Vehicle[] }>(`/vehicles?customerId=${customerId}`),
    enabled: step === "vehicle" && !newVehicle && Boolean(customerId),
  });

  const createCustomer = useMutation({
    mutationFn: () =>
      api.post<Customer>("/customers", {
        firstName: customerForm.firstName,
        lastName: customerForm.lastName,
        phone: customerForm.phone || undefined,
        email: customerForm.email || undefined,
      }),
    onSuccess: (customer) => {
      setCustomerId(customer.id);
      setCustomerSummary(customer);
      setStep("vehicle");
    },
  });

  const createVehicle = useMutation({
    mutationFn: () =>
      api.post<Vehicle>("/vehicles", {
        customerId,
        plate: vehicleForm.plate || null,
        year: vehicleForm.year ? Number(vehicleForm.year) : null,
        make: vehicleForm.make || null,
        model: vehicleForm.model || null,
      }),
    onSuccess: (vehicle) => {
      setVehicleId(vehicle.id);
      setVehicleSummary(vehicle);
      setStep("concern");
    },
  });

  const checkIn = useMutation({
    mutationFn: () => {
      const taggedConcern = concern.startsWith("[")
        ? concern
        : `[${department === "TIRE" ? "Tires Shop" : "Mufflers Shop"}] ${concern.trim()}`;
      return api.post<RepairOrder>("/repair-orders", {
        customerId,
        vehicleId,
        concern: taggedConcern,
        mileageIn: mileageIn ? Number(mileageIn) : undefined,
      });
    },
    onSuccess: (ro) => {
      void queryClient.invalidateQueries({ queryKey: ["board"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      navigate(`/jobs/${ro.id}`);
    },
  });

  function pickCustomer(customer: Customer) {
    setCustomerId(customer.id);
    setCustomerSummary(customer);
    setStep("vehicle");
  }

  function pickVehicle(vehicle: Vehicle) {
    setVehicleId(vehicle.id);
    setVehicleSummary(vehicle);
    setStep("concern");
  }

  return (
    <Modal title="Walk-in check-in" onClose={onClose} wide>
      <div className="mb-4 flex items-center gap-2 text-xs text-slate-500">
        <StepDot active={step === "customer"} done={Boolean(customerId)} label="Customer" />
        <span>›</span>
        <StepDot active={step === "vehicle"} done={Boolean(vehicleId)} label="Vehicle" />
        <span>›</span>
        <StepDot active={step === "concern"} done={false} label="Concern" />
      </div>

      {/* -- step 1: customer -------------------------------------------- */}
      {step === "customer" && (
        <div className="space-y-3">
          {!newCustomer ? (
            <>
              <Field label="Find customer" hint="Search by name, phone or email, or add a new one.">
                <Input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Start typing…"
                  autoFocus
                />
              </Field>

              <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-slate-200">
                {customers.data?.data.length === 0 && (
                  <p className="p-3 text-sm text-slate-500">
                    No match{customerSearch ? ` for "${customerSearch}"` : ""}.
                  </p>
                )}
                {customers.data?.data.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickCustomer(c)}
                    className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                  >
                    <span className="font-medium text-ink">{customerLabel(c)}</span>
                    <span className="text-xs text-slate-500">{c.phone ?? c.email ?? ""}</span>
                  </button>
                ))}
              </div>

              <Button type="button" variant="secondary" onClick={() => setNewCustomer(true)}>
                This is a new customer
              </Button>
            </>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                createCustomer.mutate();
              }}
            >
              <ErrorBanner error={createCustomer.error} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="First name" required>
                  <Input
                    value={customerForm.firstName}
                    onChange={(e) =>
                      setCustomerForm((f) => ({ ...f, firstName: e.target.value }))
                    }
                    required
                    autoFocus
                  />
                </Field>
                <Field label="Last name" required>
                  <Input
                    value={customerForm.lastName}
                    onChange={(e) => setCustomerForm((f) => ({ ...f, lastName: e.target.value }))}
                    required
                  />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone">
                  <Input
                    value={customerForm.phone}
                    onChange={(e) => setCustomerForm((f) => ({ ...f, phone: e.target.value }))}
                    inputMode="tel"
                  />
                </Field>
                <Field label="Email">
                  <Input
                    type="email"
                    value={customerForm.email}
                    onChange={(e) => setCustomerForm((f) => ({ ...f, email: e.target.value }))}
                  />
                </Field>
              </div>
              <div className="flex justify-between pt-1">
                <Button type="button" variant="ghost" onClick={() => setNewCustomer(false)}>
                  ← Search instead
                </Button>
                <Button type="submit" loading={createCustomer.isPending}>
                  Save and continue
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* -- step 2: vehicle ------------------------------------------- */}
      {step === "vehicle" && customerId && (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Customer: <span className="font-medium text-ink">{customerLabel(customerSummary!)}</span>{" "}
            <button
              type="button"
              className="ml-1 text-xs text-teal-700 underline"
              onClick={() => setStep("customer")}
            >
              change
            </button>
          </p>

          {!newVehicle ? (
            <>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded border border-slate-200">
                {vehicles.data?.data.length === 0 && (
                  <p className="p-3 text-sm text-slate-500">No vehicle on file for this customer.</p>
                )}
                {vehicles.data?.data.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => pickVehicle(v)}
                    className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50"
                  >
                    <span className="font-medium text-ink">{vehicleLabel(v)}</span>
                    <span className="font-mono text-xs text-slate-400">{v.vin ?? ""}</span>
                  </button>
                ))}
              </div>
              <Button type="button" variant="secondary" onClick={() => setNewVehicle(true)}>
                This is a new vehicle
              </Button>
            </>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                createVehicle.mutate();
              }}
            >
              <ErrorBanner error={createVehicle.error} />
              <p className="text-xs text-slate-500">
                Enter the basics now; VIN decode and full details can be added later from the
                vehicle page.
              </p>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Year">
                  <Input
                    value={vehicleForm.year}
                    onChange={(e) => setVehicleForm((f) => ({ ...f, year: e.target.value }))}
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Make">
                  <Input
                    value={vehicleForm.make}
                    onChange={(e) => setVehicleForm((f) => ({ ...f, make: e.target.value }))}
                    autoFocus
                  />
                </Field>
                <Field label="Model">
                  <Input
                    value={vehicleForm.model}
                    onChange={(e) => setVehicleForm((f) => ({ ...f, model: e.target.value }))}
                  />
                </Field>
                <Field label="Plate">
                  <Input
                    value={vehicleForm.plate}
                    onChange={(e) => setVehicleForm((f) => ({ ...f, plate: e.target.value }))}
                    className="uppercase"
                  />
                </Field>
              </div>
              <div className="flex justify-between pt-1">
                <Button type="button" variant="ghost" onClick={() => setNewVehicle(false)}>
                  ← Pick an existing vehicle
                </Button>
                <Button type="submit" loading={createVehicle.isPending}>
                  Save and continue
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* -- step 3: concern --------------------------------------------- */}
      {step === "concern" && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            checkIn.mutate();
          }}
        >
          <p className="text-sm text-slate-500">
            {customerLabel(customerSummary!)} &middot; {vehicleLabel(vehicleSummary!)}{" "}
            <button
              type="button"
              className="ml-1 text-xs text-teal-700 underline"
              onClick={() => setStep("vehicle")}
            >
              change vehicle
            </button>
          </p>

          <ErrorBanner error={checkIn.error} />

          {/* Shop Division Selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Assigned Shop Division
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDepartment("TIRE")}
                className={`flex items-center justify-center gap-2 rounded-xl p-3 text-xs font-bold border transition ${
                  department === "TIRE"
                    ? "border-emerald-600 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-500/20 shadow-xs"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="text-base">🛞</span>
                <span>Tires Shop</span>
              </button>
              <button
                type="button"
                onClick={() => setDepartment("MUFFLER")}
                className={`flex items-center justify-center gap-2 rounded-xl p-3 text-xs font-bold border transition ${
                  department === "MUFFLER"
                    ? "border-blue-600 bg-blue-50 text-blue-950 ring-2 ring-blue-500/20 shadow-xs"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className="text-base">🔧</span>
                <span>Mufflers Shop</span>
              </button>
            </div>
          </div>

          {/* Quick presets */}
          <div className="space-y-1">
            <span className="text-[11px] font-medium text-slate-500">Quick concern presets:</span>
            <div className="flex flex-wrap gap-1.5">
              {(department === "TIRE"
                ? [
                    "Mount & Balance 4 Tires",
                    "Wheel Alignment Inspection",
                    "Brake Pad & Rotor Replacement",
                    "Flat Tire Repair / Bead Seal",
                  ]
                : [
                    "Muffler Replacement & Pipe Clamp",
                    "Exhaust Pipe Crack / Weld Repair",
                    "Catalytic Converter Replacement",
                    "Engine Belt / Coolant Diagnostics",
                  ]
              ).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setConcern(preset)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-900 transition"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          <Field label="Customer concern" required hint="What the customer reported, in their words.">
            <Input value={concern} onChange={(e) => setConcern(e.target.value)} required autoFocus placeholder="e.g. Mount & balance 4 new tires" />
          </Field>

          <Field label="Mileage in">
            <Input value={mileageIn} onChange={(e) => setMileageIn(e.target.value)} inputMode="numeric" placeholder="e.g. 84200" />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={checkIn.isPending}>
              Check in and open job
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-medium ${
        active
          ? "bg-teal-600 text-white"
          : done
            ? "bg-teal-100 text-teal-800"
            : "bg-slate-100 text-slate-500"
      }`}
    >
      {label}
    </span>
  );
}

/** Convenience wrapper: renders the trigger button plus the modal. */
export function WalkInButton({ label = "Walk-in" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      {open && <WalkInModal onClose={() => setOpen(false)} />}
    </>
  );
}
