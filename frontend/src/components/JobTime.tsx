import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { dateTime, num } from "../lib/format";
import { useAuth } from "../lib/auth";
import { Button, DataState, ErrorBanner, Field, Input, Select, Table } from "./ui";

type TimeEntry = {
  id: string;
  workedHours: string;
  startedAt: string;
  endedAt?: string | null;
  note?: string | null;
  technician: { firstName: string; lastName: string };
};

type Technician = { id: string; name: string; role: string };

/** Local datetime string for an <input type="datetime-local"> value. */
function localInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Worked time, which is tracked separately from billed labor hours. The two
 * differing is the point: that gap is the technician efficiency report
 * (build guide / 07).
 */
export function JobTime({ jobId, entries }: { jobId: string; entries: TimeEntry[] }) {
  const { can, user } = useAuth();
  const queryClient = useQueryClient();
  const [logging, setLogging] = useState(false);

  const now = new Date();
  const [form, setForm] = useState({
    technicianId: "",
    startedAt: localInputValue(new Date(now.getTime() - 60 * 60 * 1000)),
    endedAt: localInputValue(now),
    note: "",
  });

  const technicians = useQuery({
    queryKey: ["technicians"],
    queryFn: () => api.get<{ data: Technician[] }>("/settings/technicians"),
    // A technician logs against themselves; the server ignores any other id.
    enabled: user?.role !== "TECHNICIAN",
  });

  const log = useMutation({
    mutationFn: () =>
      api.post(`/repair-orders/${jobId}/time`, {
        technicianId: form.technicianId || undefined,
        startedAt: new Date(form.startedAt).toISOString(),
        endedAt: form.endedAt ? new Date(form.endedAt).toISOString() : undefined,
        note: form.note || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["job", jobId] });
      setLogging(false);
      setForm((f) => ({ ...f, note: "" }));
    },
  });

  const deleteTime = useMutation({
    mutationFn: (timeEntryId: string) => api.delete(`/repair-orders/time/${timeEntryId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["job", jobId] }),
  });

  const totalWorked = entries.reduce((sum, e) => sum + num(e.workedHours), 0);

  return (
    <div className="space-y-3">
      <ErrorBanner error={log.error} />
      <ErrorBanner error={deleteTime.error} />

      <DataState empty={entries.length === 0} emptyMessage="No time logged on this job yet.">
        <Table headers={["Technician", "Started", "Ended", "Worked hours", "Note", ""]}>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className="px-3 py-2">
                {e.technician.firstName} {e.technician.lastName}
              </td>
              <td className="px-3 py-2 text-slate-600">{dateTime(e.startedAt)}</td>
              <td className="px-3 py-2 text-slate-600">
                {e.endedAt ? dateTime(e.endedAt) : "still open"}
              </td>
              <td className="px-3 py-2 tabular-nums">{num(e.workedHours).toFixed(2)}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{e.note ?? "—"}</td>
              <td className="px-3 py-2 text-right">
                {can("jobs.write") && (
                  <Button
                    variant="danger"
                    size="sm"
                    loading={deleteTime.isPending}
                    onClick={() => deleteTime.mutate(e.id)}
                  >
                    Delete
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </DataState>

      {entries.length > 0 && (
        <p className="text-right text-sm text-slate-600">
          Total worked{" "}
          <span className="font-semibold tabular-nums text-ink">{totalWorked.toFixed(2)}</span>{" "}
          hours
        </p>
      )}

      {can("jobs.technician") &&
        (logging ? (
          <form
            className="space-y-3 rounded border border-slate-200 bg-slate-50 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              log.mutate();
            }}
          >
            {user?.role !== "TECHNICIAN" && (
              <Field label="Technician" hint="Leave blank to log against yourself.">
                <Select
                  value={form.technicianId}
                  onChange={(e) => setForm((f) => ({ ...f, technicianId: e.target.value }))}
                >
                  <option value="">Me</option>
                  {technicians.data?.data.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Started" required>
                <Input
                  type="datetime-local"
                  value={form.startedAt}
                  onChange={(e) => setForm((f) => ({ ...f, startedAt: e.target.value }))}
                  required
                />
              </Field>
              <Field label="Ended" hint="Leave blank if the clock is still running.">
                <Input
                  type="datetime-local"
                  value={form.endedAt}
                  onChange={(e) => setForm((f) => ({ ...f, endedAt: e.target.value }))}
                />
              </Field>
            </div>

            <Field label="Note">
              <Input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Diagnosis, road test, rework…"
              />
            </Field>

            <div className="flex gap-2">
              <Button type="submit" loading={log.isPending}>
                Log time
              </Button>
              <Button type="button" variant="secondary" onClick={() => setLogging(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setLogging(true)}>
            Log time
          </Button>
        ))}
    </div>
  );
}
