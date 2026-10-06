import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

try {
  const [environment = "production", file, ...extra] = process.argv.slice(2);
  if (!["production", "preview"].includes(environment) || extra.length || (environment === "preview" && !file)) {
    throw new Error("Usage: pnpm admin:secret:deploy production [admin-env-file] OR pnpm admin:secret:deploy preview <separate-admin-env-file>");
  }
  const configuration = { ...parseEnv(readFileSync(file ?? "local/admin.env", "utf8")), ...process.env };
  const secret = configuration.STATUS_ADMIN_TOKEN;
  const project = configuration.STATUS_PAGES_PROJECT;
  if (!project || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(project)) throw new Error("Set STATUS_PAGES_PROJECT in the private env file or environment");
  if (!secret || secret.length < 32) throw new Error("Missing or too-short STATUS_ADMIN_TOKEN in the private env file");
  const result = spawnSync("pnpm", ["exec", "wrangler", "pages", "secret", "put", "STATUS_ADMIN_TOKEN",
    "--project-name", project, "--env", environment], { input: secret, encoding: "utf8" });
  if (result.status !== 0) throw new Error("Secret upload failed; check Wrangler authentication and the Pages project. Secret values and command output were suppressed.");
  console.log(`Configured the Pages STATUS_ADMIN_TOKEN secret for ${environment}. Redeploy to make it available to Functions.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Secret upload failed");
  process.exitCode = 1;
}
