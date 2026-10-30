import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { customerLabel } from "../lib/format";
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
  Table,
} from "../components/ui";
import { Pagination } from "../components/Pagination";
import type { Customer } from "../lib/types";

export function CustomersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") || "");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const deleteCustomer = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      void queryClient.invalidateQueries({ queryKey: ["board"] });
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });

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

  const handleSearchChange = (q: string) => {
    setSearch(q);
    setPage(1);
    if (q) params.set("q", q);
    else params.delete("q");
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

  const customers = useQuery({
    queryKey: ["customers", search, page, limit, sortOrder],
    queryFn: () =>
      api.get<{
        data: Customer[];
        pagination?: { page: number; limit: number; total: number; totalPages: number };
      }>(
        `/customers?${new URLSearchParams({
          page: String(page),
          limit: String(limit),
          sortOrder,
          ...(search.trim() ? { q: search.trim() } : {}),
        })}`,
      ),
  });

  const list = customers.data?.data ?? [];
  const total = customers.data?.pagination?.total ?? list.length;
  const totalPages = customers.data?.pagination?.totalPages ?? (Math.ceil(total / limit) || 1);

  return (
    <>
      <PageHeader
        title="Customers and vehicles"
        description="Search by name, company, phone or email. Vehicles and service history live on each customer."
        action={
          can("customers.write") ? (
            <Button onClick={() => setCreating(true)}>New customer</Button>
          ) : undefined
        }
      />

      <Card>
        <div className="mb-4">
          <label className="sr-only" htmlFor="customer-search">
            Search customers
          </label>
          <Input
            id="customer-search"
            placeholder="Search name, company, phone or email"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="max-w-md"
          />
        </div>

        <DataState
          loading={customers.isLoading}
          error={customers.error}
          empty={list.length === 0}
          emptyMessage={
            search ? `No customer matches "${search}".` : "No customers on file yet."
          }
        >
          <Table headers={["Customer", "Phone", "Email", "Vehicles", "Jobs", ""]}>
            {list.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-medium">
                  <Link to={`/customers/${c.id}`} className="text-ink hover:text-teal-700">
                    {customerLabel(c)}
                  </Link>
                  {c.taxExempt && (
                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      tax exempt
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-600">{c.phone ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{c.email ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums text-slate-600">
                  {c._count?.vehicles ?? 0}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-600">
                  {c._count?.repairOrders ?? 0}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Link to={`/customers/${c.id}`} className="text-sm text-teal-700 hover:underline">
                      Open
                    </Link>
                    {can("customers.write") && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(c)}
                        className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 hover:bg-red-100 transition"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>

          {total > 0 && (
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
              itemName="customers"
            />
          )}
        </DataState>
      </Card>

      {creating && <NewCustomerModal onClose={() => setCreating(false)} />}

      {deleteTarget && (
        <Modal
          title={`Delete ${customerLabel(deleteTarget)}?`}
          onClose={() => !deleteCustomer.isPending && setDeleteTarget(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              This will permanently delete <strong>{customerLabel(deleteTarget)}</strong> along with their vehicles, repair orders, estimates, invoices, and payments. This cannot be undone.
            </p>
            <ErrorBanner error={deleteCustomer.error} />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteCustomer.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                loading={deleteCustomer.isPending}
                onClick={() => deleteCustomer.mutate(deleteTarget.id)}
              >
                Yes, Delete Customer
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function NewCustomerModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    companyName: "",
    email: "",
    phone: "",
    addressLine1: "",
    city: "",
    state: "LA",
    postalCode: "",
    allowsMarketing: false,
  });

  const create = useMutation({
    mutationFn: (body: typeof form) =>
      api.post<Customer>("/customers", {
        ...body,
        companyName: body.companyName || null,
        email: body.email || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customers"] });
      onClose();
    },
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }));

  return (
    <Modal title="New customer" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(form);
        }}
      >
        <ErrorBanner error={create.error} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name" required>
            <Input value={form.firstName} onChange={set("firstName")} required />
          </Field>
          <Field label="Last name" required>
            <Input value={form.lastName} onChange={set("lastName")} required />
          </Field>
        </div>

        <Field label="Company" hint="Leave blank for a personal account.">
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

        <Notice>
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
              Service reminders and receipts are transactional and are sent regardless. This box
              only covers marketing.
            </span>
          </label>
        </Notice>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Create customer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
