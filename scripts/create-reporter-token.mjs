import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

let args;
try {
  args = parseArgs({ allowPositionals: true, options: { "output-dir": { type: "string" } } });
} catch {
  console.error("Usage: pnpm token:create <reporter-id> <component-slug> [...] [--output-dir <new-directory>]");
  process.exit(1);
}
const [reporterId, ...componentSlugs] = args.positionals;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

if (reporterId === undefined || !slugPattern.test(reporterId) || componentSlugs.length === 0) {
  console.error(
    "Usage: pnpm token:create <reporter-id> <component-slug> [...] [--output-dir <new-directory>]",
  );
  process.exit(1);
}

if (!componentSlugs.every((slug) => slugPattern.test(slug)) || new Set(componentSlugs).size !== componentSlugs.length) {
  console.error("Reporter and component identifiers must use lowercase letters, numbers, and hyphens.");
  process.exit(1);
}

const token = `${reporterId}.${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const componentList = componentSlugs.map((slug) => `'${slug}'`).join(", ");
const sql = [
  `INSERT INTO reporters (id, display_name, token_hash, created_at) VALUES ('${reporterId}', '${reporterId}', '${tokenHash}', unixepoch());`,
  `INSERT INTO reporter_components (reporter_id, component_id) SELECT '${reporterId}', id FROM components WHERE enabled = 1 AND slug IN (${componentList});`,
].join("\n") + "\n";

if (args.values["output-dir"] !== undefined) {
  const directory = resolve(args.values["output-dir"]);
  let created = false;
  try {
    mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
    mkdirSync(directory, { mode: 0o700 });
    created = true;
    writeFileSync(resolve(directory, "token.env"), `STATUS_REPORTER_TOKEN=${token}\n`, { mode: 0o600, flag: "wx" });
    writeFileSync(resolve(directory, "register.sql"), sql, { mode: 0o600, flag: "wx" });
  } catch {
    if (created) rmSync(directory, { recursive: true, force: true });
    console.error("Cannot create token files; choose a new writable output directory. Existing directories are never overwritten.");
    process.exit(1);
  }
  console.log(`Created token.env and register.sql in ${directory}. Register every component before applying the SQL.`);
  process.exit(0);
}

console.log("Store this token on the reporter host. It will not be shown again:");
console.log(token);
console.log("");
console.log("Apply the following SQL to D1:");
console.log(sql.trimEnd());
