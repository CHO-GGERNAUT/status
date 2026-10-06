import { readFileSync } from "node:fs";
import { adminRequest } from "./admin-client.mjs";

try {
  const [id, file, ...extra] = process.argv.slice(2);
  if (!id || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(id) || !file || extra.length) {
    throw new Error("Usage: pnpm reporter:update <reporter-id> <update.json>");
  }
  await adminRequest(`/api/v1/admin/reporters/${id}`, "PATCH", JSON.parse(readFileSync(file, "utf8")));
  console.log(`Updated ${id}; its token was preserved.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Reporter update failed");
  process.exitCode = 1;
}
