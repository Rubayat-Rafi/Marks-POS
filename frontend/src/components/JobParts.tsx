import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { money, num, parseMoney } from "../lib/format";
import { useAuth } from "../lib/auth";
import { Button, DataState, ErrorBanner, Field, Input, Notice, Select, Table } from "./ui";

type PartUsage = {
  id: string;
  partNumber: string;
  description: string;
  quantity: string;
  unitPrice: number;
  unitCost?: number;
  returned: boolean;
};

type CatalogItem = {
  id: string;
  partNumber: string;
  description: string;
  costCents: number;
  priceCents: number;
  onHand: string;
  fitments?: Array<{ make: string; model: string; yearFrom: number; yearTo: number }>;
};

type JobVehicle = { year: number | null; make: string | null; model: string | null };

/**
 * Parts actually consumed on the job.
 *
 * This is what direct job cost reads from, not the estimate: a part quoted but
 * never fitted must not count as a cost (build guide / 07).
 */
export function JobParts({
  jobId,
  usages,
  vehicle,
}: {
  jobId: string;
  usages: PartUsage[];
  /** When given, offers a "this vehicle only" filter over the catalog. */
  vehicle?: JobVehicle;
}) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  // Default to filtered when the job's vehicle has enough to filter by.
  const [filterToVehicle, setFilterToVehicle] = useState(
    Boolean(vehicle?.make && vehicle?.model),
  );
  const [form, setForm] = useState({
    catalogItemId: "",
    partNumber: "",
    description: "",
    quantity: "1",
    unitCost: "",
    unitPrice: "",
  });

  const canFilterToVehicle = Boolean(vehicle?.make && vehicle?.model);
  const vehicleParams = new URLSearchParams();
  if (filterToVehicle && canFilterToVehicle) {
    if (vehicle!.make) vehicleParams.set("make", vehicle!.make);
    if (vehicle!.model) vehicleParams.set("model", vehicle!.model);
    if (vehicle!.year) vehicleParams.set("year", String(vehicle!.year));
  }

  const catalog = useQuery({
    queryKey: ["catalog", vehicleParams.toString()],
    queryFn: () => api.get<{ data: CatalogItem[] }>(`/settings/catalog?${vehicleParams.toString()}`),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["job", jobId] });

  const add = useMutation({
    mutationFn: () =>
      api.post(`/repair-orders/${jobId}/parts`, {
        catalogItemId: form.catalogItemId || null,
        partNumber: form.partNumber,
        description: form.description,
        quantity: Number(form.quantity || 1),
        unitCost: parseMoney(form.unitCost) ?? 0,
        unitPrice: parseMoney(form.unitPrice) ?? 0,
      }),
    onSuccess: () => {
      refresh();
      setAdding(false);
      setForm({
        catalogItemId: "",
        partNumber: "",
        description: "",
        quantity: "1",
        unitCost: "",
        unitPrice: "",
      });
    },
  });

  const returnPart = useMutation({
    mutationFn: (usageId: string) => api.post(`/repair-orders/parts/${usageId}/return`),
    onSuccess: refresh,
  });

  const pick = (itemId: string) => {
    const item = catalog.data?.data.find((c) => c.id === itemId);
    if (!item) {
      setForm((f) => ({ ...f, catalogItemId: "" }));
      return;
    }
    setForm((f) => ({
      ...f,
      catalogItemId: item.id,
      partNumber: item.partNumber,
      description: item.description,
      unitCost: (item.costCents / 100).toFixed(2),
      unitPrice: (item.priceCents / 100).toFixed(2),
    }));
  };

  const showCosts = can("reports.costs");
  const consumed = usages.filter((u) => !u.returned);
  const totalCost = consumed.reduce((sum, u) => sum + num(u.quantity) * (u.unitCost ?? 0), 0);

  return (
    <div className="space-y-3">
      <ErrorBanner error={add.error} />
      <ErrorBanner error={returnPart.error} />

      <DataState
        empty={usages.length === 0}
        emptyMessage="No parts recorded against this job."
      >
        <Table
          headers={
            showCosts
              ? ["Part", "Qty", "Unit cost", "Unit price", "Extended cost", ""]
              : ["Part", "Qty", "Unit price", ""]
          }
        >
          {usages.map((u) => (
            <tr key={u.id} className={u.returned ? "opacity-50" : ""}>
              <td className="px-3 py-2">
                <span className="font-mono text-xs">{u.partNumber}</span>
                <br />
                <span className="text-slate-600">{u.description}</span>
              </td>
              <td className="px-3 py-2 tabular-nums">{num(u.quantity)}</td>
              {showCosts && (
                <td className="px-3 py-2 tabular-nums text-slate-600">{money(u.unitCost)}</td>
              )}
              <td className="px-3 py-2 tabular-nums">{money(u.unitPrice)}</td>
              {showCosts && (
                <td className="px-3 py-2 tabular-nums text-slate-600">
                  {u.returned ? "—" : money(Math.round(num(u.quantity) * (u.unitCost ?? 0)))}
                </td>
              )}
              <td className="px-3 py-2 text-right">
                {u.returned ? (
                  <span className="text-xs text-slate-500">returned</span>
                ) : (
                  can("jobs.write") && (
                    <Button
                      variant="secondary"
                      loading={returnPart.isPending}
                      onClick={() => returnPart.mutate(u.id)}
                    >
                      Return
                    </Button>
                  )
                )}
              </td>
            </tr>
          ))}
        </Table>
      </DataState>

      {showCosts && consumed.length > 0 && (
        <p className="text-right text-sm text-slate-600">
          Parts cost on this job{" "}
          <span className="font-semibold tabular-nums text-ink">
            {money(Math.round(totalCost))}
          </span>
        </p>
      )}

      {can("jobs.write") &&
        (adding ? (
          <form
            className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            {canFilterToVehicle && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={filterToVehicle}
                  onChange={(e) => setFilterToVehicle(e.target.checked)}
                />
                Only show parts tagged for this {vehicle!.year ? `${vehicle!.year} ` : ""}
                {vehicle!.make} {vehicle!.model}
              </label>
            )}

            <Field
              label="From catalog"
              hint={
                filterToVehicle && canFilterToVehicle
                  ? "Filtered to this vehicle. Untick above to search everything, or leave blank for a one-off part."
                  : "Or leave blank and type a one-off part below."
              }
            >
              <Select value={form.catalogItemId} onChange={(e) => pick(e.target.value)}>
                <option value="">One-off part…</option>
                {catalog.data?.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.partNumber} — {item.description} ({num(item.onHand)} on hand)
                  </option>
                ))}
              </Select>
              {filterToVehicle && canFilterToVehicle && catalog.data?.data.length === 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  Nothing in the catalog is tagged for this vehicle yet. Untick the filter above,
                  or tag fitment from Parts &amp; vehicles in the sidebar.
                </p>
              )}
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Part number" required>
                <Input
                  value={form.partNumber}
                  onChange={(e) => setForm((f) => ({ ...f, partNumber: e.target.value }))}
                  required
                  className="font-mono"
                />
              </Field>
              <Field label="Description" required>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  required
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Quantity" required>
                <Input
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                  inputMode="decimal"
                  required
                />
              </Field>
              {showCosts && (
                <Field label="Unit cost" hint="What the shop paid.">
                  <Input
                    value={form.unitCost}
                    onChange={(e) => setForm((f) => ({ ...f, unitCost: e.target.value }))}
                    inputMode="decimal"
                    placeholder="0.00"
                  />
                </Field>
              )}
              <Field label="Unit price" hint="What the customer is charged.">
                <Input
                  value={form.unitPrice}
                  onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
                  inputMode="decimal"
                  placeholder="0.00"
                />
              </Field>
            </div>

            {!showCosts && (
              <Notice>
                Cost is recorded by a manager or bookkeeper. Leaving it out means this job's
                margin stays flagged as incomplete rather than looking artificially high.
              </Notice>
            )}

            <div className="flex gap-2">
              <Button type="submit" loading={add.isPending}>
                Record part used
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add part used
          </Button>
        ))}
    </div>
  );
}
