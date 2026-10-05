/**
 * Display helpers. These format values for reading; they never feed a number
 * back into a calculation, and they never invent precision that is not there.
 */

export function money(cents: number | null | undefined, currency = "USD"): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/** Parse a user-typed "129.95" into 12995 cents. Returns null when unusable. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function percent(value: number | null | undefined, digits = 1): string {
  // N/A rather than 0%, so a zero-sales job is not read as a zero-margin job.
  if (value === null || value === undefined) return "N/A";
  return `${value.toFixed(digits)}%`;
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function dateOnly(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function timeOnly(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function vehicleLabel(v?: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  plate?: string | null;
}): string {
  if (!v) return "—";
  const name = [v.year, v.make, v.model].filter(Boolean).join(" ");
  return v.plate ? `${name} (${v.plate})` : name || "Unidentified vehicle";
}

export function customerLabel(c?: {
  firstName?: string;
  lastName?: string;
  companyName?: string | null;
}): string {
  if (!c) return "—";
  const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
  return c.companyName ? `${c.companyName} (${name})` : name;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}
