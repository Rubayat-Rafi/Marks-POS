import { ApiError } from "./errors.js";

/**
 * Query-string readers. A malformed filter is the caller's mistake, so it is
 * answered with a 400 naming the parameter, never passed to the database to
 * come back as a 500.
 */

export function queryEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T | undefined {
  if (value === undefined || value === "") return undefined;
  const text = String(value);
  if (!(allowed as readonly string[]).includes(text)) {
    throw ApiError.badRequest(`"${name}" must be one of: ${allowed.join(", ")}.`, {
      [name]: "Not a recognised value.",
    });
  }
  return text as T;
}

export function queryDate(value: unknown, name: string): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest(`"${name}" is not a valid date.`, { [name]: "Use YYYY-MM-DD." });
  }
  return date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function queryUuid(value: unknown, name: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  const text = String(value);
  if (!UUID.test(text)) throw ApiError.badRequest(`"${name}" is not a valid id.`);
  return text;
}
