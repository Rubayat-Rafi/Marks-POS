import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { customerLabel, dateOnly, money, vehicleLabel } from "../lib/format";
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
  Notice,
  StatTile,
  StatusBadge,
  Table,
} from "../components/ui";
import type { Customer, Invoice, RepairOrder, Vehicle } from "../lib/types";

type CustomerDetail = Customer & {
  vehicles: Array<{ vehicle: Vehicle }>;
  repairOrders: RepairOrder[];
  invoices: Invoice[];
  creditAvailable: number;
  outstanding: number;
};

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [startingJob, setStartingJob] = useState<Vehicle | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [confirmDeleteCustomer, setConfirmDeleteCustomer] = useState(false);

  const customer = useQuery({
    queryKey: ["customer", id],
    queryFn: () => api.get<CustomerDetail>(`/customers/${id}`),
    enabled: Boolean(id),
  });

  const refreshCustomer = () => {
    void queryClient.invalidateQueries({ queryKey: ["customer", id] });
    void queryClient.invalidateQueries({ queryKey: ["customers"] });
    void queryClient.invalidateQueries({ queryKey: ["board"] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
  };

  const deleteCustomer = useMutation({
    mutationFn: () => api.delete(`/customers/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["board"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      navigate("/customers");
    },
  });

  const deleteVehicle = useMutation({
    mutationFn: (vehicleId: string) => api.delete(`/vehicles/${vehicleId}`),
    onSuccess: refreshCustomer,
  });

  const deleteJob = useMutation({
    mutationFn: (roId: string) => api.delete(`/repair-orders/${roId}`),
    onSuccess: refreshCustomer,
  });

  const deleteInvoice = useMutation({
    mutationFn: (invId: string) => api.delete(`/invoices/${invId}`),
    onSuccess: refreshCustomer,
  });

  const c = customer.data;

  return (
    <>
      <PageHeader
        title={c ? customerLabel(c) : "Customer"}
        description={c ? [c.phone, c.email].filter(Boolean).join("  ·  ") : undefined}
        action={
          <div className="flex flex-wrap gap-2">
            {can("customers.write") && (
              <Button variant="secondary" onClick={() => setEditingProfile(true)}>
                Edit profile
              </Button>
            )}
            {can("vehicles.write") && (
              <Button onClick={() => setAddingVehicle(true)}>Add vehicle</Button>
            )}
            {can("customers.write") && c && (
              <Button variant="danger" onClick={() => setConfirmDeleteCustomer(true)}>
                Delete customer
              </Button>
            )}
          </div>
        }
      />

      {confirmDeleteCustomer && c && (
        <Modal
          title={`Delete ${customerLabel(c)}?`}
          onClose={() => !deleteCustomer.isPending && setConfirmDeleteCustomer(false)}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              This will permanently delete <strong>{customerLabel(c)}</strong> along with all their vehicles, repair orders, estimates, invoices, and payments. This cannot be undone.
            </p>
            <ErrorBanner error={deleteCustomer.error} />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmDeleteCustomer(false)}
                disabled={deleteCustomer.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleteCustomer.isPending}
                onClick={() => deleteCustomer.mutate()}
              >
                Yes, Delete Customer
              </Button>
            </div>
          </div>
        </Modal>
      )}

      <DataState loading={customer.isLoading} error={customer.error}>
        {c && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                label="Outstanding balance"
                value={money(c.outstanding)}
                tone={c.outstanding > 0 ? "warn" : "neutral"}
                sub="Issued invoices less payments and credits"
              />
              <StatTile
                label="Credit held"
                value={money(c.creditAvailable)}
                sub="Deposits not yet applied to an invoice"
              />
              <StatTile
                label="Vehicles"
                value={String(c.vehicles.length)}
                sub={c.taxExempt ? "Tax exempt account" : "Standard tax treatment"}
              />
            </div>

            <Card
              title="Profile"
              action={
                can("customers.write") ? (
                  <button
                    type="button"
                    onClick={() => setEditingProfile(true)}
                    className="text-xs font-medium text-teal-700 hover:underline"
                  >
                    Edit
                  </button>
                ) : undefined
              }
            >
              <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <ProfileRow label="Company" value={c.companyName ?? "—"} />
                <ProfileRow label="Phone" value={c.phone ?? "—"} />
                <ProfileRow label="Email" value={c.email ?? "—"} />
                <ProfileRow
                  label="Address"
                  value={
                    [c.addressLine1, c.city, c.state, c.postalCode].filter(Boolean).join(", ") ||
                    "—"
                  }
                />
                <ProfileRow label="Tax status" value={c.taxExempt ? "Tax exempt" : "Standard"} />
                <ProfileRow
                  label="Contact preferences"
                  value={[
                    c.allowsSms ? "SMS ok" : "No SMS",
                    c.allowsMarketing ? "Marketing ok" : "No marketing",
                  ].join(" · ")}
                />
              </div>
              {c.notes && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Notes
                  </p>
                  <p className="text-sm text-slate-600">{c.notes}</p>
                </div>
              )}
            </Card>

            <Card title="Vehicles">
              <DataState
                empty={c.vehicles.length === 0}
                emptyMessage="No vehicles on file for this customer."
              >
                <Table headers={["Vehicle", "VIN", "Mileage", "Source", ""]}>
                  {c.vehicles.map(({ vehicle }) => (
                    <tr key={vehicle.id}>
                      <td className="px-3 py-2 font-medium">
                        <Link
                          to={`/vehicles/${vehicle.id}`}
                          className="text-ink hover:text-teal-700"
                        >
                          {vehicleLabel(vehicle)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">
                        {vehicle.vin ?? "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">
                        {vehicle.mileageReadings?.[0]
                          ? `${vehicle.mileageReadings[0].miles.toLocaleString()} mi`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {/* Provenance is shown, not hidden (build guide / 06). */}
                        {vehicle.vinSource
                          ? `${vehicle.vinSource} · ${dateOnly(vehicle.vinDecodedAt)}`
                          : "Entered manually"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {can("jobs.write") && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setStartingJob(vehicle)}
                            >
                              Start job
                            </Button>
                          )}
                          {can("vehicles.write") && (
                            <Button
                              variant="danger"
                              size="sm"
                              loading={deleteVehicle.isPending}
                              onClick={() => {
                                if (confirm(`Delete vehicle ${vehicleLabel(vehicle)} and its history?`)) {
                                  deleteVehicle.mutate(vehicle.id);
                                }
                              }}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </DataState>
            </Card>

            <Card title="Service history">
              <ErrorBanner error={deleteJob.error} />
              <DataState
                empty={c.repairOrders.length === 0}
                emptyMessage="This customer has no jobs yet."
              >
                <Table headers={["Job", "Vehicle", "Concern", "Status", ""]}>
                  {c.repairOrders.map((ro) => (
                    <tr key={ro.id}>
                      <td className="px-3 py-2 font-mono text-xs">{ro.number}</td>
                      <td className="px-3 py-2 text-slate-600">{vehicleLabel(ro.vehicle)}</td>
                      <td className="max-w-sm truncate px-3 py-2 text-slate-600">{ro.concern}</td>
                      <td className="px-3 py-2">
                        <StatusBadge status={ro.status} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link to={`/jobs/${ro.id}`} className="text-sm text-teal-700 hover:underline">
                            Open
                          </Link>
                          {can("jobs.write") && (
                            <Button
                              variant="danger"
                              size="sm"
                              loading={deleteJob.isPending}
                              onClick={() => {
                                if (confirm(`Delete job ${ro.number}?`)) {
                                  deleteJob.mutate(ro.id);
                                }
                              }}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </Table>
              </DataState>
            </Card>

            {can("invoices.read") && (
              <Card title="Invoices">
                <ErrorBanner error={deleteInvoice.error} />
                <DataState empty={c.invoices.length === 0} emptyMessage="No invoices yet.">
                  <Table headers={["Invoice", "Issued", "Total", "Balance", "Status", ""]}>
                    {c.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-3 py-2 font-mono text-xs">{inv.number}</td>
                        <td className="px-3 py-2 text-slate-600">{dateOnly(inv.issuedAt)}</td>
                        <td className="px-3 py-2 tabular-nums">{money(inv.total)}</td>
                        <td className="px-3 py-2 tabular-nums font-medium">
                          {money(inv.total - inv.amountPaid - inv.amountCredited)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={inv.status} />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              to={`/receipts/${inv.id}`}
                              className="text-sm text-slate-600 hover:underline"
                            >
                              Receipt
                            </Link>
                            {can("payments.collect") &&
                              (inv.status === "ISSUED" || inv.status === "PARTLY_PAID") && (
                                <Link
                                  to={`/quick-sale/${inv.id}`}
                                  className="text-sm text-teal-700 hover:underline"
                                >
                                  Collect
                                </Link>
                              )}
                            {can("invoices.write") && (
                              <Button
                                variant="danger"
                                size="sm"
                                loading={deleteInvoice.isPending}
                                onClick={() => {
                                  if (confirm(`Delete invoice ${inv.number}?`)) {
                                    deleteInvoice.mutate(inv.id);
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </Table>
                </DataState>
              </Card>
            )}
          </div>
        )}
      </DataState>

      {addingVehicle && id && (
        <AddVehicleModal customerId={id} onClose={() => setAddingVehicle(false)} />
      )}
      {startingJob && id && (
        <StartJobModal
          customerId={id}
          vehicle={startingJob}
          onClose={() => setStartingJob(null)}
        />
      )}
      {editingProfile && c && (
        <EditProfileModal customer={c} onClose={() => setEditingProfile(false)} />
      )}
    </>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

/**
 * Edit an existing customer's profile.
 *
 * The transactional/marketing distinction from account creation carries over
 * here: unchecking "marketing" never stops a receipt or an approval link from
 * being sent (build guide / 03).
 */
function EditProfileModal({ customer, onClose }: { customer: CustomerDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    firstName: customer.firstName,
    lastName: customer.lastName,
    companyName: customer.companyName ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    addressLine1: customer.addressLine1 ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    postalCode: customer.postalCode ?? "",
    notes: customer.notes ?? "",
    taxExempt: customer.taxExempt,
    allowsMarketing: customer.allowsMarketing,
    allowsSms: customer.allowsSms,
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch<Customer>(`/customers/${customer.id}`, {
        ...form,
        companyName: form.companyName || null,
        email: form.email || undefined,
        notes: form.notes || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", customer.id] });
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    },
  });

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({
        ...f,
        [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
      }));

  return (
    <Modal title="Edit profile" onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <ErrorBanner error={save.error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" required>
            <Input value={form.firstName} onChange={set("firstName")} required autoFocus />
          </Field>
          <Field label="Last name" required>
            <Input value={form.lastName} onChange={set("lastName")} required />
          </Field>
        </div>

        <Field label="Company">
          <Input value={form.companyName} onChange={set("companyName")} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Phone">
            <Input value={form.phone} onChange={set("phone")} inputMode="tel" />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={set("email")} />
          </Field>
        </div>

        <Field label="Address">
          <Input value={form.addressLine1} onChange={set("addressLine1")} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="City">
            <Input value={form.city} onChange={set("city")} />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={set("state")} maxLength={2} />
          </Field>
          <Field label="ZIP">
            <Input value={form.postalCode} onChange={set("postalCode")} inputMode="numeric" />
          </Field>
        </div>

        <Field label="Notes" hint="Shop-internal. Never shown to the customer.">
          <Input value={form.notes} onChange={set("notes")} />
        </Field>

        <Notice>
          <div className="space-y-2">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={form.taxExempt}
                onChange={set("taxExempt")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Tax exempt</span>
                <br />
                No sales tax is calculated on this customer's invoices.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={form.allowsSms}
                onChange={set("allowsSms")}
                className="mt-0.5"
              />
              <span className="font-medium">Allows SMS</span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={form.allowsMarketing}
                onChange={set("allowsMarketing")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Marketing consent</span>
                <br />
                Receipts and approval links are transactional and are sent regardless. This box
                only covers marketing.
              </span>
            </label>
          </div>
        </Notice>

        <div className="flex justify-between gap-2 pt-2">
          {customer.outstanding === 0 ? (
            <Button
              type="button"
              variant="danger"
              className="mr-auto"
              onClick={() => {
                if (confirm("Are you sure you want to archive this customer? This will hide them from the active list.")) {
                  api.post(`/customers/${customer.id}/archive`).then(() => {
                    queryClient.invalidateQueries({ queryKey: ["customers"] });
                    onClose();
                    window.location.href = "/customers";
                  }).catch(err => alert("Failed to archive: " + err.message));
                }
              }}
            >
              Archive
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save profile
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Add a vehicle, optionally decoding the VIN first.
 *
 * The decode is a suggestion the advisor confirms. Every field stays editable
 * and a provider outage does not block the form (build guide / 10).
 */
function AddVehicleModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    vin: "",
    plate: "",
    year: "",
    make: "",
    model: "",
    trim: "",
    engine: "",
    color: "",
  });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [decodeSource, setDecodeSource] = useState<string | null>(null);

  // Suggestions only, never a hard requirement: manual entry always keeps
  // working even if NHTSA is unreachable (build guide / 10).
  const makes = useQuery({
    queryKey: ["ref-makes"],
    queryFn: () => api.get<{ data: string[] }>("/vehicles/reference/makes"),
    staleTime: 60 * 60 * 1000,
  });
  const models = useQuery({
    queryKey: ["ref-models", form.make],
    queryFn: () =>
      api.get<{ data: string[] }>(
        `/vehicles/reference/models?make=${encodeURIComponent(form.make)}${form.year ? `&year=${form.year}` : ""}`,
      ),
    enabled: form.make.length > 1,
    staleTime: 60 * 60 * 1000,
  });

  const decode = useMutation({
    mutationFn: (vin: string) =>
      api.post<{
        source: string | null;
        decoded: Record<string, string | number | null> | null;
        warnings: string[];
        disclaimer?: string;
      }>("/vehicles/decode-vin", { vin }),
    onSuccess: (result) => {
      setWarnings(result.warnings ?? []);
      setDecodeSource(result.source);
      if (result.decoded) {
        setForm((f) => ({
          ...f,
          year: result.decoded!.year ? String(result.decoded!.year) : f.year,
          make: (result.decoded!.make as string) ?? f.make,
          model: (result.decoded!.model as string) ?? f.model,
          trim: (result.decoded!.trim as string) ?? f.trim,
          engine: (result.decoded!.engine as string) ?? f.engine,
        }));
      }
    },
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<Vehicle>("/vehicles", {
        customerId,
        vin: form.vin || undefined,
        plate: form.plate || null,
        year: form.year ? Number(form.year) : null,
        make: form.make || null,
        model: form.model || null,
        trim: form.trim || null,
        engine: form.engine || null,
        color: form.color || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      onClose();
    },
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <Modal title="Add vehicle" onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <ErrorBanner error={create.error} />

        <div className="flex items-end gap-2">
          <Field
            label="VIN"
            hint="17 characters. Decoding identifies the vehicle; it is not history or fitment."
          >
            <Input
              value={form.vin}
              onChange={set("vin")}
              maxLength={17}
              className="font-mono uppercase"
            />
          </Field>
          <Button
            type="button"
            variant="secondary"
            loading={decode.isPending}
            disabled={form.vin.length !== 17}
            onClick={() => decode.mutate(form.vin)}
          >
            Decode
          </Button>
        </div>

        {decodeSource && (
          <Notice>
            Decoded from <span className="font-medium">{decodeSource}</span>. Check the values
            below and correct anything wrong before saving.
          </Notice>
        )}
        {warnings.length > 0 && (
          <Notice tone="warn">
            <ul className="list-inside list-disc space-y-0.5">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Notice>
        )}

        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Year">
            <Input value={form.year} onChange={set("year")} inputMode="numeric" />
          </Field>
          <Field label="Make" hint="Suggestions from NHTSA's free vehicle reference list.">
            <Input value={form.make} onChange={set("make")} list="vehicle-makes" />
            <datalist id="vehicle-makes">
              {makes.data?.data.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={set("model")} list="vehicle-models" />
            <datalist id="vehicle-models">
              {models.data?.data.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Trim">
            <Input value={form.trim} onChange={set("trim")} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Engine">
            <Input value={form.engine} onChange={set("engine")} />
          </Field>
          <Field label="Plate">
            <Input value={form.plate} onChange={set("plate")} className="uppercase" />
          </Field>
          <Field label="Color">
            <Input value={form.color} onChange={set("color")} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Save vehicle
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StartJobModal({
  customerId,
  vehicle,
  onClose,
}: {
  customerId: string;
  vehicle: Vehicle;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [concern, setConcern] = useState("");
  const [mileageIn, setMileageIn] = useState(
    vehicle.mileageReadings?.[0]?.miles ? String(vehicle.mileageReadings[0].miles) : "",
  );

  const create = useMutation({
    mutationFn: () =>
      api.post<RepairOrder>("/repair-orders", {
        customerId,
        vehicleId: vehicle.id,
        concern,
        mileageIn: mileageIn ? Number(mileageIn) : undefined,
      }),
    onSuccess: (ro) => navigate(`/jobs/${ro.id}`),
  });

  return (
    <Modal title={`Check in ${vehicleLabel(vehicle)}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <ErrorBanner error={create.error} />

        <Field label="Customer concern" required hint="What the customer reported, in their words.">
          <Input value={concern} onChange={(e) => setConcern(e.target.value)} required autoFocus />
        </Field>

        <Field label="Mileage in" hint="Recorded against the vehicle's history.">
          <Input
            value={mileageIn}
            onChange={(e) => setMileageIn(e.target.value)}
            inputMode="numeric"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Check in and open job
          </Button>
        </div>
      </form>
    </Modal>
  );
}
