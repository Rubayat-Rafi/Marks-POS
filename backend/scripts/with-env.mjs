// Run a command with the repository-root .env loaded (then backend/.env on top).
//
// The Prisma CLI only looks for .env next to backend, but setup puts it at the
// repository root, so `prisma db push` and the seed could not find
// DATABASE_URL. This loads the same files, in the same order, as src/env.ts.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
// Load backend/.env
dotenv.config({ path: path.resolve(here, "../.env"), override: true });
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-env.mjs <command> [args...]");
  process.exit(2);
}
const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 1));
