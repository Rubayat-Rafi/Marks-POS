import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

/**
 * Prisma database client.
 */
export const prisma = new PrismaClient({
  log: env.isProduction ? ["warn", "error"] : ["warn", "error"],
});

export const db = prisma;

export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export default prisma;
