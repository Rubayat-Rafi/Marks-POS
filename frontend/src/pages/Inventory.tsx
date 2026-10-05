import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { dateOnly, money, parseMoney } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { Button, DataState, ErrorBanner, Field, Input, Modal, Notice } from "../components/ui";
import { SwipeRow } from "../components/SwipeRow";
import { Icon } from "../components/Icon";
import { Pagination } from "../components/Pagination";
import type { InventoryKind, InventoryProduct, InventoryUnit } from "../lib/types";

type View = "ALL" | InventoryKind | "LOW";

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "ALL", label: "All" },
  { id: "TIRE", label: "Tires" },
  { id: "MUFFLER", label: "Mufflers" },
  { id: "OTHER", label: "Other" },
  { id: "LOW", label: "Reorder" },
];

const KIND_LABEL: Record<InventoryKind, string> = { TIRE: "Tire", MUFFLER: "Muffler", OTHER: "Other" };
const KIND_ICON: Record<InventoryKind, string> = { TIRE: "tire", MUFFLER: "exhaust", OTHER: "converter" };

const productName = (p: { brand: string | null; name: string }) => [p.brand, p.name].filter(Boolean).join(" ");

export function InventoryPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.id.toLowerCase() === (params.get("view") ?? "").toLowerCase())?.id ?? "ALL") as View;
  const [q, setQ] = useState("");
  const [receiving, setReceiving] = useState<InventoryProduct | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [page, setPage] = useState<number>(() => {
    const p = parseInt(params.get("page") || "1", 10);
    return isNaN(p) || p < 1 ? 1 : p;
  });
  const [limit, setLimit] = useState<number>(() => {
    const l = parseInt(params.get("limit") || "25", 10);
    return [10, 25, 50, 100].includes(l) ? l : 25;
  });
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">(() => {
    const s = params.get("sortOrder");
    return s === "asc" ? "asc" : "desc";
  });

  const setView = (v: View) => {
    setPage(1);
    if (v === "ALL") params.delete("view");
    else params.set("view", v.toLowerCase());
    params.set("page", "1");
    setParams(params, { replace: true });
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    params.set("page", String(newPage));
    setParams(params, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleLimitChange = (newLimit: number) => {
    setLimit(newLimit);
    setPage(1);
    params.set("limit", String(newLimit));
    params.set("page", "1");
    setParams(params, { replace: true });
  };

  const handleSortOrderChange = (newSort: "desc" | "asc") => {
    setSortOrder(newSort);
    setPage(1);
    params.set("sortOrder", newSort);
    params.set("page", "1");
    setParams(params, { replace: true });
  };

  const products = useQuery({
    queryKey: ["inventory", "products", view, q, page, limit, sortOrder],
    queryFn: () =>
      api.get<{
        data: InventoryProduct[];
        pagination?: { page: number; limit: number; total: number; totalPages: number };
      }>(
        `/inventory/products?${new URLSearchParams({
          page: String(page),
          limit: String(limit),
          sortOrder,
          ...(view === "TIRE" || view === "MUFFLER" || view === "OTHER" ? { kind: view } : {}),
          ...(view === "LOW" ? { low: "true" } : {}),
          ...(q.trim() ? { q: q.trim() } : {}),
        })}`,
      ),
  });
  const low = useQuery({
    queryKey: ["inventory", "low-stock"],
    queryFn: () =>
      api.get<{ count: number; data: Array<{ id: string; brand: string | null; name: string; size: string | null; inStock: number; reorderPoint: number }> }>(
        "/inventory/low-stock",
      ),
  });

  const list = products.data?.data ?? [];
  const total = products.data?.pagination?.total ?? list.length;
  const totalPages = products.data?.pagination?.totalPages ?? (Math.ceil(total / limit) || 1);

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Tires and mufflers tracked by serial number. You get a reminder when stock runs low."
        action={
          can("inventory.receive") ? (
            <Button size="lg" onClick={() => setAdding(true)}>
              <Icon name="plus" className="h-5 w-5" /> Add item
            </Button>
          ) : undefined
        }
      />

      {(low.data?.count ?? 0) > 0 && view !== "LOW" && (
        <button
          type="button"
          onClick={() => setView("LOW")}
          className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900"
        >
          <Icon name="alert" className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>Time to reorder:</strong>{" "}
            {low.data!.data
              .slice(0, 3)
              .map((p) => `${productName(p)}${p.size ? ` ${p.size}` : ""} (${p.inStock} left)`)
              .join(", ")}
            {low.data!.count > 3 && ` and ${low.data!.count - 3} more`}
          </span>
          <Icon name="chevronRight" className="h-4 w-4 shrink-0" />
        </button>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                view === v.id ? "bg-ink text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {v.label}
              {v.id === "LOW" && (low.data?.count ?? 0) > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{low.data!.count}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative sm:ml-auto sm:w-72">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Size, brand or serial" className="pl-10" />
        </div>
      </div>

      <DataState
        loading={products.isLoading}
        error={products.error}
        empty={list.length === 0}
        emptyMessage={view === "LOW" ? "Nothing needs reordering. Stock is healthy." : "No items yet. Add your first tire or muffler."}
      >
        <p className="mb-2 text-xs text-slate-500 sm:hidden">Swipe an item left to receive stock.</p>
        <ul className="space-y-2">
          {list.map((p) => (
            <li key={p.id} className="rounded-2xl shadow-card ring-1 ring-slate-200/80">
              <SwipeRow
                onOpen={() => setDetail(p.id)}
                actions={[
                  ...(can("inventory.receive")
                    ? [{ label: "Receive", icon: "plus", tone: "brand" as const, onAction: () => setReceiving(p) }]
                    : []),
                  { label: "Details", icon: "chevronRight", tone: "slate" as const, onAction: () => setDetail(p.id) },
                ]}
              >
                <div className="flex items-center gap-3 px-3 py-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <Icon name={KIND_ICON[p.kind]} className="h-6 w-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{productName(p)}</p>
                    <p className="truncate text-xs text-slate-500">
                      {p.size && <span className="font-mono">{p.size}</span>}
                      {p.size && " · "}
                      {money(p.priceCents)} · reorder at {p.reorderPoint}
                    </p>
                  </div>
                  <StockPill p={p} />
                </div>
              </SwipeRow>
            </li>
          ))}
        </ul>

        {total > 0 && (
          <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white shadow-xs overflow-hidden">
            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={total}
              pageSize={limit}
              onPageChange={handlePageChange}
              onPageSizeChange={handleLimitChange}
              pageSizeOptions={[10, 25, 50, 100]}
              sortOrder={sortOrder}
              onSortOrderChange={handleSortOrderChange}
              itemName="items"
            />
          </div>
        )}
      </DataState>

      {receiving && <ReceiveModal product={receiving} onClose={() => setReceiving(null)} />}
      {detail && <DetailModal productId={detail} onClose={() => setDetail(null)} onReceive={(p) => { setDetail(null); setReceiving(p); }} />}
      {adding && <AddModal onClose={() => setAdding(false)} />}
    </>
  );
}

function StockPill({ p }: { p: InventoryProduct }) {
  const tone =
    p.inStock === 0
      ? "bg-red-100 text-red-800"
      : p.lowStock
        ? "bg-amber-100 text-amber-800"
        : "bg-emerald-100 text-emerald-800";
  return (
    <span className={`shrink-0 rounded-xl px-3 py-1.5 text-center ${tone}`}>
      <span className="block font-display text-lg font-bold leading-none tabular-nums">{p.inStock}</span>
      <span className="block text-[10px] font-semibold uppercase tracking-wide">in stock</span>
    </span>
  );
}

function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };
}

/** Receive stock: type or scan serial numbers, one per line. */
function ReceiveModal({ product, onClose }: { product: InventoryProduct; onClose: () => void }) {
  const { can } = useAuth();
  const invalidate = useInvalidateInventory();
  const [serials, setSerials] = useState("");
  const [cost, setCost] = useState("");
  const [result, setResult] = useState<{ added: string[]; duplicates: string[] } | null>(null);

  const count = serials.split(/[\n,;\t]+/).filter((s) => s.trim()).length;

  const receive = useMutation({
    mutationFn: () =>
      api.post<{ added: string[]; duplicates: string[] }>(`/inventory/products/${product.id}/units`, {
        serials,
        ...(cost.trim() && parseMoney(cost) !== null ? { costCents: parseMoney(cost) } : {}),
      }),
    onSuccess: (r) => {
      setResult(r);
      setSerials("");
      invalidate();
    },
  });

  return (
    <Modal title={`Receive: ${productName(product)}${product.size ? ` ${product.size}` : ""}`} onClose={onClose}>
      <div className="space-y-4">
        {result && (
          <Notice tone={result.duplicates.length ? "warn" : "info"}>
            <p className="font-semibold">
              {result.added.length} added to stock.
            </p>
            {result.duplicates.length > 0 && (
              <p className="mt-1">
                Already on file, skipped: <span className="font-mono">{result.duplicates.join(", ")}</span>
              </p>
            )}
          </Notice>
        )}
        <ErrorBanner error={receive.error} />
        <Field label="Serial numbers" hint="One per line. A barcode scanner works here: scan each item and it goes on its own line.">
          <textarea
            value={serials}
            onChange={(e) => setSerials(e.target.value)}
            autoFocus
            rows={6}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-sm uppercase focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder={product.kind === "TIRE" ? "DOT B3LL J7Y 2404" : "WK216382404"}
          />
        </Field>
        {can("inventory.manage") && (
          <Field label="Cost per item (optional)" hint="Only if this batch cost something different from usual.">
            <Input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder={product.costCents ? (product.costCents / 100).toFixed(2) : ""} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
          <Button disabled={count === 0} loading={receive.isPending} onClick={() => receive.mutate()}>
            Add {count || ""} to stock
          </Button>
        </div>
      </div>
    </Modal>
  );
}

type ProductDetail = InventoryProduct & { units: InventoryUnit[] };

function DetailModal({
  productId,
  onClose,
  onReceive,
}: {
  productId: string;
  onClose: () => void;
  onReceive: (p: InventoryProduct) => void;
}) {
  const { can } = useAuth();
  const invalidate = useInvalidateInventory();
  const [tab, setTab] = useState<InventoryUnit["status"]>("IN_STOCK");
  const [edit, setEdit] = useState<null | { brand: string; name: string; size: string; price: string; cost: string; reorderPoint: string }>(null);

  const detail = useQuery({
    queryKey: ["inventory", "product", productId],
    queryFn: () => api.get<ProductDetail>(`/inventory/products/${productId}`),
  });
  const p = detail.data;

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/inventory/products/${productId}`, {
        brand: edit!.brand.trim() || null,
        name: edit!.name.trim(),
        size: edit!.size.trim() || null,
        priceCents: parseMoney(edit!.price) ?? 0,
        ...(edit!.cost.trim() ? { costCents: parseMoney(edit!.cost) ?? 0 } : {}),
        reorderPoint: Math.max(0, Number(edit!.reorderPoint) || 0),
      }),
    onSuccess: () => {
      setEdit(null);
      invalidate();
    },
  });

  const del = useMutation({
    mutationFn: () => api.delete(`/inventory/products/${productId}`),
    onSuccess: () => {
      onClose();
      invalidate();
    },
  });
  const [removingUnit, setRemovingUnit] = useState<InventoryUnit | null>(null);
  const removeUnit = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post(`/inventory/units/${id}/remove`, { reason }),
    onSuccess: () => {
      setRemovingUnit(null);
      invalidate();
    },
  });
  const restock = useMutation({
    mutationFn: (id: string) => api.post(`/inventory/units/${id}/restock`),
    onSuccess: invalidate,
  });

  const units = p?.units.filter((u) => u.status === tab) ?? [];
  const counts = {
    IN_STOCK: p?.units.filter((u) => u.status === "IN_STOCK").length ?? 0,
    SOLD: p?.units.filter((u) => u.status === "SOLD").length ?? 0,
    REMOVED: p?.units.filter((u) => u.status === "REMOVED").length ?? 0,
  };

  return (
    <Modal title={p ? `${productName(p)}${p.size ? ` ${p.size}` : ""}` : "Item"} onClose={onClose} wide>
      <DataState loading={detail.isLoading} error={detail.error}>
        {p && (
          <div className="space-y-5">
            {!edit ? (
              <div className="flex flex-wrap items-start justify-between gap-4">
                <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-slate-500">Type</dt>
                    <dd className="font-semibold">{KIND_LABEL[p.kind]}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Price</dt>
                    <dd className="font-semibold tabular-nums">{money(p.priceCents)}</dd>
                  </div>
                  {p.costCents !== null && (
                    <div>
                      <dt className="text-xs text-slate-500">Cost</dt>
                      <dd className="font-semibold tabular-nums">{money(p.costCents)}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="text-xs text-slate-500">Reorder at</dt>
                    <dd className="font-semibold">{p.reorderPoint} or fewer</dd>
                  </div>
                </dl>
                <div className="flex gap-2">
                  {can("inventory.manage") && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setEdit({
                          brand: p.brand ?? "",
                          name: p.name,
                          size: p.size ?? "",
                          price: (p.priceCents / 100).toFixed(2),
                          cost: p.costCents !== null ? (p.costCents / 100).toFixed(2) : "",
                          reorderPoint: String(p.reorderPoint),
                        })
                      }
                    >
                      Edit
                    </Button>
                  )}
                  {can("inventory.manage") && counts.IN_STOCK === 0 && counts.SOLD === 0 ? (
                    <Button
                      variant="secondary"
                      className="text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                      loading={del.isPending}
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this product?")) {
                          del.mutate();
                        }
                      }}
                    >
                      Delete
                    </Button>
                  ) : null}
                  {can("inventory.receive") && (
                    <Button onClick={() => onReceive(p)}>
                      <Icon name="plus" className="h-4 w-4" /> Receive
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-xl bg-slate-50 p-4">
                <ErrorBanner error={save.error} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Brand">
                    <Input value={edit.brand} onChange={(e) => setEdit({ ...edit, brand: e.target.value })} />
                  </Field>
                  <Field label="Name">
                    <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                  </Field>
                  <Field label="Size / fit">
                    <Input value={edit.size} onChange={(e) => setEdit({ ...edit, size: e.target.value })} />
                  </Field>
                  <Field label="Price">
                    <Input value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} inputMode="decimal" />
                  </Field>
                  <Field label="Cost">
                    <Input value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value })} inputMode="decimal" />
                  </Field>
                  <Field label="Remind me at" hint="Reorder when in stock falls to this">
                    <Input value={edit.reorderPoint} onChange={(e) => setEdit({ ...edit, reorderPoint: e.target.value.replace(/\D/g, "") })} inputMode="numeric" />
                  </Field>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setEdit(null)}>
                    Cancel
                  </Button>
                  {can("inventory.manage") && counts.IN_STOCK === 0 && counts.SOLD === 0 ? (
                    <Button
                      type="button"
                      variant="danger"
                      className="mr-auto"
                      loading={del.isPending}
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this product?")) {
                          del.mutate();
                        }
                      }}
                    >
                      Delete
                    </Button>
                  ) : null}
                  <Button loading={save.isPending} disabled={!edit.name.trim()} onClick={() => save.mutate()}>
                    Save
                  </Button>
                </div>
              </div>
            )}

            <div>
              <div className="mb-3 flex gap-2">
                {(
                  [
                    ["IN_STOCK", "In stock"],
                    ["SOLD", "Sold"],
                    ["REMOVED", "Removed"],
                  ] as Array<[InventoryUnit["status"], string]>
                ).map(([s, label]) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTab(s)}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${tab === s ? "bg-ink text-white" : "bg-slate-100 text-slate-600"}`}
                  >
                    {label} ({counts[s]})
                  </button>
                ))}
              </div>
              <ErrorBanner error={removeUnit.error ?? restock.error} />
              {units.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">None.</p>
              ) : (
                <ul className="max-h-[40vh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                  {units.map((u) => (
                    <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                      <div>
                        <p className="font-mono font-semibold">{u.serialNumber}</p>
                        <p className="text-xs text-slate-500">
                          {u.status === "SOLD" && u.soldAt ? `Sold ${dateOnly(u.soldAt)}` : `Received ${dateOnly(u.receivedAt)}`}
                          {u.note && ` · ${u.note}`}
                        </p>
                      </div>
                      {u.status === "IN_STOCK" && can("inventory.manage") && (
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-600 hover:underline"
                          onClick={() => setRemovingUnit(u)}
                        >
                          Remove
                        </button>
                      )}
                      {u.status === "REMOVED" && can("inventory.manage") && (
                        <button type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => restock.mutate(u.id)}>
                          Put back in stock
                        </button>
                      )}
                      {u.status === "SOLD" && u.invoice && (
                        <Link to={`/receipts/${u.invoice.id}`} className="text-xs font-semibold text-brand-600 hover:underline">
                          {u.invoice.number}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DataState>

      {removingUnit && p && (
        <RemoveUnitModal
          unit={removingUnit}
          product={p}
          isPending={removeUnit.isPending}
          error={removeUnit.error}
          onClose={() => setRemovingUnit(null)}
          onConfirm={(reason) => {
            removeUnit.mutate({ id: removingUnit.id, reason });
          }}
        />
      )}
    </Modal>
  );
}

function RemoveUnitModal({
  unit,
  product,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  unit: InventoryUnit;
  product: ProductDetail;
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [selectedPreset, setSelectedPreset] = useState("Damaged");
  const [customNote, setCustomNote] = useState("");

  const PRESETS = [
    { label: "Damaged / Defective", value: "Damaged" },
    { label: "Returned to Vendor", value: "Returned to vendor" },
    { label: "Missing / Lost Count", value: "Missing / lost" },
    { label: "Shop Use / Scrapped", value: "Shop use / scrapped" },
    { label: "Warranty Replacement", value: "Warranty replacement" },
    { label: "Other Reason", value: "Other" },
  ];

  const effectiveReason =
    selectedPreset === "Other"
      ? customNote.trim()
      : customNote.trim()
        ? `${selectedPreset}: ${customNote.trim()}`
        : selectedPreset;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (effectiveReason.length >= 3) {
      onConfirm(effectiveReason);
    }
  };

  return (
    <Modal title="Remove Unit from Inventory" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner error={error} />

        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700 shadow-2xs">
            <Icon name="box" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-amber-950 font-mono">Serial #{unit.serialNumber}</h4>
            <p className="mt-0.5 text-xs text-amber-800 truncate">
              {product.brand ? `${product.brand} ` : ""}{product.name}{product.size ? ` · ${product.size}` : ""}
            </p>
          </div>
        </div>

        <Field label="Reason for Removal" required hint="Choose an audit reason why this unit is being taken out of stock.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setSelectedPreset(p.value)}
                className={`flex items-center justify-between rounded-xl border p-2.5 text-left text-xs font-semibold transition ${
                  selectedPreset === p.value
                    ? "border-red-500 bg-red-50 text-red-900 ring-2 ring-red-500/20"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span>{p.label}</span>
                {selectedPreset === p.value && <Icon name="check" className="h-4 w-4 text-red-600 shrink-0" />}
              </button>
            ))}
          </div>
        </Field>

        <Field
          label={selectedPreset === "Other" ? "Specify Removal Reason" : "Additional Notes (Optional)"}
          required={selectedPreset === "Other"}
          hint={
            selectedPreset === "Other"
              ? "Minimum 3 characters explaining the removal."
              : "e.g. Bead torn during mounting, returned to vendor RMA #1234"
          }
        >
          <Input
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            placeholder={selectedPreset === "Other" ? "Type reason here..." : "Optional details or RMA/tracking #..."}
            required={selectedPreset === "Other"}
            autoFocus={selectedPreset === "Other"}
          />
        </Field>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            loading={isPending}
            disabled={effectiveReason.length < 3 || isPending}
            className="gap-1.5"
          >
            <Icon name="trash" className="h-4 w-4" />
            Remove Unit
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AddModal({ onClose }: { onClose: () => void }) {
  const { can } = useAuth();
  const invalidate = useInvalidateInventory();
  const [duplicatesSkipped, setDuplicatesSkipped] = useState<string[] | null>(null);
  const [form, setForm] = useState({
    kind: "TIRE" as InventoryKind,
    brand: "",
    name: "",
    size: "",
    price: "",
    cost: "",
    reorderPoint: "4",
    serials: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: () =>
      api.post<{ added: string[]; duplicates: string[] }>("/inventory/products", {
        kind: form.kind,
        brand: form.brand.trim() || null,
        name: form.name.trim(),
        size: form.size.trim() || null,
        priceCents: parseMoney(form.price) ?? 0,
        costCents: parseMoney(form.cost) ?? 0,
        reorderPoint: Math.max(0, Number(form.reorderPoint) || 0),
        serials: form.serials,
      }),
    onSuccess: (r) => {
      invalidate();
      if (r.duplicates.length > 0) {
        setDuplicatesSkipped(r.duplicates);
      } else {
        onClose();
      }
    },
  });

  if (duplicatesSkipped) {
    return (
      <Modal title="Item Added — Duplicate Serials Skipped" onClose={onClose}>
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <h4 className="font-bold text-amber-900 text-sm">Item was created, but duplicate serials were skipped:</h4>
            <p className="mt-2 font-mono text-xs text-amber-800 bg-white p-2.5 rounded-lg border border-amber-200">
              {duplicatesSkipped.join(", ")}
            </p>
            <p className="mt-2 text-xs text-amber-700">These serial numbers were already in inventory and cannot be duplicated.</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      </Modal>
    );
  }

  const managesPrices = can("inventory.manage");

  return (
    <Modal title="Add an item" onClose={onClose} wide>
      <div className="space-y-4">
        <ErrorBanner error={create.error} />
        <div className="flex gap-2">
          {(["TIRE", "MUFFLER", "OTHER"] as InventoryKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setForm((f) => ({ ...f, kind: k, reorderPoint: k === "TIRE" ? "4" : "2" }))}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold ${
                form.kind === k ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 text-ink"
              }`}
            >
              <Icon name={KIND_ICON[k]} className="h-5 w-5" /> {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Brand">
            <Input value={form.brand} onChange={set("brand")} placeholder={form.kind === "TIRE" ? "Michelin" : "Walker"} />
          </Field>
          <Field label="Name / model" required>
            <Input value={form.name} onChange={set("name")} placeholder={form.kind === "TIRE" ? "Defender2" : "Quiet-Flow"} />
          </Field>
          <Field label={form.kind === "TIRE" ? "Size" : "Fit / size"}>
            <Input value={form.size} onChange={set("size")} placeholder={form.kind === "TIRE" ? "225/65R17" : '2.25" in / out'} />
          </Field>
          {managesPrices && (
            <>
              <Field label="Sell price">
                <Input value={form.price} onChange={set("price")} inputMode="decimal" placeholder="0.00" />
              </Field>
              <Field label="Cost">
                <Input value={form.cost} onChange={set("cost")} inputMode="decimal" placeholder="0.00" />
              </Field>
            </>
          )}
          <Field label="Remind me at" hint="Low-stock reminder when in stock falls to this">
            <Input value={form.reorderPoint} onChange={(e) => setForm((f) => ({ ...f, reorderPoint: e.target.value.replace(/\D/g, "") }))} inputMode="numeric" />
          </Field>
        </div>
        {!managesPrices && <Notice>A manager sets the price and cost after you add the item.</Notice>}
        <Field label="Serial numbers (optional)" hint="One per line, or scan each item.">
          <textarea
            value={form.serials}
            onChange={set("serials")}
            rows={4}
            className="w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-sm uppercase focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!form.name.trim()} onClick={() => create.mutate()}>
            Add item
          </Button>
        </div>
      </div>
    </Modal>
  );
}
