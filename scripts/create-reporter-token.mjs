import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { adminRequest } from "./admin-client.mjs";

let directory;
let created = false;
try {
  const args = parseArgs({ allowPositionals: true, options: {
    "output-dir": { type: "string" }, name: { type: "string" }, rotate: { type: "boolean", default: false },
  } });
  const [reporterId, ...components] = args.positionals;
  const slugPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
  if (!reporterId || !slugPattern.test(reporterId) || !args.values["output-dir"]
    || (args.values.rotate && (components.length !== 0 || args.values.name !== undefined))
    || (args.values.name !== undefined && (args.values.name.trim().length === 0 || args.values.name.length > 120))
    || !components.every((slug) => slugPattern.test(slug)) || new Set(components).size !== components.length) {
    throw new Error("Usage: pnpm token:create <device-id> [component-slug ...] [--name <display-name>] --output-dir <new-directory> OR pnpm token:rotate <reporter-id> --output-dir <new-directory>");
  }
  directory = resolve(args.values["output-dir"]);
  mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
  mkdirSync(directory, { mode: 0o700 });
  created = true;
  const path = args.values.rotate ? `/api/v1/admin/reporters/${reporterId}/token` : "/api/v1/admin/reporters";
  const result = await adminRequest(path, "POST", args.values.rotate ? undefined : {
    id: reporterId,
    ...(args.values.name === undefined ? {} : { name: args.values.name }),
    ...(components.length === 0 ? {} : { components }),
  });
  if (result.reporterId !== reporterId || typeof result.token !== "string"
    || !new RegExp(`^${reporterId}\\.[A-Za-z0-9_-]{43}$`).test(result.token)) {
    throw new Error("Unexpected token response; check the server and rotate the reporter token before use");
  }
  writeFileSync(resolve(directory, "token.env"), `STATUS_REPORTER_TOKEN=${result.token}\n`, { mode: 0o600, flag: "wx" });
  console.log(`Registered ${reporterId}; token saved to ${directory}/token.env. Token plaintext is never printed.`);
} catch (error) {
  if (created) rmSync(directory, { recursive: true, force: true });
  console.error(error instanceof Error ? error.message : "Cannot create protected token files; use a new writable directory");
  process.exitCode = 1;
}
