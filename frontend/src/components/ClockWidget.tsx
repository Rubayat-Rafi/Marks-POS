import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { Button, Card, ErrorBanner, Field, Input } from "./ui";

type ClockStatus = {
  clockedIn: boolean;
  entry: { id: string; clockInAt: string; note: string | null } | null;
  openHours: number;
};

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

/**
 * Shift clock in/out.
 *
 * Separate from the per-job time tracking on a repair order: this is "am I on
 * the clock at all" for whoever is punching, regardless of which job (or no
 * job) they are working on right now.
 */
export function ClockWidget({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  // Re-render the running total once a minute without refetching.
  const [, forceTick] = useState(0);

  const status = useQuery({
    queryKey: ["timeclock-status"],
    queryFn: () => api.get<ClockStatus>("/time-clock/status"),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["timeclock-status"] });
    void queryClient.invalidateQueries({ queryKey: ["timeclock-me"] });
  };

  const clockIn = useMutation({
    mutationFn: () => api.post("/time-clock/in", { note: note || undefined }),
    onSuccess: () => {
      setNote("");
      refresh();
    },
  });

  const clockOut = useMutation({
    mutationFn: () => api.post("/time-clock/out", { note: note || undefined }),
    onSuccess: () => {
      setNote("");
      refresh();
    },
  });

  const data = status.data;
  const liveHours =
    data?.clockedIn && data.entry
      ? (Date.now() - new Date(data.entry.clockInAt).getTime()) / 3_600_000
      : 0;

  const body = (
    <div className="space-y-3">
      <ErrorBanner error={clockIn.error || clockOut.error} />

      <div className="flex items-center gap-3">
        <span
          className={`h-2.5 w-2.5 rounded-full ${data?.clockedIn ? "bg-teal-500" : "bg-slate-300"}`}
          aria-hidden
        />
        <div>
          <p className="text-sm font-medium text-ink">
            {data?.clockedIn ? "On the clock" : "Not clocked in"}
          </p>
          {data?.clockedIn && data.entry && (
            <p className="text-xs text-slate-500">
              Since {dateTime(data.entry.clockInAt)} &middot; {formatDuration(liveHours)}
            </p>
          )}
        </div>
      </div>

      {!compact && (
        <Field label="Note" hint="Optional. What you're doing, or why a punch looks unusual.">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      )}

      {data?.clockedIn ? (
        <Button
          variant="danger"
          className="w-full"
          loading={clockOut.isPending}
          onClick={() => clockOut.mutate()}
        >
          Clock out
        </Button>
      ) : (
        <Button className="w-full" loading={clockIn.isPending} onClick={() => clockIn.mutate()}>
          Clock in
        </Button>
      )}
    </div>
  );

  if (compact) return body;
  return <Card title="Time clock">{body}</Card>;
}
