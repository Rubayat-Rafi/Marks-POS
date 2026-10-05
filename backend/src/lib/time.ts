/**
 * "Today" in the shop's own timezone.
 *
 * The server usually runs in UTC. Using its local midnight would roll the
 * dashboard's "today" over at 7pm in New Orleans, so the day boundary is
 * computed in the organization's timezone instead.
 */

/** Offset of `timeZone` from UTC at `at`, in milliseconds (Chicago in summer: -5h). */
function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instants where the current calendar day starts and ends in `timeZone`. */
export function dayBounds(timeZone: string, now = new Date()): { start: Date; end: Date } {
  const offset = tzOffsetMs(now, timeZone);
  const local = new Date(now.getTime() + offset);
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // Re-read the offset at midnight itself so a DST change during the day is
  // taken into account for the start boundary.
  const start = new Date(localMidnight - tzOffsetMs(new Date(localMidnight - offset), timeZone));
  const nextMidnight = localMidnight + 86_400_000;
  const end = new Date(nextMidnight - tzOffsetMs(new Date(nextMidnight - offset), timeZone));
  return { start, end };
}
