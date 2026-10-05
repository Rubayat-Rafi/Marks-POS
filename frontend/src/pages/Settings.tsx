import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { dateTime, money, titleCase } from "../lib/format";
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
  Select,
  Table,
} from "../components/ui";
import type { EmploymentType, Membership, PayType, Role } from "../lib/types";

type SettingsPayload = {
  organization: {
    id: string;
    name: string;
    legalName: string | null;
    timezone: string;
    taxRateBps: number;
    taxesParts: boolean;
    taxesLabor: boolean;
    taxesFees: boolean;
    paymentProvider: string;
  };
  locations: Array<{ id: string; name: string; code: string; city: string | null }>;
  laborRates: Array<{ id: string; name: string; ratePerHour: number; costPerHour: number; isDefault: boolean }>;
  suppliers: Array<{ id: string; name: string; accountNumber: string | null }>;
  providerConnections: Array<{
    id: string;
    kind: string;
    provider: string;
    externalAccountId: string | null;
    isLive: boolean;
    isEnabled: boolean;
    hasCredentials: boolean;
  }>;
  implementedPaymentProviders: Array<{ name: string; capabilities: Record<string, unknown> }>;
};

export function SettingsPage() {
  const { can, user: me } = useAuth();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<SettingsPayload>("/settings"),
  });

  const staff = useQuery({
    queryKey: ["staff"],
    queryFn: () => api.get<{ data: Membership[] }>("/settings/staff"),
  });

  const [tax, setTax] = useState<string | null>(null);
  const [addingStaff, setAddingStaff] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Membership | null>(null);
  const [clearDataModalOpen, setClearDataModalOpen] = useState(false);

  const [deletingStaff, setDeletingStaff] = useState<Membership | null>(null);

  const saveTax = useMutation({
    mutationFn: (bps: number) => api.patch("/settings/organization", { taxRateBps: bps }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      setTax(null);
    },
  });

  const org = settings.data?.organization;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Shop configuration, staff, rates and integrations."
      />

      <DataState loading={settings.isLoading} error={settings.error}>
        {settings.data && org && (
          <div className="space-y-5">
            <Card title="Tax configuration">
              <Notice tone="warn">
                Sales tax is tracked as a liability, never as revenue. The rate and what it applies
                to must be reviewed for your launch jurisdiction by a qualified adviser before you
                go live.
              </Notice>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label="Sales tax rate"
                  hint="Stored in basis points. 950 is 9.50%."
                >
                  <div className="flex gap-2">
                    <Input
                      value={tax ?? String(org.taxRateBps)}
                      onChange={(e) => setTax(e.target.value)}
                      inputMode="numeric"
                      disabled={!can("settings.write")}
                      className="tabular-nums"
                    />
                    {can("settings.write") && tax !== null && (
                      <Button
                        loading={saveTax.isPending}
                        onClick={() => saveTax.mutate(Number(tax))}
                      >
                        Save
                      </Button>
                    )}
                  </div>
                </Field>

                <div className="space-y-1 text-sm">
                  <p className="font-medium text-ink">Applies to</p>
                  <p className="text-slate-600">
                    Parts: {org.taxesParts ? "taxed" : "not taxed"}
                  </p>
                  <p className="text-slate-600">
                    Labor: {org.taxesLabor ? "taxed" : "not taxed"}
                  </p>
                  <p className="text-slate-600">Fees: {org.taxesFees ? "taxed" : "not taxed"}</p>
                </div>
              </div>
              <ErrorBanner error={saveTax.error} />
            </Card>

            <Card
              title="Team"
              action={
                can("staff.manage") ? (
                  <Button variant="secondary" onClick={() => setAddingStaff(true)}>
                    Add staff
                  </Button>
                ) : undefined
              }
            >
              {can("payroll.read") && (
                <div className="mb-3">
                  <Notice>
                    Pay rate is visible here and editable only by an owner. It is not shown to
                    managers, even though a manager can see shop-wide job margins.
                  </Notice>
                </div>
              )}
              <DataState loading={staff.isLoading} error={staff.error}>
                <Table
                  headers={
                    can("payroll.read")
                      ? ["Name", "Email", "Role", "Location", "Employment", "Pay", "Last sign-in", "Status", ""]
                      : ["Name", "Email", "Role", "Location", "Last sign-in", "Status", ""]
                  }
                >
                  {staff.data?.data.map((m) => (
                    <tr key={m.id} className={m.isActive ? "" : "opacity-50"}>
                      <td className="px-3 py-2 font-medium">
                        {m.user.firstName} {m.user.lastName}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{m.user.email}</td>
                      <td className="px-3 py-2">{titleCase(m.role)}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {m.location?.name ?? "All locations"}
                      </td>
                      {can("payroll.read") && (
                        <>
                          <td className="px-3 py-2 text-xs text-slate-500">
                            {m.employmentType ? titleCase(m.employmentType) : "—"}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-xs text-slate-600">
                            {m.payRateCents === null
                              ? "—"
                              : m.payType === "HOURLY"
                                ? `${money(m.payRateCents)}/hr`
                                : `${money(m.payRateCents)}/period`}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {dateTime(m.user.lastLoginAt)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {m.isActive ? "Active" : "Access revoked"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          {can("staff.manage") && (
                            <Button variant="secondary" onClick={() => setEditingStaff(m)}>
                              Edit
                            </Button>
                          )}
                          {can("staff.manage") && m.user.id !== me?.id && (
                            <Button
                              variant="danger"
                              onClick={() => setDeletingStaff(m)}
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

            {can("settings.write") && (
              <Card title="Danger Zone — Remove All Data">
                <div className="space-y-4">
                  <Notice tone="danger">
                    <p className="font-bold text-red-950 mb-1">Permanently reset operational shop records</p>
                    <p className="text-xs">
                      Removes all customer transactions, tickets, repair orders, invoices, payments, vehicles, and parts stock.
                    </p>
                    <div className="mt-2.5 pt-2 border-t border-red-200/80 space-y-1 text-xs">
                      <p className="text-emerald-800 font-semibold flex items-center gap-1.5">
                        <span className="text-sm font-black">✓</span> Owner Login Account Preserved — You will not lose login access.
                      </p>
                      <p className="text-emerald-800 font-semibold flex items-center gap-1.5">
                        <span className="text-sm font-black">✓</span> Full Audit History Preserved — System logs and security history remain safe.
                      </p>
                      <p className="text-emerald-800 font-semibold flex items-center gap-1.5">
                        <span className="text-sm font-black">✓</span> Locations & Organization Settings Preserved.
                      </p>
                    </div>
                  </Notice>
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Remove All Existing Operational Data</p>
                      <p className="text-xs text-slate-500">
                        Zero out customer transactions, tickets, receipts, and ledger history. Requires confirmation.
                      </p>
                    </div>
                    <Button variant="danger" onClick={() => setClearDataModalOpen(true)}>
                      Remove All Data
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}
      </DataState>

      {addingStaff && (
        <AddStaffModal
          locations={settings.data?.locations ?? []}
          onClose={() => setAddingStaff(false)}
        />
      )}
      {editingStaff && (
        <EditStaffModal
          membership={editingStaff}
          locations={settings.data?.locations ?? []}
          onClose={() => setEditingStaff(null)}
        />
      )}
      {clearDataModalOpen && (
        <ClearDataModal onClose={() => setClearDataModalOpen(false)} />
      )}
      {deletingStaff && (
        <DeleteStaffModal
          membership={deletingStaff}
          onClose={() => setDeletingStaff(null)}
        />
      )}
    </>
  );
}

function ClearDataModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [confirmText, setConfirmText] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isConfirmed = confirmText.trim().toUpperCase() === "DELETE" || confirmText.trim().toUpperCase() === "DELETE ALL DATA";

  const clearMutation = useMutation({
    mutationFn: () =>
      api.post<{ success: boolean; message: string }>("/settings/clear-all-data", {
        confirm: confirmText.trim().toUpperCase() === "DELETE" ? "DELETE" : "DELETE ALL DATA",
      }),
    onSuccess: (data) => {
      setSuccessMsg(data.message);
      void queryClient.invalidateQueries();
      setTimeout(() => {
        onClose();
      }, 2500);
    },
  });

  return (
    <Modal title="Confirm Permanent Data Removal" onClose={onClose}>
      <div className="space-y-4">
        <ErrorBanner error={clearMutation.error} />
        {successMsg ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 text-sm font-semibold space-y-1">
            <p className="flex items-center gap-1.5 font-bold">
              <span className="text-lg">✓</span> {successMsg}
            </p>
            <p className="text-xs text-emerald-800 font-normal">
              Your Owner account remains fully active and logged in. All operational data has been cleared.
            </p>
          </div>
        ) : (
          <>
            <Notice tone="danger">
              <p className="font-bold text-red-950">High consequence action</p>
              <p className="text-xs mt-1">
                This will delete all repair orders, estimates, invoices, payments, customers, vehicles, appointments, and inventory units.
              </p>
            </Notice>

            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2 text-xs">
              <span className="font-bold text-slate-700 uppercase tracking-wider block text-[11px]">Safety Guarantee:</span>
              <ul className="space-y-1.5 text-slate-600">
                <li className="flex items-center gap-2 text-emerald-800 font-semibold">
                  <span className="text-sm">✓</span> <strong>Owner Login Account:</strong> Kept intact. You will NOT be locked out.
                </li>
                <li className="flex items-center gap-2 text-emerald-800 font-semibold">
                  <span className="text-sm">✓</span> <strong>Full Audit History:</strong> Completely preserved with timestamped record.
                </li>
                <li className="flex items-center gap-2 text-emerald-800 font-semibold">
                  <span className="text-sm">✓</span> <strong>Shop Locations & Settings:</strong> Preserved.
                </li>
                <li className="flex items-center gap-2 text-red-700 font-medium">
                  <span className="text-sm">✕</span> <strong>Operational Records:</strong> Invoices, jobs, payments & customers deleted.
                </li>
              </ul>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                To confirm deletion, type <strong className="font-mono text-red-600">DELETE</strong> in the box below:
              </label>
              <div className="relative">
                <Input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type DELETE to confirm"
                  className="font-mono text-sm"
                  autoFocus
                />
                {isConfirmed && (
                  <span className="absolute inset-y-0 right-0 flex items-center pr-3 text-emerald-600 font-bold text-xs">
                    ✓ Match
                  </span>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <Button type="button" variant="secondary" onClick={onClose} disabled={clearMutation.isPending}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={clearMutation.isPending}
                disabled={!isConfirmed}
                onClick={() => clearMutation.mutate()}
              >
                Permanently Remove Operational Data
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}


const ROLE_OPTIONS: Role[] = ["OWNER", "MANAGER", "SERVICE_ADVISOR", "TECHNICIAN", "BOOKKEEPER"];

function EmploymentFields({
  employmentType,
  setEmploymentType,
  payType,
  setPayType,
  payRate,
  setPayRate,
}: {
  employmentType: EmploymentType | "";
  setEmploymentType: (v: EmploymentType | "") => void;
  payType: PayType | "";
  setPayType: (v: PayType | "") => void;
  payRate: string;
  setPayRate: (v: string) => void;
}) {
  return (
    <div className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Employment and pay
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Employment type">
          <Select
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value as EmploymentType | "")}
          >
            <option value="">Not set</option>
            <option value="FULL_TIME">Full time</option>
            <option value="PART_TIME">Part time</option>
            <option value="CONTRACTOR">Contractor</option>
          </Select>
        </Field>
        <Field label="Pay type">
          <Select value={payType} onChange={(e) => setPayType(e.target.value as PayType | "")}>
            <option value="">Not set</option>
            <option value="HOURLY">Hourly</option>
            <option value="SALARY">Per pay period</option>
          </Select>
        </Field>
        <Field label={payType === "SALARY" ? "Amount per period" : "Rate per hour"}>
          <Input
            value={payRate}
            onChange={(e) => setPayRate(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>
      </div>
    </div>
  );
}

function AddStaffModal({
  locations,
  onClose,
}: {
  locations: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    role: "SERVICE_ADVISOR" as Role,
    locationId: "",
  });
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">("");
  const [payType, setPayType] = useState<PayType | "">("");
  const [payRate, setPayRate] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post("/settings/staff", {
        ...form,
        locationId: form.locationId || null,
        ...(can("payroll.write")
          ? {
              employmentType: employmentType || null,
              payType: payType || null,
              payRate: payRate ? Number(payRate) : null,
            }
          : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
      onClose();
    },
  });

  return (
    <Modal title="Add staff" onClose={onClose} wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <ErrorBanner error={create.error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" required>
            <Input
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
              required
              autoFocus
            />
          </Field>
          <Field label="Last name" required>
            <Input
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
              required
            />
          </Field>
        </div>

        <Field label="Email" required hint="If this email already has an account, they'll be added to this shop with a new sign-in.">
          <Input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            required
          />
        </Field>

        <Field label="Temporary password" required hint="At least 10 characters. Share it with them directly.">
          <Input
            type="text"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            required
            minLength={10}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role" required>
            <Select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {titleCase(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location" hint="Leave as all locations for multi-location access.">
            <Select
              value={form.locationId}
              onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {can("payroll.write") && (
          <EmploymentFields
            employmentType={employmentType}
            setEmploymentType={setEmploymentType}
            payType={payType}
            setPayType={setPayType}
            payRate={payRate}
            setPayRate={setPayRate}
          />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Add to team
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditStaffModal({
  membership,
  locations,
  onClose,
}: {
  membership: Membership;
  locations: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<Role>(membership.role);
  const [locationId, setLocationId] = useState(membership.locationId ?? "");
  const [firstName, setFirstName] = useState(membership.user.firstName);
  const [lastName, setLastName] = useState(membership.user.lastName);
  const [email, setEmail] = useState(membership.user.email);
  const [password, setPassword] = useState("");
  const [employmentType, setEmploymentType] = useState<EmploymentType | "">(
    membership.employmentType ?? "",
  );
  const [payType, setPayType] = useState<PayType | "">(membership.payType ?? "");
  const [payRate, setPayRate] = useState(
    membership.payRateCents !== null ? (membership.payRateCents / 100).toFixed(2) : "",
  );

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/settings/staff/${membership.id}`, {
        role,
        locationId: locationId || null,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        ...(password ? { password } : {}),
        ...(can("payroll.write")
          ? {
              employmentType: employmentType || null,
              payType: payType || null,
              payRate: payRate ? Number(payRate) : null,
            }
          : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
      onClose();
    },
  });

  const deactivate = useMutation({
    mutationFn: () => api.post(`/settings/staff/${membership.id}/deactivate`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
      onClose();
    },
  });

  return (
    <Modal title={`Edit ${membership.user.firstName} ${membership.user.lastName}`} onClose={onClose} wide>
      <div className="space-y-4">
        <ErrorBanner error={save.error || deactivate.error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name">
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </Field>
          <Field label="Last name">
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </Field>
          <Field label="Email (sign-in)">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="New password" hint="Leave blank to keep the current password. Min 10 characters.">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {titleCase(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location">
            <Select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {can("payroll.write") ? (
          <EmploymentFields
            employmentType={employmentType}
            setEmploymentType={setEmploymentType}
            payType={payType}
            setPayType={setPayType}
            payRate={payRate}
            setPayRate={setPayRate}
          />
        ) : (
          <Notice>Only an owner can view or change pay details.</Notice>
        )}

        <div className="flex items-center justify-between border-t border-slate-200 pt-4">
          <Button
            type="button"
            variant="danger"
            loading={deactivate.isPending}
            onClick={() => deactivate.mutate()}
          >
            Remove access
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" loading={save.isPending} onClick={() => save.mutate()}>
              Save changes
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DeleteStaffModal({
  membership,
  onClose,
}: {
  membership: Membership;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/settings/staff/${membership.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["staff"] });
      onClose();
    },
  });

  const userName = `${membership.user.firstName} ${membership.user.lastName}`.trim();

  return (
    <Modal title={`Delete ${userName}`} onClose={onClose}>
      <div className="space-y-4">
        <ErrorBanner error={deleteMutation.error} />

        <div className="rounded-xl border border-red-200 bg-red-50/70 p-4">
          <p className="text-sm font-bold text-red-950">
            Delete {userName}? They will lose all access. This cannot be undone.
          </p>
          <p className="mt-2 text-xs text-red-800 leading-relaxed">
            This will immediately revoke their ability to sign in and remove their account from this shop.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-slate-500">Name:</span>
            <span className="font-semibold text-slate-800">{userName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Email:</span>
            <span className="font-medium text-slate-800">{membership.user.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Role:</span>
            <span className="font-medium text-slate-800">{titleCase(membership.role)}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={deleteMutation.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            Delete User
          </Button>
        </div>
      </div>
    </Modal>
  );
}

