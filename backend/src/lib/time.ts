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

/**
 * Given a calendar date string "YYYY-MM-DD" and a timeZone, returns the UTC
 * instants for the start of that day (00:00:00) and the end of that day (start of next day 24:00:00).
 */
export function parseDateBounds(dateStr: string, timeZone: string): { start: Date; end: Date } {
  const parts = dateStr.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  const localMidnight = Date.UTC(y, m - 1, d);
  const approxOffset = tzOffsetMs(new Date(localMidnight), timeZone);
  const start = new Date(localMidnight - tzOffsetMs(new Date(localMidnight - approxOffset), timeZone));
  const nextMidnight = localMidnight + 86_400_000;
  const end = new Date(nextMidnight - tzOffsetMs(new Date(nextMidnight - approxOffset), timeZone));
  return { start, end };
}

/**
 * Returns UTC range boundaries respecting `timeZone`.
 * Supports both signatures:
 *   rangeBounds(timeZone, fromQuery, toQuery)
 *   rangeBounds(query, timeZone)
 * When `to` is a "YYYY-MM-DD" date string, `to` expands to the end of that day (start of next day in timeZone),
 * ensuring the full final day is included in queries using `{ gte: from, lt: to }`.
 */
export function rangeBounds(
  timeZoneOrQuery: string | Record<string, unknown>,
  arg2?: unknown,
  arg3?: unknown,
): { from: Date; to: Date } {
  let timeZone: string;
  let fromQuery: unknown;
  let toQuery: unknown;

  if (typeof timeZoneOrQuery === "string") {
    timeZone = timeZoneOrQuery;
    fromQuery = arg2;
    toQuery = arg3;
  } else {
    timeZone = typeof arg2 === "string" ? arg2 : "America/Chicago";
    fromQuery = (timeZoneOrQuery as Record<string, unknown>)?.from;
    toQuery = (timeZoneOrQuery as Record<string, unknown>)?.to;
    const preset = typeof (timeZoneOrQuery as Record<string, unknown>)?.preset === "string"
      ? ((timeZoneOrQuery as Record<string, unknown>).preset as string).toLowerCase()
      : null;
    if (preset) {
      const now = new Date();
      if (preset === "today") {
        const { start, end } = dayBounds(timeZone, now);
        return { from: start, to: end };
      }
      if (preset === "yesterday") {
        const yest = new Date(now.getTime() - 86_400_000);
        const { start, end } = dayBounds(timeZone, yest);
        return { from: start, to: end };
      }
      if (preset === "last7" || preset === "last7days") {
        const { start, end } = dayBounds(timeZone, now);
        return { from: new Date(start.getTime() - 6 * 86_400_000), to: end };
      }
      if (preset === "last30" || preset === "last30days") {
        const { start, end } = dayBounds(timeZone, now);
        return { from: new Date(start.getTime() - 29 * 86_400_000), to: end };
      }
    }
  }

  let toDate: Date;
  let fromDate: Date;

  if (typeof toQuery === "string" && /^\d{4}-\d{2}-\d{2}$/.test(toQuery)) {
    toDate = parseDateBounds(toQuery, timeZone).end;
  } else if (toQuery) {
    toDate = new Date(String(toQuery));
    if (Number.isNaN(toDate.getTime())) toDate = dayBounds(timeZone).end;
  } else {
    toDate = dayBounds(timeZone).end;
  }

  if (typeof fromQuery === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fromQuery)) {
    fromDate = parseDateBounds(fromQuery, timeZone).start;
  } else if (fromQuery) {
    fromDate = new Date(String(fromQuery));
    if (Number.isNaN(fromDate.getTime())) fromDate = new Date(toDate.getTime() - 30 * 86_400_000);
  } else {
    fromDate = new Date(toDate.getTime() - 30 * 86_400_000);
  }

  return { from: fromDate, to: toDate };
}

