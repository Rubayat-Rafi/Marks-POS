import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { dateTime, money, titleCase } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/Layout";
import { ClockWidget } from "../components/ClockWidget";
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
import type { ShiftClockEntry } from "../lib/types";

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function hoursBetween(start: string, end: string | null): number {
  const endMs = end ? new Date(end).getTime() : Date.now();
  return Math.max(0, (endMs - new Date(start).getTime()) / 3_600_000);
}

/**
 * Time clock: punch in/out and review hours.
 *
 * Every signed-in staff member gets their own clock and their own history.
 * With `payroll.read`, a second section shows everyone's hours and an
 * estimated payroll cost for the period; that visibility is deliberately
 * narrower than "staff.manage" (build guide / 03: higher-risk data needs
 * higher authority, and pay is more sensitive than a schedule).
 */
export function TimeClockPage() {
  const { can } = useAuth();

  return (
    <>
      <PageHeader
        title="Time clock"
        description="Clock in when your shift starts, clock out when it ends. Hours here are separate from time logged against a specific job."
      />

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <ClockWidget />
        <MyHistory />
      </div>

      {can("payroll.read") && (
        <div className="mt-6">
          <PayrollSection />
        </div>
      )}
    </>
  );
}

function MyHistory() {
  const [from, setFrom] = useState(isoDay(-13));
  const [to, setTo] = useState(isoDay(0));

  const history = useQuery({
    queryKey: ["timeclock-me", from, to],
    queryFn: () =>
      api.get<{ data: ShiftClockEntry[]; totalHours: number }>(
        `/time-clock/me?from=${new Date(from).toISOString()}&to=${new Date(`${to}T23:59:59`).toISOString()}`,
      ),
  });

  return (
    <Card title="My hours">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        {history.data && (
          <p className="pb-2 text-sm text-slate-500">
            Total: <span className="font-semibold text-ink">{history.data.totalHours.toFixed(2)}</span>{" "}
            hours
          </p>
        )}
      </div>

      <DataState
        loading={history.isLoading}
        error={history.error}
        empty={history.data?.data.length === 0}
        emptyMessage="No punches in this range."
      >
        <Table headers={["Clocked in", "Clocked out", "Hours", "Note"]}>
          {history.data?.data.map((e) => (
            <tr key={e.id}>
              <td className="px-3 py-2 text-slate-600">{dateTime(e.clockInAt)}</td>
              <td className="px-3 py-2 text-slate-600">
                {e.clockOutAt ? dateTime(e.clockOutAt) : <span className="text-teal-700">still open</span>}
              </td>
              <td className="px-3 py-2 tabular-nums">
                {hoursBetween(e.clockInAt, e.clockOutAt).toFixed(2)}
              </td>
              <td className="px-3 py-2 text-xs text-slate-500">{e.note ?? "—"}</td>
            </tr>
          ))}
        </Table>
      </DataState>
    </Card>
  );
}

type PayrollRow = {
  membershipId: string;
  userId: string;
  name: string;
  role: string;
  employmentType: string | null;
  payType: "HOURLY" | "SALARY" | null;
  payRateCents: number | null;
  hours: number;
  estimatedPay: number;
};

function PayrollSection() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(isoDay(-13));
  const [to, setTo] = useState(isoDay(0));
  const [correcting, setCorrecting] = useState<ShiftClockEntry | null>(null);

  const summary = useQuery({
    queryKey: ["payroll-summary", from, to],
    queryFn: () =>
      api.get<{ rows: PayrollRow[]; totalEstimatedPay: number; note: string }>(
        `/time-clock/payroll-summary?from=${new Date(from).toISOString()}&to=${new Date(`${to}T23:59:59`).toISOString()}`,
      ),
  });

  const allEntries = useQuery({
    queryKey: ["timeclock-all", from, to],
    queryFn: () =>
      api.get<{ data: ShiftClockEntry[] }>(
        `/time-clock?from=${new Date(from).toISOString()}&to=${new Date(`${to}T23:59:59`).toISOString()}`,
      ),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <Card title="Payroll estimate">
        <DataState
          loading={summary.isLoading}
          error={summary.error}
          empty={summary.data?.rows.length === 0}
          emptyMessage="No hourly or salaried staff configured yet."
        >
          <div className="mb-3">
            <Notice>{summary.data?.note}</Notice>
          </div>
          <Table headers={["Name", "Role", "Type", "Rate", "Hours", "Estimated pay"]}>
            {summary.data?.rows.map((r) => (
              <tr key={r.membershipId}>
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{titleCase(r.role)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {r.employmentType ? titleCase(r.employmentType) : "—"}
                  {r.payType ? ` · ${titleCase(r.payType)}` : ""}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-600">
                  {r.payRateCents === null
                    ? "—"
                    : r.payType === "HOURLY"
                      ? `${money(r.payRateCents)}/hr`
                      : money(r.payRateCents)}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.hours.toFixed(2)}</td>
                <td className="px-3 py-2 tabular-nums font-medium">{money(r.estimatedPay)}</td>
              </tr>
            ))}
          </Table>
          {summary.data && (
            <div className="mt-3 flex justify-end border-t border-slate-200 pt-3 text-sm font-semibold">
              Total: {money(summary.data.totalEstimatedPay)}
            </div>
          )}
        </DataState>
      </Card>

      <Card title="All punches">
        <DataState
          loading={allEntries.isLoading}
          error={allEntries.error}
          empty={allEntries.data?.data.length === 0}
          emptyMessage="No punches in this range."
        >
          <Table headers={["Staff", "Clocked in", "Clocked out", "Hours", "Note", ""]}>
            {allEntries.data?.data.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2">
                  {e.user?.firstName} {e.user?.lastName}
                </td>
                <td className="px-3 py-2 text-slate-600">{dateTime(e.clockInAt)}</td>
                <td className="px-3 py-2 text-slate-600">
                  {e.clockOutAt ? dateTime(e.clockOutAt) : <span className="text-teal-700">still open</span>}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {hoursBetween(e.clockInAt, e.clockOutAt).toFixed(2)}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{e.note ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  {can("payroll.write") && (
                    <Button variant="secondary" onClick={() => setCorrecting(e)}>
                      Correct
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </DataState>
      </Card>

      {correcting && (
        <CorrectPunchModal
          entry={correcting}
          onClose={() => setCorrecting(null)}
          onDone={() => {
            setCorrecting(null);
            void queryClient.invalidateQueries({ queryKey: ["timeclock-all"] });
            void queryClient.invalidateQueries({ queryKey: ["payroll-summary"] });
          }}
        />
      )}
    </div>
  );
}

function toLocalInput(value: string): string {
  const d = new Date(value);
  const offset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

function CorrectPunchModal({
  entry,
  onClose,
  onDone,
}: {
  entry: ShiftClockEntry;
  onClose: () => void;
  onDone: () => void;
}) {
  const [clockInAt, setClockInAt] = useState(toLocalInput(entry.clockInAt));
  const [clockOutAt, setClockOutAt] = useState(entry.clockOutAt ? toLocalInput(entry.clockOutAt) : "");
  const [reason, setReason] = useState("");

  const correct = useMutation({
    mutationFn: () =>
      api.patch(`/time-clock/${entry.id}`, {
        clockInAt: new Date(clockInAt).toISOString(),
        clockOutAt: clockOutAt ? new Date(clockOutAt).toISOString() : null,
        reason,
      }),
    onSuccess: onDone,
  });

  return (
    <Modal title="Correct a punch" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          correct.mutate();
        }}
      >
        <ErrorBanner error={correct.error} />
        <Notice tone="warn">
          Corrections are recorded in the audit trail with your name, the reason and the values
          before and after.
        </Notice>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Clocked in">
            <Input
              type="datetime-local"
              value={clockInAt}
              onChange={(e) => setClockInAt(e.target.value)}
              required
            />
          </Field>
          <Field label="Clocked out" hint="Leave blank to reopen this punch.">
            <Input
              type="datetime-local"
              value={clockOutAt}
              onChange={(e) => setClockOutAt(e.target.value)}
            />
          </Field>
        </div>

        <Field label="Reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={correct.isPending}>
            Save correction
          </Button>
        </div>
      </form>
    </Modal>
  );
}
