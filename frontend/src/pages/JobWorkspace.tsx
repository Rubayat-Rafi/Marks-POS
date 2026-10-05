import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import {
  customerLabel,
  dateTime,
  money,
  num,
  percent,
  titleCase,
  vehicleLabel,
} from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import {
  Button,
  Card,
  DataState,
  ErrorBanner,
  Notice,
  Select,
  StatTile,
  StatusBadge,
  Table,
} from "../components/ui";
import { LineEditor, type DraftLine } from "../components/LineEditor";
import { JobTasks } from "../components/JobTasks";
import { JobParts } from "../components/JobParts";
import { JobTime } from "../components/JobTime";
import { JobInspection } from "../components/JobInspection";
import type {
  Estimate,
  EstimateVersion,
  Invoice,
  RepairOrder,
  RepairOrderStatus,
} from "../lib/types";

const TABS = ["overview", "inspection", "estimates", "parts & time", "invoice"] as const;
type Tab = (typeof TABS)[number];

const ALL_STATUSES: RepairOrderStatus[] = [
  "SCHEDULED",
  "CHECKED_IN",
  "DIAGNOSING",
  "AWAITING_APPROVAL",
  "AWAITING_PARTS",
  "IN_PROGRESS",
  "QUALITY_CHECK",
  "READY",
  "DELIVERED",
  "CANCELLED",
];

export function JobWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);

  const job = useQuery({
    queryKey: ["job", id],
    queryFn: () => api.get<RepairOrder>(`/repair-orders/${id}`),
    enabled: Boolean(id),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["job", id] });
    void queryClient.invalidateQueries({ queryKey: ["board"] });
  };

  const changeStatus = useMutation({
    mutationFn: (vars: { status: RepairOrderStatus; version: number }) =>
      api.post<RepairOrder & { warnings?: string[] }>(`/repair-orders/${id}/status`, {
        status: vars.status,
        expectedVersion: vars.version,
      }),
    onSuccess: refresh,
  });

  const ro = job.data;

  return (
    <>
      <PageHeader
        title={ro ? `${ro.number} — ${vehicleLabel(ro.vehicle)}` : "Job"}
        description={ro ? `${customerLabel(ro.customer)}  ·  ${ro.concern}` : undefined}
        action={
          ro ? (
            <div className="flex items-center gap-2">
              <StatusBadge status={ro.status} />
              {can("jobs.write") && ro.status !== "DELIVERED" && ro.status !== "CANCELLED" && (
                <Select
                  value={ro.status}
                  disabled={changeStatus.isPending}
                  onChange={(e) =>
                    changeStatus.mutate({
                      status: e.target.value as RepairOrderStatus,
                      version: ro.version,
                    })
                  }
                  className="w-48 text-xs"
                  aria-label="Change job status"
                >
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleCase(s)}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Cancelling a job does not cancel supplier orders or refund payments;
          the server returns those warnings and they are shown, not swallowed. */}
      {changeStatus.data?.warnings?.length ? (
        <div className="mb-4">
          <Notice tone="warn">
            <ul className="list-inside list-disc space-y-0.5">
              {changeStatus.data.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}
      {changeStatus.error && (
        <div className="mb-4">
          <ErrorBanner error={changeStatus.error} />
        </div>
      )}

      <DataState loading={job.isLoading} error={job.error}>
        {ro && (
          <>
            <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
              {TABS.map((t) => {
                if (t === "invoice" && !can("invoices.read")) return null;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize transition ${
                      tab === t
                        ? "border-teal-600 text-teal-700"
                        : "border-transparent text-slate-500 hover:text-ink"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>

            {tab === "overview" && <Overview job={ro} onRefresh={refresh} />}

            {tab === "inspection" && (
              <Card title="Inspection">
                <JobInspection jobId={ro.id} inspections={ro.inspections ?? []} />
              </Card>
            )}

            {tab === "estimates" && (
              <Estimates
                job={ro}
                approvalUrl={approvalUrl}
                setApprovalUrl={setApprovalUrl}
                onRefresh={refresh}
              />
            )}

            {tab === "parts & time" && (
              <div className="space-y-4">
                <Card title="Tasks">
                  <JobTasks jobId={ro.id} tasks={ro.tasks ?? []} />
                </Card>
                <Card title="Parts consumed">
                  <JobParts
                    jobId={ro.id}
                    usages={ro.partUsages ?? []}
                    vehicle={{ year: ro.vehicle.year, make: ro.vehicle.make, model: ro.vehicle.model }}
                  />
                </Card>
                <Card title="Technician time">
                  <JobTime jobId={ro.id} entries={ro.timeEntries ?? []} />
                </Card>
              </div>
            )}

            {tab === "invoice" && can("invoices.read") && (
              <InvoiceSection job={ro} onRefresh={refresh} />
            )}
          </>
        )}
      </DataState>
    </>
  );
}

// ---------------------------------------------------------------------------

function Overview({ job, onRefresh }: { job: RepairOrder; onRefresh: () => void }) {
  const { can } = useAuth();

  const recognizeCosts = useMutation({
    mutationFn: () => api.post(`/invoices/repair-orders/${job.id}/recognize-costs`),
    onSuccess: onRefresh,
  });

  const openTasks = job.tasks?.filter((t) => t.status !== "DONE").length ?? 0;
  const workedHours = (job.timeEntries ?? []).reduce((s, t) => s + num(t.workedHours), 0);

  return (
    <div className="space-y-4">
      {/* Cost and margin are withheld from advisors and technicians. */}
      {job.margin && (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatTile label="Net job sales" value={money(job.margin.netSales)} />
          <StatTile
            label="Direct cost"
            value={money(job.margin.directCost)}
            sub={job.margin.provisional ? "Provisional" : "Recognised"}
            tone={job.margin.provisional ? "warn" : "neutral"}
          />
          <StatTile label="Gross profit" value={money(job.margin.grossProfit)} tone="good" />
          <StatTile
            label="Gross margin"
            value={percent(job.margin.grossMarginPct)}
            sub={job.margin.provisional ? "Not final until costs are recognised" : undefined}
          />
        </div>
      )}

      {job.margin?.provisional && can("finance.read") && (job.invoices?.length ?? 0) > 0 && (
        <Notice tone="warn">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Costs on this job have not been recognised, so the margin above is provisional.
            </span>
            <Button
              variant="secondary"
              loading={recognizeCosts.isPending}
              onClick={() => recognizeCosts.mutate()}
            >
              Recognise costs
            </Button>
          </div>
        </Notice>
      )}
      <ErrorBanner error={recognizeCosts.error} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Job">
          <dl className="space-y-2 text-sm">
            <Detail label="Concern" value={job.concern} />
            <Detail
              label="Mileage in"
              value={job.mileageIn ? `${job.mileageIn.toLocaleString()} mi` : "Not recorded"}
            />
            <Detail label="Promised" value={dateTime(job.promisedAt)} />
            <Detail label="Open tasks" value={openTasks === 0 ? "None" : String(openTasks)} />
            <Detail label="Worked hours" value={workedHours.toFixed(2)} />
          </dl>
        </Card>

        <Card title="Customer and vehicle">
          <dl className="space-y-2 text-sm">
            <Detail
              label="Customer"
              value={
                <Link
                  to={`/customers/${job.customer.id}`}
                  className="text-teal-700 hover:underline"
                >
                  {customerLabel(job.customer)}
                </Link>
              }
            />
            <Detail label="Phone" value={job.customer.phone ?? "—"} />
            <Detail label="Vehicle" value={vehicleLabel(job.vehicle)} />
            <Detail
              label="VIN"
              value={<span className="font-mono text-xs">{job.vehicle.vin ?? "—"}</span>}
            />
          </dl>
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Estimates({
  job,
  approvalUrl,
  setApprovalUrl,
  onRefresh,
}: {
  job: RepairOrder;
  approvalUrl: string | null;
  setApprovalUrl: (url: string | null) => void;
  onRefresh: () => void;
}) {
  const { can } = useAuth();
  const [building, setBuilding] = useState(false);

  return (
    <Card
      title="Estimates and approvals"
      action={
        can("estimates.write") && !building ? (
          <Button variant="secondary" onClick={() => setBuilding(true)}>
            {job.estimates?.length ? "New estimate" : "Build estimate"}
          </Button>
        ) : undefined
      }
    >
      {approvalUrl && (
        <div className="mb-4">
          <Notice>
            <p className="font-medium">Approval link created</p>
            <p className="mt-1 break-all font-mono text-xs">{approvalUrl}</p>
            <p className="mt-1 text-xs">
              This link opens one estimate version, expires, and stops working the moment the price
              changes. Send it to the customer.
            </p>
            <button
              className="mt-2 text-xs font-medium text-teal-700 underline"
              onClick={() => void navigator.clipboard.writeText(approvalUrl)}
            >
              Copy link
            </button>
          </Notice>
        </div>
      )}

      {building && (
        <EstimateBuilder
          repairOrder={job}
          onCancel={() => setBuilding(false)}
          onCreated={(url) => {
            setBuilding(false);
            if (url) setApprovalUrl(url);
            onRefresh();
          }}
        />
      )}

      <DataState
        empty={!building && (job.estimates?.length ?? 0) === 0}
        emptyMessage="No estimate yet. Build one, then send it for approval."
      >
        <div className="space-y-4">
          {job.estimates?.map((estimate) => (
            <EstimateCard
              key={estimate.id}
              estimate={estimate}
              vehicle={job.vehicle}
              onSent={(url) => {
                setApprovalUrl(url);
                onRefresh();
              }}
              onRevised={onRefresh}
            />
          ))}
        </div>
      </DataState>
    </Card>
  );
}

function EstimateCard({
  estimate,
  vehicle,
  onSent,
  onRevised,
}: {
  estimate: Estimate;
  vehicle: RepairOrder["vehicle"];
  onSent: (url: string) => void;
  onRevised: () => void;
}) {
  const { can } = useAuth();
  const [revising, setRevising] = useState(false);
  const latest: EstimateVersion | undefined = estimate.versions[0];

  const send = useMutation({
    mutationFn: (versionId: string) =>
      api.post<{ approvalUrl: string }>(`/estimates/versions/${versionId}/send`),
    onSuccess: (result) => onSent(result.approvalUrl),
  });

  const revise = useMutation({
    mutationFn: (lines: DraftLine[]) =>
      api.post(`/estimates/${estimate.id}/revise`, {
        lines: lines
          .filter((l) => l.description.trim() !== "")
          .map((l) => ({
            lineType: l.lineType,
            description: l.description,
            quantity: Number(l.quantity || 1),
            unitPrice: Math.round(Number(l.unitPrice || 0) * 100),
            unitCost: Math.round(Number(l.unitCost || 0) * 100),
            taxable: true,
          })),
      }),
    onSuccess: () => {
      setRevising(false);
      onRevised();
    },
  });

  if (!latest) return null;
  const approval = latest.approvals[0];
  const decided = latest.approvals.length > 0;

  return (
    <div className="rounded border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-mono text-sm font-semibold">{estimate.number}</span>
          <span className="ml-2 text-xs text-slate-500">version {latest.version}</span>
          <span className="ml-2">
            <StatusBadge status={latest.status} />
          </span>
        </div>
        <div className="flex gap-2">
          {latest.status === "DRAFT" && can("estimates.write") && (
            <Button
              variant="secondary"
              loading={send.isPending}
              onClick={() => send.mutate(latest.id)}
            >
              Send for approval
            </Button>
          )}
          {/* Extra work found: a revision is a NEW version and the old approval
              no longer authorises it (build guide / 04 step 5). */}
          {decided && can("estimates.write") && !revising && (
            <Button variant="secondary" onClick={() => setRevising(true)}>
              Revise for extra work
            </Button>
          )}
        </div>
      </div>

      <ErrorBanner error={send.error} />
      <ErrorBanner error={revise.error} />

      {revising ? (
        <ReviseForm
          existing={latest}
          vehicle={vehicle}
          pending={revise.isPending}
          onCancel={() => setRevising(false)}
          onSubmit={(lines) => revise.mutate(lines)}
        />
      ) : (
        <>
          <Table headers={["Line", "Qty", "Unit", "Total", ""]}>
            {latest.lines.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2">
                  <span className="text-slate-600">{l.description}</span>
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                    {l.lineType}
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{num(l.quantity)}</td>
                <td className="px-3 py-2 tabular-nums">{money(l.unitPrice)}</td>
                <td className="px-3 py-2 tabular-nums">{money(l.lineTotal)}</td>
                <td className="px-3 py-2 text-right text-xs">
                  {l.approved ? (
                    <span className="font-medium text-teal-700">approved</span>
                  ) : decided ? (
                    <span className="text-slate-400">not approved</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>

          <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{money(latest.total)}</span>
          </div>
        </>
      )}

      {approval && (
        <p className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">
          {approval.declined
            ? "Declined"
            : `${approval.partial ? "Partly approved" : "Approved"} for ${money(approval.approvedTotal)}`}{" "}
          by {approval.approverName} on {dateTime(approval.createdAt)}.
          {approval.partial &&
            " Only the approved lines may be performed and billed; added work needs a new authorization."}
        </p>
      )}

      {latest.status === "SENT" && (
        <p className="mt-2 text-xs text-slate-500">
          Sent {dateTime(latest.sentAt)}. Waiting on the customer. The link expires{" "}
          {dateTime(latest.approvalTokenExpiresAt)}.
        </p>
      )}
    </div>
  );
}

function ReviseForm({
  existing,
  vehicle,
  pending,
  onCancel,
  onSubmit,
}: {
  existing: EstimateVersion;
  vehicle: RepairOrder["vehicle"];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (lines: DraftLine[]) => void;
}) {
  // Start from the approved work so the advisor adds to it rather than
  // retyping what the customer already agreed to.
  const [lines, setLines] = useState<DraftLine[]>(
    existing.lines.map((l) => ({
      lineType: l.lineType,
      description: l.description,
      quantity: String(num(l.quantity)),
      unitPrice: (l.unitPrice / 100).toFixed(2),
      unitCost: (l.unitCost / 100).toFixed(2),
    })),
  );

  return (
    <div className="space-y-3 rounded border border-amber-200 bg-amber-50/50 p-3">
      <Notice tone="warn">
        Saving a revision supersedes version {existing.version} and invalidates its approval link.
        The customer must approve the new version before the added work is performed.
      </Notice>

      <LineEditor lines={lines} onChange={setLines} vehicle={vehicle} />

      <div className="flex gap-2">
        <Button loading={pending} onClick={() => onSubmit(lines)}>
          Save revision
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function EstimateBuilder({
  repairOrder,
  onCancel,
  onCreated,
}: {
  repairOrder: RepairOrder;
  onCancel: () => void;
  onCreated: (approvalUrl?: string) => void;
}) {
  const [lines, setLines] = useState<DraftLine[]>([
    { lineType: "LABOR", description: "", quantity: "1", unitPrice: "", unitCost: "" },
  ]);
  const [sendNow, setSendNow] = useState(true);

  const create = useMutation({
    mutationFn: async () => {
      const estimate = await api.post<Estimate & { versions: EstimateVersion[] }>("/estimates", {
        customerId: repairOrder.customer.id,
        vehicleId: repairOrder.vehicle.id,
        repairOrderId: repairOrder.id,
        lines: lines
          .filter((l) => l.description.trim() !== "")
          .map((l) => ({
            lineType: l.lineType,
            description: l.description,
            quantity: Number(l.quantity || 1),
            unitPrice: Math.round(Number(l.unitPrice || 0) * 100),
            unitCost: Math.round(Number(l.unitCost || 0) * 100),
            taxable: true,
          })),
      });

      if (!sendNow) return { approvalUrl: undefined };
      const versionId = estimate.versions[0]?.id;
      const sent = await api.post<{ approvalUrl: string }>(
        `/estimates/versions/${versionId}/send`,
      );
      return { approvalUrl: sent.approvalUrl };
    },
    onSuccess: (result) => onCreated(result.approvalUrl),
  });

  return (
    <div className="mb-4 rounded border border-teal-200 bg-teal-50/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink">New estimate</h3>
      <ErrorBanner error={create.error} />

      <LineEditor lines={lines} onChange={setLines} vehicle={repairOrder.vehicle} />

      <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
        Send to the customer for approval straight away
      </label>

      <p className="mt-2 text-xs text-slate-500">
        Totals and tax are calculated on the server from the shop's tax configuration. Sending
        freezes this version; any later price change creates a new version and invalidates the old
        approval.
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button loading={create.isPending} onClick={() => create.mutate()}>
          {sendNow ? "Create and send" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function InvoiceSection({ job, onRefresh }: { job: RepairOrder; onRefresh: () => void }) {
  const { can } = useAuth();

  const createInvoice = useMutation({
    mutationFn: () => api.post<Invoice>(`/invoices/from-repair-order/${job.id}`),
    onSuccess: onRefresh,
  });

  const issueInvoice = useMutation({
    mutationFn: (invoiceId: string) => api.post<Invoice>(`/invoices/${invoiceId}/issue`),
    onSuccess: onRefresh,
  });

  return (
    <Card
      title="Invoice"
      action={
        can("invoices.write") && (job.invoices?.length ?? 0) === 0 ? (
          <Button
            variant="secondary"
            loading={createInvoice.isPending}
            onClick={() => createInvoice.mutate()}
          >
            Create from approved work
          </Button>
        ) : undefined
      }
    >
      <ErrorBanner error={createInvoice.error} />
      <ErrorBanner error={issueInvoice.error} />

      <DataState
        empty={(job.invoices?.length ?? 0) === 0}
        emptyMessage="No invoice yet. Only work the customer approved can be billed."
      >
        <div className="space-y-4">
          {job.invoices?.map((inv) => (
            <div key={inv.id} className="rounded border border-slate-200 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-sm font-semibold">{inv.number}</span>
                  <span className="ml-2">
                    <StatusBadge status={inv.status} />
                  </span>
                </div>
                <div className="flex gap-2">
                  {inv.status === "DRAFT" && can("invoices.write") && (
                    <Button
                      loading={issueInvoice.isPending}
                      onClick={() => issueInvoice.mutate(inv.id)}
                    >
                      Issue invoice
                    </Button>
                  )}
                  {inv.status !== "DRAFT" && (
                    <Link to={`/receipts/${inv.id}`}>
                      <Button variant="secondary">View receipt</Button>
                    </Link>
                  )}
                  {(inv.status === "ISSUED" || inv.status === "PARTLY_PAID") &&
                    can("payments.collect") && (
                      <Link to={`/quick-sale/${inv.id}`}>
                        <Button>Collect payment</Button>
                      </Link>
                    )}
                </div>
              </div>

              <Table headers={["Line", "Qty", "Unit", "Total"]}>
                {inv.lines?.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-2">
                      <span className="text-slate-600">{l.description}</span>
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                        {l.lineType}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{num(l.quantity)}</td>
                    <td className="px-3 py-2 tabular-nums">{money(l.unitPrice)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(l.lineTotal)}</td>
                  </tr>
                ))}
              </Table>

              <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
                <Row label="Subtotal" value={money(inv.subtotal)} />
                {inv.discountTotal > 0 && (
                  <Row label="Discounts" value={`-${money(inv.discountTotal)}`} />
                )}
                <Row label="Sales tax" value={money(inv.taxTotal)} />
                <Row label="Total" value={money(inv.total)} strong />
                {inv.amountPaid > 0 && <Row label="Paid" value={`-${money(inv.amountPaid)}`} />}
                {inv.amountCredited > 0 && (
                  <Row label="Credited" value={`-${money(inv.amountCredited)}`} />
                )}
                <Row
                  label="Balance"
                  value={money(inv.total - inv.amountPaid - inv.amountCredited)}
                  strong
                />
              </dl>
            </div>
          ))}
        </div>
      </DataState>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-ink" : "text-slate-600"}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
