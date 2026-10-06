import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { adminOrigin } from "./admin-client.mjs";

try {
  const [file = "local/admin.env", ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Usage: pnpm admin:secret:create [new-env-file]");
  const origin = adminOrigin(process.env.STATUS_ADMIN_URL).origin;
  const project = process.env.STATUS_PAGES_PROJECT;
  if (!project || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(project)) throw new Error("Set STATUS_PAGES_PROJECT to your own Pages project name");
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `STATUS_ADMIN_URL=${origin}\nSTATUS_PAGES_PROJECT=${project}\nSTATUS_ADMIN_TOKEN=${randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
  console.log(`Admin secret saved to ${path}. Configure this value as the Pages STATUS_ADMIN_TOKEN secret before deployment.`);
} catch (error) {
  console.error(error?.code ? "Cannot create admin secret; choose a new writable file. Existing files are never overwritten." : error.message);
  process.exitCode = 1;
}
