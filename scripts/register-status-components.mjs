import { readFileSync } from "node:fs";
import { adminRequest } from "./admin-client.mjs";

try {
  const [path, ...extra] = process.argv.slice(2);
  if (!path || extra.length) throw new Error("Usage: pnpm component:register <components.json>");
  const result = await adminRequest("/api/v1/admin/components", "PUT", JSON.parse(readFileSync(path, "utf8")));
  console.log(`Configured ${result.updatedComponents} component(s) through the admin API.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Component registration failed");
  process.exitCode = 1;
}
