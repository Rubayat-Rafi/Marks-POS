// Generate plain MySQL DDL from the Prisma schema, for hosts where you can
// reach phpMyAdmin but not a shell.
//
// The output is derived from the schema by `prisma migrate diff`, never edited
// by hand, so it cannot drift from what `prisma migrate deploy` would apply.
// Regenerate it in the same commit as any schema change:
//
//     npm run prisma:sql --prefix backend
//
// `prisma migrate deploy` remains the supported path when you have SSH.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, "..");
dotenv.config({ path: path.resolve(backend, ".env"), override: true });

const outDir = path.join(backend, "prisma", "generated");
fs.mkdirSync(outDir, { recursive: true });

const target = path.join(outDir, "schema_mysql.sql");

// The schema path stays relative to cwd. Windows needs shell: true to resolve
// npx.cmd, and a shell mangles an absolute path that contains spaces - which
// every "OneDrive - Organisation" checkout has.
const result = spawnSync(
  "npx",
  [
    "prisma",
    "migrate",
    "diff",
    "--from-empty",
    "--to-schema-datamodel",
    "prisma/schema.prisma",
    "--script",
  ],
  { cwd: backend, encoding: "utf8", shell: process.platform === "win32" },
);

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

const header = [
  "-- Auto Shop Web App - MySQL schema",
  "--",
  "-- GENERATED FILE. Do not edit.",
  "-- Regenerate with: npm run prisma:sql --prefix backend",
  "--",
  "-- Import through phpMyAdmin into an empty database when the host gives you",
  "-- no shell. With shell access, prefer: npm run db:deploy",
  "",
  "SET NAMES utf8mb4;",
  "SET FOREIGN_KEY_CHECKS = 0;",
  "",
].join("\n");

const footer = "\n\nSET FOREIGN_KEY_CHECKS = 1;\n";

fs.writeFileSync(target, header + result.stdout.trim() + footer);
console.log(`wrote ${path.relative(backend, target)} (${result.stdout.length} bytes of DDL)`);
