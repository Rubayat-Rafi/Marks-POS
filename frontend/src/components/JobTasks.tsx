import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, DataState, ErrorBanner, Field, Input, Select, Table } from "./ui";

type Task = {
  id: string;
  description: string;
  status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE";
  assignedToId: string | null;
  estimatedHours: string;
};

type Technician = { id: string; name: string; role: string };

const STATUSES: Task["status"][] = ["PENDING", "IN_PROGRESS", "BLOCKED", "DONE"];

/**
 * Task assignment and progress.
 *
 * A technician may only move work assigned to them; the server enforces that,
 * so this component can stay simple (build guide / 03).
 */
export function JobTasks({ jobId, tasks }: { jobId: string; tasks: Task[] }) {
  const { can, user } = useAuth();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [description, setDescription] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("1");

  const technicians = useQuery({
    queryKey: ["technicians"],
    queryFn: () => api.get<{ data: Technician[] }>("/settings/technicians"),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["job", jobId] });

  const create = useMutation({
    mutationFn: () =>
      api.post(`/repair-orders/${jobId}/tasks`, {
        description,
        assignedToId: assignedToId || null,
        estimatedHours: Number(estimatedHours || 0),
      }),
    onSuccess: () => {
      refresh();
      setAdding(false);
      setDescription("");
      setEstimatedHours("1");
    },
  });

  const update = useMutation({
    mutationFn: (vars: { id: string; patch: Partial<Task> }) =>
      api.patch(`/repair-orders/tasks/${vars.id}`, vars.patch),
    onSuccess: refresh,
  });

  const removeTask = useMutation({
    mutationFn: (taskId: string) => api.delete(`/repair-orders/tasks/${taskId}`),
    onSuccess: refresh,
  });

  const nameFor = (id: string | null) =>
    id ? (technicians.data?.data.find((t) => t.id === id)?.name ?? "Assigned") : "Unassigned";

  return (
    <div className="space-y-3">
      <ErrorBanner error={create.error} />
      <ErrorBanner error={update.error} />
      <ErrorBanner error={removeTask.error} />

      <DataState empty={tasks.length === 0} emptyMessage="No tasks on this job yet.">
        <Table headers={["Task", "Assigned to", "Est. hours", "Status", ""]}>
          {tasks.map((task) => {
            // Mirrors the server rule so the control is not a dead end.
            const locked =
              user?.role === "TECHNICIAN" &&
              task.assignedToId !== null &&
              task.assignedToId !== user.id;

            return (
              <tr key={task.id}>
                <td className="px-3 py-2">{task.description}</td>
                <td className="px-3 py-2 text-slate-600">
                  {can("jobs.write") ? (
                    <Select
                      value={task.assignedToId ?? ""}
                      onChange={(e) =>
                        update.mutate({
                          id: task.id,
                          patch: { assignedToId: e.target.value || null },
                        })
                      }
                      className="text-xs"
                    >
                      <option value="">Unassigned</option>
                      {technicians.data?.data.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    nameFor(task.assignedToId)
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-600">
                  {Number(task.estimatedHours).toFixed(1)}
                </td>
                <td className="px-3 py-2">
                  <Select
                    value={task.status}
                    disabled={locked || update.isPending}
                    onChange={(e) =>
                      update.mutate({
                        id: task.id,
                        patch: { status: e.target.value as Task["status"] },
                      })
                    }
                    className="text-xs"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.toLowerCase().replace("_", " ")}
                      </option>
                    ))}
                  </Select>
                  {locked && (
                    <p className="mt-1 text-[11px] text-slate-400">Assigned to someone else</p>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {can("jobs.write") && (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={removeTask.isPending}
                      onClick={() => removeTask.mutate(task.id)}
                    >
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </DataState>

      {can("jobs.write") &&
        (adding ? (
          <form
            className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="sm:col-span-2">
              <Field label="Task">
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Replace front pads and rotors"
                  required
                  autoFocus
                />
              </Field>
            </div>
            <Field label="Assign to">
              <Select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                <option value="">Unassigned</option>
                {technicians.data?.data.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Est. hours">
              <Input
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <div className="flex gap-2 sm:col-span-4">
              <Button type="submit" loading={create.isPending}>
                Add task
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            Add task
          </Button>
        ))}
    </div>
  );
}
