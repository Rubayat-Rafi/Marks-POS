import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { money } from "../lib/format";
import { useAuth } from "../lib/auth";
import { Button, Input, Select } from "./ui";
import type { LineType } from "../lib/types";

export type DraftLine = {
  lineType: LineType;
  description: string;
  /** Kept as strings while typing so a half-entered number is not coerced. */
  quantity: string;
  unitPrice: string;
  unitCost: string;
  catalogItemId?: string;
};

type CatalogItem = {
  id: string;
  partNumber: string;
  description: string;
  costCents: number;
  priceCents: number;
  onHand: string;
};

const LINE_TYPES: Array<{ value: LineType; label: string }> = [
  { value: "LABOR", label: "Labor" },
  { value: "PART", label: "Part" },
  { value: "FEE", label: "Fee" },
  { value: "SUBLET", label: "Sublet" },
  { value: "DISCOUNT", label: "Discount" },
];

/**
 * Line editor for estimates.
 *
 * It shows a running subtotal for orientation only. The authoritative total,
 * including tax, comes back from the server after the estimate is saved
 * (build guide / 04): the browser never decides what a customer owes.
 */
export function LineEditor({
  lines,
  onChange,
  vehicle,
}: {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  /** When given, offers a "this vehicle only" filter over the parts catalog. */
  vehicle?: { year: number | null; make: string | null; model: string | null };
}) {
  const { can } = useAuth();
  const canFilterToVehicle = Boolean(vehicle?.make && vehicle?.model);
  const [filterToVehicle, setFilterToVehicle] = useState(canFilterToVehicle);

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

  const update = (index: number, patch: Partial<DraftLine>) =>
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));

  const remove = (index: number) => onChange(lines.filter((_, i) => i !== index));

  const add = (lineType: LineType = "LABOR") =>
    onChange([
      ...lines,
      { lineType, description: "", quantity: "1", unitPrice: "", unitCost: "" },
    ]);

  const pickPart = (index: number, itemId: string) => {
    const item = catalog.data?.data.find((c) => c.id === itemId);
    if (!item) return;
    update(index, {
      lineType: "PART",
      description: item.description,
      unitPrice: (item.priceCents / 100).toFixed(2),
      unitCost: (item.costCents / 100).toFixed(2),
      catalogItemId: item.id,
    });
  };

  const runningSubtotal = lines.reduce((sum, l) => {
    const value = Number(l.quantity || 0) * Number(l.unitPrice || 0);
    if (!Number.isFinite(value)) return sum;
    return l.lineType === "DISCOUNT" ? sum - Math.abs(value) : sum + value;
  }, 0);

  return (
    <div className="space-y-3">
      {canFilterToVehicle && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={filterToVehicle}
            onChange={(e) => setFilterToVehicle(e.target.checked)}
          />
          When picking a part, only show ones tagged for this vehicle
        </label>
      )}

      {lines.map((line, index) => (
        <div
          key={index}
          className="grid grid-cols-1 gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-12"
        >
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500">Type</label>
            <Select
              value={line.lineType}
              onChange={(e) => update(index, { lineType: e.target.value as LineType })}
            >
              {LINE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:col-span-4">
            <label className="mb-1 block text-xs font-medium text-slate-500">Description</label>
            {line.lineType === "PART" ? (
              <div className="space-y-1">
                <Input
                  value={line.description}
                  onChange={(e) => update(index, { description: e.target.value })}
                  placeholder="Part description"
                />
                <Select
                  value={line.catalogItemId ?? ""}
                  onChange={(e) => pickPart(index, e.target.value)}
                  className="text-xs"
                >
                  <option value="">Pick from catalog…</option>
                  {catalog.data?.data.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.partNumber} — {item.description}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <Input
                value={line.description}
                onChange={(e) => update(index, { description: e.target.value })}
                placeholder={line.lineType === "LABOR" ? "What the tech will do" : "Description"}
              />
            )}
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {line.lineType === "LABOR" ? "Hours" : "Qty"}
            </label>
            <Input
              value={line.quantity}
              onChange={(e) => update(index, { quantity: e.target.value })}
              inputMode="decimal"
              className="tabular-nums"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {line.lineType === "LABOR" ? "Rate / hr" : "Unit price"}
            </label>
            <Input
              value={line.unitPrice}
              onChange={(e) => update(index, { unitPrice: e.target.value })}
              inputMode="decimal"
              placeholder="0.00"
              className="tabular-nums"
            />
          </div>

          {/* Cost is only visible to roles allowed to see it. */}
          {can("reports.costs") && line.lineType !== "DISCOUNT" && (
            <div className="sm:col-span-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">Cost</label>
              <Input
                value={line.unitCost}
                onChange={(e) => update(index, { unitCost: e.target.value })}
                inputMode="decimal"
                placeholder="0.00"
                className="tabular-nums"
              />
            </div>
          )}

          <div className="flex items-end justify-end sm:col-span-1">
            <button
              type="button"
              onClick={() => remove(index)}
              className="rounded px-2 py-2 text-sm text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={`Remove line ${index + 1}`}
              disabled={lines.length === 1}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => add("LABOR")}>
            Add labor
          </Button>
          <Button type="button" variant="secondary" onClick={() => add("PART")}>
            Add part
          </Button>
          <Button type="button" variant="secondary" onClick={() => add("FEE")}>
            Add fee
          </Button>
        </div>
        <p className="text-sm text-slate-500">
          Running subtotal{" "}
          <span className="font-semibold tabular-nums text-ink">
            {money(Math.round(runningSubtotal * 100))}
          </span>{" "}
          <span className="text-xs">(before tax; the server calculates the final total)</span>
        </p>
      </div>
    </div>
  );
}
