import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api, ApiClientError } from "../lib/api";
import { dateTime, money, num } from "../lib/format";
import { Button, Field, Input, Notice } from "../components/ui";

type ApprovalView = {
  estimateNumber: string;
  versionNumber: number;
  status: string;
  alreadyDecided: boolean;
  shop: { name: string; location: string; phone: string | null };
  customerName: string;
  vehicle: { year: number | null; make: string | null; model: string | null; plate: string | null };
  currency: string;
  lines: Array<{
    id: string;
    lineType: string;
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  notes: string | null;
  expiresAt: string | null;
};

/**
 * The customer's view of an estimate.
 *
 * No login, no session: the token in the URL scopes this page to exactly one
 * estimate version and nothing else. Cost, margin and internal notes are never
 * sent here (build guide / 03).
 */
export function ApprovalPage() {
  const { token } = useParams<{ token: string }>();
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [name, setName] = useState("");
  const [done, setDone] = useState<{ decision: string; partial: boolean; total: number } | null>(
    null,
  );

  const estimate = useQuery({
    queryKey: ["approval", token],
    queryFn: () => api.get<ApprovalView>(`/approvals/${token}`, { anonymous: true }),
    enabled: Boolean(token),
    retry: false,
  });

  const decide = useMutation({
    mutationFn: (decision: "approve" | "decline") =>
      api.post<{ decision: string; partial: boolean; approvedTotal: number }>(
        `/approvals/${token}`,
        {
          decision,
          approverName: name,
          approvedLineIds:
            decision === "approve" && selected ? [...selected] : undefined,
        },
        { anonymous: true },
      ),
    onSuccess: (result) =>
      setDone({ decision: result.decision, partial: result.partial, total: result.approvedTotal }),
  });

  if (estimate.isLoading) {
    return (
      <Centered>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-teal-600" />
      </Centered>
    );
  }

  if (estimate.error) {
    const err = estimate.error as ApiClientError;
    return (
      <Centered>
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-lg font-semibold text-ink">This link cannot be opened</h1>
          <p className="mt-2 text-sm text-slate-600">{err.message}</p>
          <p className="mt-4 text-xs text-slate-500">
            Please contact the shop and ask them to send a current link.
          </p>
        </div>
      </Centered>
    );
  }

  const data = estimate.data!;
  const lineIds = data.lines.map((l) => l.id);
  const chosen = selected ?? new Set(lineIds);
  const partial = chosen.size < lineIds.length;

  const selectedTotal = data.lines
    .filter((l) => chosen.has(l.id))
    .reduce((sum, l) => sum + l.lineTotal, 0);

  if (done) {
    return (
      <Centered>
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-2xl">
            {done.decision === "approve" ? "✓" : "✕"}
          </div>
          <h1 className="text-lg font-semibold text-ink">
            {done.decision === "approve"
              ? done.partial
                ? "Partial approval recorded"
                : "Approval recorded"
              : "Declined"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            {done.decision === "approve"
              ? `${data.shop.name} has been notified and will proceed with ${money(done.total)} of work.`
              : `${data.shop.name} has been notified that you declined this estimate.`}
          </p>
          {done.partial && (
            <p className="mt-3 rounded bg-slate-50 p-3 text-xs text-slate-600">
              Only the items you selected are authorised. If the shop finds more work, they will
              send you a new estimate to approve before doing it.
            </p>
          )}
          {data.shop.phone && (
            <p className="mt-4 text-xs text-slate-500">Questions? Call {data.shop.phone}</p>
          )}
        </div>
      </Centered>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="rounded-lg border border-slate-200 bg-white p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-teal-700">
            Repair estimate
          </p>
          <h1 className="mt-1 text-xl font-semibold text-ink">{data.shop.name}</h1>
          <p className="text-sm text-slate-500">{data.shop.location}</p>

          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <Pair label="Estimate" value={`${data.estimateNumber} (v${data.versionNumber})`} />
            <Pair label="Prepared for" value={data.customerName} />
            <Pair
              label="Vehicle"
              value={
                [data.vehicle.year, data.vehicle.make, data.vehicle.model]
                  .filter(Boolean)
                  .join(" ") || "—"
              }
            />
            <Pair label="Plate" value={data.vehicle.plate ?? "—"} />
          </dl>
        </header>

        {data.alreadyDecided && (
          <Notice tone="warn">
            A decision has already been recorded for this estimate. Contact the shop if something
            has changed.
          </Notice>
        )}

        <section className="rounded-lg border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-6 py-3">
            <h2 className="text-sm font-semibold text-ink">Recommended work</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Untick anything you do not want done. Only what you approve will be performed.
            </p>
          </header>

          <ul className="divide-y divide-slate-100">
            {data.lines.map((line) => (
              <li key={line.id} className="flex items-start gap-3 px-6 py-3">
                <input
                  type="checkbox"
                  id={line.id}
                  checked={chosen.has(line.id)}
                  disabled={data.alreadyDecided}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(line.id);
                    else next.delete(line.id);
                    setSelected(next);
                  }}
                  className="mt-1 h-4 w-4"
                />
                <label htmlFor={line.id} className="flex-1 cursor-pointer">
                  <span className="block text-sm font-medium text-ink">{line.description}</span>
                  <span className="text-xs text-slate-500">
                    {num(line.quantity)} ×{" "}
                    {money(line.unitPrice, data.currency)}
                    {line.lineType === "LABOR" ? " per hour" : ""}
                  </span>
                </label>
                <span className="tabular-nums text-sm font-medium">
                  {money(line.lineTotal, data.currency)}
                </span>
              </li>
            ))}
          </ul>

          <div className="space-y-1 border-t border-slate-200 px-6 py-4 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Selected items</span>
              <span className="tabular-nums">{money(selectedTotal, data.currency)}</span>
            </div>
            {!partial && (
              <>
                <div className="flex justify-between text-slate-600">
                  <span>Sales tax</span>
                  <span className="tabular-nums">{money(data.taxTotal, data.currency)}</span>
                </div>
                <div className="flex justify-between text-base font-semibold text-ink">
                  <span>Estimate total</span>
                  <span className="tabular-nums">{money(data.total, data.currency)}</span>
                </div>
              </>
            )}
            {partial && (
              <p className="pt-1 text-xs text-slate-500">
                Your final total including tax will be confirmed by the shop once they see which
                items you approved.
              </p>
            )}
          </div>
        </section>

        {data.notes && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
            <p className="mb-1 font-medium text-ink">Notes from the shop</p>
            {data.notes}
          </div>
        )}

        {!data.alreadyDecided && (
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            {decide.error && (
              <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                {(decide.error as Error).message}
              </div>
            )}

            <Field label="Your name" required hint="This is recorded as your authorization.">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={data.customerName}
              />
            </Field>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1"
                disabled={!name.trim() || chosen.size === 0}
                loading={decide.isPending}
                onClick={() => decide.mutate("approve")}
              >
                {partial
                  ? `Approve ${chosen.size} of ${lineIds.length} items`
                  : "Approve this estimate"}
              </Button>
              <Button
                variant="secondary"
                disabled={!name.trim()}
                loading={decide.isPending}
                onClick={() => decide.mutate("decline")}
              >
                Decline
              </Button>
            </div>

            {data.expiresAt && (
              <p className="mt-3 text-center text-xs text-slate-500">
                This link expires {dateTime(data.expiresAt)}.
              </p>
            )}
          </section>
        )}

        <p className="px-2 text-center text-xs text-slate-400">
          Prices are an estimate for the work listed. If the shop finds additional work, they will
          send you a new estimate to approve before doing it.
        </p>
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">{children}</div>
  );
}
