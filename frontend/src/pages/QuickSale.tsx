import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiClientError, newIdempotencyKey } from "../lib/api";
import { money, parseMoney } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { Button, Card, DataState, ErrorBanner, Input, Modal, Select } from "../components/ui";
import { Icon } from "../components/Icon";
import type { AvailableProduct, InventoryKind } from "../lib/types";

type LineType = "LABOR" | "PART" | "FEE" | "DISCOUNT";

type TicketLine = {
  key: string;
  lineType: LineType;
  description: string;
  quantity: string;
  unitPrice: string;
  /** Serial-numbered stock on this line; quantity follows the serial count. */
  units: Array<{ id: string; serialNumber: string }>;
};

type Preview = { subtotal: number; discountTotal: number; taxTotal: number; total: number };

type PayMethod = "CASH" | "CARD_EXTERNAL" | "CHECK" | "LATER";

/** Common jobs at the counter. */
const PRESETS: Array<{ label: string; lineType: LineType; price?: string }> = [
  { label: "Tire", lineType: "PART", price: "48.00" },
  { label: "Muffler replacement", lineType: "LABOR" },
  { label: "Exhaust pipe repair", lineType: "LABOR" },
  { label: "Exhaust leak weld", lineType: "LABOR" },
  { label: "Catalytic converter install", lineType: "LABOR" },
  { label: "Tire mount & balance", lineType: "LABOR" },
  { label: "Flat tire repair", lineType: "LABOR" },
  { label: "Tire rotation", lineType: "LABOR" },
  { label: "Tire disposal fee", lineType: "FEE" },
  { label: "Tax", lineType: "FEE" },
];


const TYPE_LABELS: Record<LineType, string> = {
  LABOR: "Service",
  PART: "Part",
  FEE: "Fee",
  DISCOUNT: "Discount",
};

const blankLine = (partial: Partial<TicketLine> = {}): TicketLine => ({
  key: newIdempotencyKey(),
  lineType: "LABOR",
  description: "",
  quantity: "1",
  unitPrice: "",
  units: [],
  ...partial,
});

import { PosRegister } from "../features/pos/PosRegister";

export function QuickSalePage() {
  const { invoiceId } = useParams<{ invoiceId?: string }>();
  const [searchParams] = useSearchParams();
  const targetInvoiceId = invoiceId || searchParams.get("invoiceId") || undefined;
  const initialMode = targetInvoiceId || searchParams.get("mode") === "open-balances" ? "OPEN_BALANCES" : "QUICK_SALE";

  const [view, setView] = useState<"register" | "classic">(() => {
    try {
      return localStorage.getItem("quickSale.view") === "classic" ? "classic" : "register";
    } catch {
      return "register";
    }
  });

  if (view === "register") {
    return (
      <PosRegister
        initialMode={initialMode}
        initialInvoiceId={targetInvoiceId}
        onSwitchClassicView={() => {
          setView("classic");
          try {
            localStorage.setItem("quickSale.view", "classic");
          } catch {}
        }}
      />
    );
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-end text-xs px-1 print:hidden">
        <button
          type="button"
          onClick={() => {
            setView("register");
            try {
              localStorage.setItem("quickSale.view", "register");
            } catch {}
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
        >
          <Icon name="bolt" className="h-4 w-4" /> Switch to Touch Register View
        </button>
      </div>
      <ClassicQuickSaleForm />
    </>
  );
}

function ClassicQuickSaleForm() {
  const navigate = useNavigate();
  const { can } = useAuth();

  const [customer, setCustomer] = useState({ name: "", phone: "" });
  const [vehicle, setVehicle] = useState({ year: "", make: "", model: "", plate: "", mileage: "" });
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<PayMethod>(() => (can("payments.collect") ? "CASH" : "LATER"));
  const [amountInput, setAmountInput] = useState("");
  const [tenderedInput, setTenderedInput] = useState("");
  const [reference, setReference] = useState("");
  const [picker, setPicker] = useState(false);
  // One key per ticket: a double tap or a retry returns the same sale.
  const [ticketKey] = useState(newIdempotencyKey);

  const payload = useMemo(
    () =>
      lines
        .map((l) => ({
          lineType: l.units.length > 0 ? ("PART" as const) : l.lineType,
          description: l.description.trim(),
          quantity: l.units.length > 0 ? l.units.length : Number(l.quantity),
          unitPrice: parseMoney(l.unitPrice),
          taxable: true,
          unitIds: l.units.map((u) => u.id),
        }))
        .filter((l) => l.description && l.unitPrice !== null && l.quantity > 0) as Array<{
        lineType: LineType;
        description: string;
        quantity: number;
        unitPrice: number;
        taxable: boolean;
        unitIds: string[];
      }>,
    [lines],
  );
  const incomplete = lines.length - payload.length;

  // The server prices the ticket (tax rules live there), shortly after typing stops.
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    if (payload.length === 0) {
      setPreview(null);
      return;
    }
    setPreviewing(true);
    const controller = new AbortController();
    const t = window.setTimeout(() => {
      api
        .post<Preview>("/quick-sales/preview", { lines: payload }, { signal: controller.signal })
        .then(setPreview)
        .catch(() => undefined)
        .finally(() => setPreviewing(false));
    }, 350);
    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [payload]);

  const total = preview?.total ?? 0;
  // The amount follows the total until the cashier types their own.
  const [amountTouched, setAmountTouched] = useState(false);
  useEffect(() => {
    if (!amountTouched) setAmountInput(total > 0 ? (total / 100).toFixed(2) : "");
  }, [total, amountTouched]);

  const amount = parseMoney(amountInput);
  const tendered = method === "CASH" && tenderedInput.trim() ? parseMoney(tenderedInput) : null;
  const change = tendered !== null && amount !== null ? tendered - amount : null;

  const payProblem =
    method === "LATER"
      ? null
      : amount === null || amount <= 0
        ? "Enter the amount paid."
        : amount > total
          ? `More than the ${money(total)} total.`
          : tendered !== null && tendered < amount
            ? "Cash received is less than the amount."
            : null;

  const sale = useMutation({
    mutationFn: () =>
      api.post<{ invoiceId: string; lowStock?: Array<{ name: string; inStock: number }> }>("/quick-sales", {
        idempotencyKey: ticketKey,
        customer: { name: customer.name.trim() || undefined, phone: customer.phone.trim() || undefined },
        vehicle: {
          year: vehicle.year ? Number(vehicle.year) : null,
          make: vehicle.make.trim() || null,
          model: vehicle.model.trim() || null,
          plate: vehicle.plate.trim() || null,
          mileageIn: vehicle.mileage ? Number(vehicle.mileage.replace(/\D/g, "")) : null,
        },
        lines: payload,
        notes: notes.trim() || undefined,
        payment:
          method === "LATER"
            ? undefined
            : {
                method,
                amount: amount ?? undefined,
                reference: reference.trim() || undefined,
                tendered: tendered ?? undefined,
              },
      }),
    onSuccess: (result) => navigate(`/receipts/${result.invoiceId}?print=1`),
  });

  const canSubmit = payload.length > 0 && incomplete === 0 && total >= 0 && !payProblem && !sale.isPending && !previewing;

  const update = (key: string, patch: Partial<TicketLine>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const input =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-ink placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30";

  return (
    <>
      <PageHeader
        title="Quick sale"
        description="Bill the job, take payment and print the receipt in one step."
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_380px] [&>*]:min-w-0">
        <div className="space-y-5">
          <Card title="Customer & vehicle">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Name</span>
                <input className={input} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Leave blank for a walk-in" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Phone</span>
                <input className={input} value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} type="tel" inputMode="tel" placeholder="Finds a returning customer" />
              </label>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <input className={input} value={vehicle.year} onChange={(e) => setVehicle({ ...vehicle, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" placeholder="Year" aria-label="Year" />
              <input className={input} value={vehicle.make} onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })} placeholder="Make" aria-label="Make" />
              <input className={input} value={vehicle.model} onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })} placeholder="Model" aria-label="Model" />
              <input className={input} value={vehicle.plate} onChange={(e) => setVehicle({ ...vehicle, plate: e.target.value.toUpperCase() })} placeholder="Plate" aria-label="Plate" />
              <input className={`${input} col-span-2 sm:col-span-1`} value={vehicle.mileage} onChange={(e) => setVehicle({ ...vehicle, mileage: e.target.value })} inputMode="numeric" placeholder="Mileage" aria-label="Mileage" />
            </div>
          </Card>

          <Card
            title="Work & parts"
            action={
              can("inventory.read") ? (
                <Button size="sm" onClick={() => setPicker(true)}>
                  <Icon name="box" className="h-4 w-4" /> From inventory
                </Button>
              ) : undefined
            }
          >
            <div className="no-scrollbar -mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setLines((ls) => [...ls, blankLine({ description: p.label, lineType: p.lineType, unitPrice: p.price ?? "" })])}

                  className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand-300 hover:bg-brand-50"
                >
                  + {p.label}
                </button>
              ))}
            </div>

            {lines.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Tap a service above, pick tires or mufflers from inventory, or add a line.
              </div>
            ) : (
              <ul className="space-y-3">
                {lines.map((l) => {
                  const serialised = l.units.length > 0;
                  const price = parseMoney(l.unitPrice);
                  const qty = serialised ? l.units.length : Number(l.quantity);
                  return (
                    <li key={l.key} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex gap-2">
                        <input
                          className={`${input} flex-1 font-medium`}
                          value={l.description}
                          onChange={(e) => update(l.key, { description: e.target.value })}
                          placeholder="What was done or sold"
                          aria-label="Description"
                        />
                        <button
                          type="button"
                          onClick={() => remove(l.key)}
                          className="shrink-0 rounded-lg p-2.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Remove line"
                        >
                          <Icon name="x" className="h-5 w-5" />
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-[1fr_72px_1fr] gap-2 sm:grid-cols-[140px_90px_140px_1fr]">
                        {serialised ? (
                          <span className="flex items-center rounded-lg bg-slate-100 px-3 text-sm font-semibold text-slate-600">Part</span>
                        ) : (
                          <Select value={l.lineType} onChange={(e) => update(l.key, { lineType: e.target.value as LineType })} aria-label="Type">
                            {(Object.keys(TYPE_LABELS) as LineType[]).map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABELS[t]}
                              </option>
                            ))}
                          </Select>
                        )}
                        <input
                          className={`${input} text-center tabular-nums`}
                          value={serialised ? String(l.units.length) : l.quantity}
                          onChange={(e) => update(l.key, { quantity: e.target.value })}
                          disabled={serialised}
                          inputMode="decimal"
                          aria-label="Quantity"
                        />
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                          <input
                            className={`${input} pl-6 tabular-nums ${price === null && l.unitPrice.trim() === "" ? "border-amber-400" : ""}`}
                            value={l.unitPrice}
                            onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                            inputMode="decimal"
                            placeholder="Price"
                            aria-label="Unit price"
                          />
                        </div>
                        <p className="col-span-3 self-center text-right text-sm font-bold tabular-nums sm:col-span-1">
                          {price !== null && qty > 0 ? `${l.lineType === "DISCOUNT" ? "-" : ""}${money(Math.round(price * qty))}` : "—"}
                        </p>
                      </div>
                      {serialised && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {l.units.map((u) => (
                            <span key={u.id} className="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 font-mono text-[11px] font-semibold text-brand-800">
                              {u.serialNumber}
                              <button
                                type="button"
                                aria-label={`Remove ${u.serialNumber}`}
                                onClick={() => {
                                  const units = l.units.filter((x) => x.id !== u.id);
                                  if (units.length === 0) remove(l.key);
                                  else update(l.key, { units });
                                }}
                                className="text-brand-500 hover:text-red-600"
                              >
                                <Icon name="x" className="h-3 w-3" strokeWidth={2.5} />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, blankLine()])}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              <Icon name="plus" className="h-4 w-4" /> Add a line
            </button>

            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Work notes (printed on the receipt)</span>
              <textarea
                className={`${input} min-h-[72px]`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Replaced rusted muffler and rear hanger. Checked for leaks."
              />
            </label>
          </Card>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card title="Payment">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <dt>Subtotal</dt>
                <dd className="tabular-nums">{preview ? money(preview.subtotal) : "—"}</dd>
              </div>
              {(preview?.discountTotal ?? 0) > 0 && (
                <div className="flex justify-between text-slate-600">
                  <dt>Discount</dt>
                  <dd className="tabular-nums">-{money(preview!.discountTotal)}</dd>
                </div>
              )}
              <div className="flex justify-between text-slate-600">
                <dt>Sales tax</dt>
                <dd className="tabular-nums">{preview ? money(preview.taxTotal) : "—"}</dd>
              </div>
              <div className="flex items-end justify-between border-t border-slate-200 pt-2">
                <dt className="font-semibold">Total</dt>
                <dd className={`font-display text-3xl font-extrabold tabular-nums ${previewing ? "opacity-50" : ""}`}>{money(total)}</dd>
              </div>
            </dl>

            <fieldset className="mt-4">
              <legend className="mb-1.5 text-sm font-semibold text-ink">Paid by</legend>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["CASH", "Cash", "cash"],
                    ["CARD_EXTERNAL", "Card (other machine)", "card"],
                    ["CHECK", "Check", "receipt"],
                    ["LATER", "Pay later", "clock"],
                  ] as Array<[PayMethod, string, string]>
                ).map(([m, label, icon]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    aria-pressed={method === m}
                    disabled={m !== "LATER" && !can("payments.collect")}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm font-semibold transition disabled:opacity-40 ${
                      method === m ? "border-brand-600 bg-brand-50 text-brand-800 ring-2 ring-brand-600/20" : "border-slate-200 bg-white text-ink"
                    }`}
                  >
                    <Icon name={icon} className="h-5 w-5 shrink-0" /> {label}
                  </button>
                ))}
              </div>
            </fieldset>

            {method !== "LATER" && (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Amount paid</span>
                  <Input
                    value={amountInput}
                    onChange={(e) => {
                      setAmountTouched(true);
                      setAmountInput(e.target.value);
                    }}
                    inputMode="decimal"
                    className="text-lg font-bold tabular-nums"
                  />
                </label>
                {method === "CASH" && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-600">Cash received</span>
                      <Input value={tenderedInput} onChange={(e) => setTenderedInput(e.target.value)} inputMode="decimal" className="tabular-nums" />
                    </label>
                    <div className="rounded-xl bg-emerald-50 px-3 py-2">
                      <p className="text-xs font-semibold text-emerald-800">Change due</p>
                      <p className="font-display text-xl font-bold tabular-nums text-emerald-800">
                        {change !== null && change >= 0 ? money(change) : "—"}
                      </p>
                    </div>
                  </div>
                )}
                {(method === "CARD_EXTERNAL" || method === "CHECK") && (
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">
                      {method === "CARD_EXTERNAL" ? "Last 4 or approval code (optional)" : "Check number (optional)"}
                    </span>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
                  </label>
                )}
                {payProblem && payload.length > 0 && <p className="text-xs font-medium text-red-600">{payProblem}</p>}
              </div>
            )}

            <div className="mt-4 space-y-2">
              <ErrorBanner error={sale.error} />
              {incomplete > 0 && (
                <p className="text-xs font-medium text-amber-700">
                  {incomplete} line{incomplete === 1 ? " needs" : "s need"} a description and a price.
                </p>
              )}
              <Button size="xl" variant="success" className="w-full" disabled={!canSubmit} loading={sale.isPending} onClick={() => sale.mutate()}>
                <Icon name="printer" className="h-5 w-5" />
                {method === "LATER" ? "Save & print invoice" : "Complete & print receipt"}
              </Button>
              {sale.error instanceof ApiClientError && sale.error.status === 409 && (
                <p className="text-xs text-slate-500">Pick the item again from inventory; someone may have just sold it.</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {picker && (
        <InventoryPicker
          taken={new Set(lines.flatMap((l) => l.units.map((u) => u.id)))}
          onClose={() => setPicker(false)}
          onAdd={(product, units) => {
            setLines((ls) => [
              ...ls,
              blankLine({
                lineType: "PART",
                description: [product.brand, product.name, product.size].filter(Boolean).join(" "),
                unitPrice: product.priceCents ? (product.priceCents / 100).toFixed(2) : "",
                units,
              }),
            ]);
            setPicker(false);
          }}
        />
      )}
    </>
  );
}

/** Pick serial numbers from stock: tap them, or scan one straight in. */
function InventoryPicker({
  taken,
  onClose,
  onAdd,
}: {
  taken: Set<string>;
  onClose: () => void;
  onAdd: (product: AvailableProduct, units: Array<{ id: string; serialNumber: string }>) => void;
}) {
  const [kind, setKind] = useState<InventoryKind | "ALL">("ALL");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<{ productId: string; ids: Set<string> } | null>(null);

  const available = useQuery({
    queryKey: ["inventory", "available", kind, q],
    queryFn: () =>
      api.get<{ data: AvailableProduct[] }>(
        `/inventory/available?${new URLSearchParams({ ...(kind !== "ALL" ? { kind } : {}), ...(q.trim() ? { q: q.trim() } : {}) })}`,
      ),
  });

  const products = available.data?.data ?? [];

  // A scanner types the serial and presses Enter: select it if it is on the shelf.
  function onScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const code = q.replace(/\s+/g, "").toUpperCase();
    for (const p of products) {
      const unit = p.units.find((u) => u.serialNumber === code);
      if (unit && !taken.has(unit.id)) {
        setSelected((s) => {
          const ids = s?.productId === p.id ? new Set(s.ids) : new Set<string>();
          ids.add(unit.id);
          return { productId: p.id, ids };
        });
        setQ("");
        return;
      }
    }
  }

  function toggle(productId: string, unitId: string) {
    setSelected((s) => {
      const ids = s?.productId === productId ? new Set(s.ids) : new Set<string>();
      if (ids.has(unitId)) ids.delete(unitId);
      else ids.add(unitId);
      return ids.size ? { productId, ids } : null;
    });
  }

  const chosenProduct = products.find((p) => p.id === selected?.productId);

  return (
    <Modal title="Add from inventory" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["ALL", "TIRE", "MUFFLER", "OTHER"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${kind === k ? "bg-ink text-white" : "bg-slate-100 text-slate-600"}`}
            >
              {k === "ALL" ? "All" : k === "TIRE" ? "Tires" : k === "MUFFLER" ? "Mufflers" : "Other"}
            </button>
          ))}
        </div>
        <div className="relative">
          <Icon name="scan" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onScan}
            placeholder="Search size or brand, or scan a serial"
            className="pl-10"
            autoFocus
          />
        </div>

        <DataState loading={available.isLoading} error={available.error} empty={products.length === 0} emptyMessage="Nothing in stock matches.">
          <ul className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
            {products.map((p) => {
              const free = p.units.filter((u) => !taken.has(u.id));
              return (
                <li key={p.id} className={`rounded-xl border p-3 ${selected?.productId === p.id ? "border-brand-500 bg-brand-50/40" : "border-slate-200"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">
                        {[p.brand, p.name].filter(Boolean).join(" ")}
                        {p.size && <span className="ml-2 font-mono text-sm text-slate-500">{p.size}</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {free.length} in stock · {money(p.priceCents)} each
                      </p>
                    </div>
                    {free.length > 0 && (
                      <button
                        type="button"
                        className="shrink-0 text-xs font-semibold text-brand-600"
                        onClick={() => {
                          // Oldest stock first: the first N serials, one tap per tire.
                          const current = selected?.productId === p.id ? selected.ids.size : 0;
                          const next = free.slice(0, Math.min(free.length, current + 1)).map((u) => u.id);
                          setSelected({ productId: p.id, ids: new Set(next) });
                        }}
                      >
                        + Add one
                      </button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {free.map((u) => {
                      const on = selected?.productId === p.id && selected.ids.has(u.id);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => toggle(p.id, u.id)}
                          aria-pressed={on}
                          className={`rounded-md px-2 py-1 font-mono text-[11px] font-semibold ${
                            on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {u.serialNumber}
                        </button>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        </DataState>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-500">
            {selected && chosenProduct ? `${selected.ids.size} selected` : "Tap serial numbers to select them."}
          </p>
          <Button
            disabled={!selected || !chosenProduct}
            onClick={() =>
              chosenProduct &&
              selected &&
              onAdd(
                chosenProduct,
                chosenProduct.units.filter((u) => selected.ids.has(u.id)).map((u) => ({ id: u.id, serialNumber: u.serialNumber })),
              )
            }
          >
            Add to ticket
          </Button>
        </div>
      </div>
    </Modal>
  );
}
