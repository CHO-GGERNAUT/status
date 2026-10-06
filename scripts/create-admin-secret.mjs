import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

try {
  const [file = "local/admin.env", ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("Usage: pnpm admin:secret:create [new-env-file]");
  const path = resolve(file);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `STATUS_ADMIN_URL=https://status.ggernaut.com\nSTATUS_ADMIN_TOKEN=${randomBytes(32).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
  console.log(`Admin secret saved to ${path}. Configure this value as the Pages STATUS_ADMIN_TOKEN secret before deployment.`);
} catch {
  console.error("Cannot create admin secret; choose a new writable file. Existing files are never overwritten.");
  process.exitCode = 1;
}
