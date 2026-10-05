import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { money, num, parseMoney } from "../lib/format";
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
import type { CatalogItem } from "../lib/types";

/**
 * Parts catalog, with what vehicles each stocked part fits.
 *
 * This is the shop's own inventory, tagged by the shop. It is not a licensed
 * universal parts lookup (the guide names PartsTech, Nexpart, AutoZone and
 * AdvancePro as integration candidates that need a partner agreement first).
 * The make/model choices come from NHTSA's free public vehicle reference
 * data, the same source the VIN decoder already uses.
 */
export function PartsCatalogPage() {
  const { can } = useAuth();
  const [q, setQ] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CatalogItem | null>(null);

  const makes = useQuery({
    queryKey: ["ref-makes"],
    queryFn: () => api.get<{ data: string[] }>("/vehicles/reference/makes"),
    staleTime: 60 * 60 * 1000,
  });

  const models = useQuery({
    queryKey: ["ref-models", make],
    queryFn: () => api.get<{ data: string[] }>(`/vehicles/reference/models?make=${encodeURIComponent(make)}`),
    enabled: Boolean(make),
    staleTime: 60 * 60 * 1000,
  });

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (make) params.set("make", make);
  if (model) params.set("model", model);
  if (year) params.set("year", year);

  const catalog = useQuery({
    queryKey: ["parts-catalog", params.toString()],
    queryFn: () => api.get<{ data: CatalogItem[] }>(`/settings/catalog?${params.toString()}`),
  });

  const filteringByVehicle = Boolean(make || model || year);

  return (
    <>
      <PageHeader
        title="Parts and vehicles"
        description="Search the shop's parts catalog, or narrow it to what fits one vehicle."
        action={
          can("parts_catalog.write") ? (
            <Button onClick={() => setCreating(true)}>New part</Button>
          ) : undefined
        }
      />

      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Field label="Search">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Part # or description" />
          </Field>
          <Field label="Make" hint="From NHTSA's free vehicle reference list.">
            <Select
              value={make}
              onChange={(e) => {
                setMake(e.target.value);
                setModel("");
              }}
            >
              <option value="">Any make</option>
              {makes.data?.data.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Model">
            <Select value={model} onChange={(e) => setModel(e.target.value)} disabled={!make}>
              <option value="">Any model</option>
              {models.data?.data.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year">
            <Input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" placeholder="e.g. 2020" />
          </Field>
        </div>

        {filteringByVehicle && (
          <div className="mb-4">
            <Notice>
              Showing only parts tagged as fitting this vehicle. A part the shop stocks but has not
              tagged yet will not appear here until someone adds the fitment.
            </Notice>
          </div>
        )}

        <DataState
          loading={catalog.isLoading}
          error={catalog.error}
          empty={catalog.data?.data.length === 0}
          emptyMessage={
            filteringByVehicle
              ? "No part in the catalog is tagged for that vehicle yet."
              : "No parts in the catalog yet."
          }
        >
          <Table headers={["Part", "Category", "Cost", "Price", "On hand", "Fits", ""]}>
            {catalog.data?.data.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2">
                  <span className="font-mono text-xs">{item.partNumber}</span>
                  <br />
                  <span className="text-slate-600">{item.description}</span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{item.category}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600">
                  {can("reports.costs") ? money(item.costCents) : "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">{money(item.priceCents)}</td>
                <td className="px-3 py-2 tabular-nums">{num(item.onHand)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {item.fitments.length === 0
                    ? "Not tagged"
                    : `${item.fitments.length} vehicle${item.fitments.length === 1 ? "" : "s"}`}
                </td>
                <td className="px-3 py-2 text-right">
                  {can("parts_catalog.write") && (
                    <Button variant="secondary" onClick={() => setEditing(item)}>
                      Manage
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </DataState>
      </Card>

      {creating && <NewPartModal onClose={() => setCreating(false)} />}
      {editing && <ManagePartModal item={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function NewPartModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    partNumber: "",
    description: "",
    category: "Parts",
    cost: "",
    price: "",
    onHand: "0",
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<CatalogItem>("/settings/catalog", {
        partNumber: form.partNumber,
        description: form.description,
        category: form.category,
        costCents: parseMoney(form.cost) ?? 0,
        priceCents: parseMoney(form.price) ?? 0,
        onHand: Number(form.onHand || 0),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["parts-catalog"] });
      onClose();
    },
  });

  return (
    <Modal title="New part" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <ErrorBanner error={create.error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Part number" required>
            <Input
              value={form.partNumber}
              onChange={(e) => setForm((f) => ({ ...f, partNumber: e.target.value }))}
              className="font-mono"
              required
              autoFocus
            />
          </Field>
          <Field label="Category">
            <Input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            />
          </Field>
        </div>
        <Field label="Description" required>
          <Input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            required
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Cost">
            <Input
              value={form.cost}
              onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
              inputMode="decimal"
              placeholder="0.00"
            />
          </Field>
          <Field label="Price">
            <Input
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              inputMode="decimal"
              placeholder="0.00"
            />
          </Field>
          <Field label="On hand">
            <Input
              value={form.onHand}
              onChange={(e) => setForm((f) => ({ ...f, onHand: e.target.value }))}
              inputMode="decimal"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create part
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ManagePartModal({ item, onClose }: { item: CatalogItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [fitForm, setFitForm] = useState({ make: "", model: "", yearFrom: "", yearTo: "" });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["parts-catalog"] });

  const addFitment = useMutation({
    mutationFn: () =>
      api.post(`/settings/catalog/${item.id}/fitments`, {
        make: fitForm.make,
        model: fitForm.model,
        yearFrom: Number(fitForm.yearFrom),
        yearTo: Number(fitForm.yearTo || fitForm.yearFrom),
      }),
    onSuccess: () => {
      setFitForm({ make: "", model: "", yearFrom: "", yearTo: "" });
      refresh();
    },
  });

  const removeFitment = useMutation({
    mutationFn: (fitmentId: string) => api.delete(`/settings/catalog/fitments/${fitmentId}`),
    onSuccess: refresh,
  });

  return (
    <Modal title={`Manage ${item.partNumber}`} onClose={onClose} wide>
      <p className="mb-4 text-sm text-slate-600">{item.description}</p>

      <ErrorBanner error={addFitment.error || removeFitment.error} />

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Vehicles this part fits
      </h3>
      {item.fitments.length === 0 ? (
        <p className="mb-4 text-sm text-slate-500">Not tagged to any vehicle yet.</p>
      ) : (
        <ul className="mb-4 space-y-1">
          {item.fitments.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between rounded border border-slate-200 px-3 py-1.5 text-sm"
            >
              <span>
                {f.make} {f.model} &middot; {f.yearFrom === f.yearTo ? f.yearFrom : `${f.yearFrom}–${f.yearTo}`}
              </span>
              <button
                type="button"
                onClick={() => removeFitment.mutate(f.id)}
                className="text-xs text-red-600 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          addFitment.mutate();
        }}
      >
        <Field label="Make" required>
          <Input
            value={fitForm.make}
            onChange={(e) => setFitForm((f) => ({ ...f, make: e.target.value }))}
            required
          />
        </Field>
        <Field label="Model" required>
          <Input
            value={fitForm.model}
            onChange={(e) => setFitForm((f) => ({ ...f, model: e.target.value }))}
            required
          />
        </Field>
        <Field label="Year from" required>
          <Input
            value={fitForm.yearFrom}
            onChange={(e) => setFitForm((f) => ({ ...f, yearFrom: e.target.value }))}
            inputMode="numeric"
            required
          />
        </Field>
        <Field label="Year to" hint="Same as start for one year only.">
          <Input
            value={fitForm.yearTo}
            onChange={(e) => setFitForm((f) => ({ ...f, yearTo: e.target.value }))}
            inputMode="numeric"
          />
        </Field>
        <div className="sm:col-span-4">
          <Button type="submit" loading={addFitment.isPending}>
            Add fitment
          </Button>
        </div>
      </form>

      <div className="mt-4 flex justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
