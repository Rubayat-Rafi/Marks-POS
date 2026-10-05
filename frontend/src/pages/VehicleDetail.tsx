import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { customerLabel, dateOnly, dateTime, money, vehicleLabel } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { Card, DataState, Notice, StatTile, StatusBadge, Table } from "../components/ui";
import type { Customer, Vehicle } from "../lib/types";

type VehicleDetail = Vehicle & {
  owners: Array<{ customer: Customer }>;
  mileageReadings: Array<{ id: string; miles: number; observedAt: string; source: string }>;
  repairOrders: Array<{
    id: string;
    number: string;
    status: string;
    concern: string;
    createdAt: string;
    mileageIn: number | null;
    invoices: Array<{ number: string; total: number; status: string }>;
  }>;
  inspections: Array<{
    id: string;
    title: string;
    completedAt: string | null;
    items: Array<{ id: string; label: string; result: string; note: string | null }>;
  }>;
};

export function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();

  const vehicle = useQuery({
    queryKey: ["vehicle", id],
    queryFn: () => api.get<VehicleDetail>(`/vehicles/${id}`),
    enabled: Boolean(id),
  });

  const v = vehicle.data;
  const latestMileage = v?.mileageReadings[0];
  const lifetimeSpend =
    v?.repairOrders
      .flatMap((ro) => ro.invoices)
      .filter((i) => i.status !== "VOID" && i.status !== "DRAFT")
      .reduce((sum, i) => sum + i.total, 0) ?? 0;

  return (
    <>
      <PageHeader
        title={v ? vehicleLabel(v) : "Vehicle"}
        description={
          v
            ? [v.trim, v.engine, v.color].filter(Boolean).join("  ·  ") || undefined
            : undefined
        }
      />

      <DataState loading={vehicle.isLoading} error={vehicle.error}>
        {v && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-4">
              <StatTile
                label="Current mileage"
                value={latestMileage ? `${latestMileage.miles.toLocaleString()} mi` : "—"}
                sub={latestMileage ? dateOnly(latestMileage.observedAt) : "Never recorded"}
              />
              <StatTile label="Visits" value={String(v.repairOrders.length)} />
              {can("reports.sales") ? (
                <StatTile
                  label="Lifetime invoiced"
                  value={money(lifetimeSpend)}
                  sub="Issued invoices only"
                />
              ) : (
                <StatTile label="Inspections" value={String(v.inspections.length)} />
              )}
              <StatTile
                label="Owner"
                value={v.owners[0] ? customerLabel(v.owners[0].customer) : "Unassigned"}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Identification">
                <dl className="space-y-2 text-sm">
                  <Row label="VIN" value={<span className="font-mono text-xs">{v.vin ?? "—"}</span>} />
                  <Row label="Plate" value={`${v.plate ?? "—"}`} />
                  <Row label="Year" value={v.year ? String(v.year) : "—"} />
                  <Row label="Make" value={v.make ?? "—"} />
                  <Row label="Model" value={v.model ?? "—"} />
                  <Row label="Trim" value={v.trim ?? "—"} />
                  <Row label="Engine" value={v.engine ?? "—"} />
                </dl>

                <div className="mt-4">
                  {/* Provenance, stated rather than implied (build guide / 06). */}
                  {v.vinSource ? (
                    <Notice>
                      Identified from <strong>{v.vinSource}</strong> on {dateOnly(v.vinDecodedAt)}.
                      Decoding identifies the vehicle as built. It is not accident history and does
                      not guarantee parts fitment.
                    </Notice>
                  ) : (
                    <Notice tone="warn">
                      These details were entered by hand and have not been decoded from the VIN.
                    </Notice>
                  )}
                </div>
              </Card>

              <Card title="Owners">
                <DataState
                  empty={v.owners.length === 0}
                  emptyMessage="No customer is linked to this vehicle."
                >
                  <Table headers={["Customer", "Phone", ""]}>
                    {v.owners.map(({ customer }) => (
                      <tr key={customer.id}>
                        <td className="px-3 py-2 font-medium">{customerLabel(customer)}</td>
                        <td className="px-3 py-2 tabular-nums text-slate-600">
                          {customer.phone ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            to={`/customers/${customer.id}`}
                            className="text-sm text-teal-700 hover:underline"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </Table>
                </DataState>

                <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Mileage history
                </h3>
                <DataState
                  empty={v.mileageReadings.length === 0}
                  emptyMessage="No mileage recorded."
                >
                  <Table headers={["Recorded", "Miles", "Source"]}>
                    {v.mileageReadings.map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-2 text-slate-600">{dateOnly(m.observedAt)}</td>
                        <td className="px-3 py-2 tabular-nums">{m.miles.toLocaleString()}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">
                          {m.source.replace("_", " ")}
                        </td>
                      </tr>
                    ))}
                  </Table>
                </DataState>
              </Card>
            </div>

            <Card title="Service history at this shop">
              <div className="mb-3">
                <Notice>
                  This is the shop's own record of work performed. It is not a licensed vehicle
                  history report.
                </Notice>
              </div>

              <DataState
                empty={v.repairOrders.length === 0}
                emptyMessage="This vehicle has not been in yet."
              >
                <Table headers={["Date", "Job", "Mileage", "Concern", "Invoiced", "Status", ""]}>
                  {v.repairOrders.map((ro) => (
                    <tr key={ro.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                        {dateOnly(ro.createdAt)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{ro.number}</td>
                      <td className="px-3 py-2 tabular-nums text-slate-600">
                        {ro.mileageIn ? ro.mileageIn.toLocaleString() : "—"}
                      </td>
                      <td className="max-w-xs truncate px-3 py-2 text-slate-600">{ro.concern}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {ro.invoices.length > 0
                          ? money(ro.invoices.reduce((s, i) => s + i.total, 0))
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={ro.status} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link to={`/jobs/${ro.id}`} className="text-sm text-teal-700 hover:underline">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </Table>
              </DataState>
            </Card>

            <Card title="Inspection history">
              <DataState
                empty={v.inspections.length === 0}
                emptyMessage="No inspections recorded for this vehicle."
              >
                <div className="space-y-3">
                  {v.inspections.map((inspection) => {
                    const flagged = inspection.items.filter(
                      (i) => i.result === "URGENT" || i.result === "ADVISE",
                    );
                    return (
                      <div key={inspection.id} className="rounded border border-slate-200 p-3">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-medium text-ink">{inspection.title}</h3>
                          <span className="text-xs text-slate-500">
                            {dateTime(inspection.completedAt)}
                          </span>
                        </div>
                        {flagged.length === 0 ? (
                          <p className="mt-1 text-xs text-slate-500">Nothing flagged.</p>
                        ) : (
                          <ul className="mt-2 space-y-1 text-sm">
                            {flagged.map((item) => (
                              <li key={item.id} className="flex gap-2">
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                                    item.result === "URGENT"
                                      ? "bg-red-100 text-red-800"
                                      : "bg-amber-100 text-amber-800"
                                  }`}
                                >
                                  {item.result.toLowerCase()}
                                </span>
                                <span className="text-slate-600">
                                  {item.label}
                                  {item.note ? ` — ${item.note}` : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </DataState>
            </Card>
          </div>
        )}
      </DataState>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}
