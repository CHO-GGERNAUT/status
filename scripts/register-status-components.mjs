import { readFileSync } from "node:fs";

const [, , path, ...extra] = process.argv;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;
const fields = new Set(["slug", "group", "name", "description", "staleAfterSeconds", "sortOrder"]);
const quote = (value) => value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;

try {
  if (!path || extra.length > 0) throw new Error("Usage: pnpm --silent component:register <components.json>");
  const components = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(components) || components.length === 0) throw new Error("Provide a nonempty array of components.");
  const slugs = new Set();
  const statements = components.map((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some((key) => !fields.has(key))
      || typeof item.slug !== "string" || !slugPattern.test(item.slug) || slugs.has(item.slug)
      || !["devices", "k3s"].includes(item.group)
      || typeof item.name !== "string" || item.name.trim().length === 0
      || (item.description !== undefined && item.description !== null && typeof item.description !== "string")) {
      throw new Error("Components require unique slugs, devices/k3s groups and public display names; unknown fields are rejected.");
    }
    const stale = item.staleAfterSeconds ?? 180;
    const order = item.sortOrder ?? 0;
    if (!Number.isSafeInteger(stale) || stale < 60 || !Number.isSafeInteger(order)) {
      throw new Error("staleAfterSeconds must be an integer >= 60 and sortOrder must be an integer.");
    }
    slugs.add(item.slug);
    return `INSERT INTO components (slug, group_key, display_name, description, stale_after_seconds, sort_order, monitoring_started_at)
VALUES (${quote(item.slug)}, ${quote(item.group)}, ${quote(item.name)}, ${quote(item.description ?? null)}, ${stale}, ${order}, unixepoch())
ON CONFLICT(slug) DO UPDATE SET group_key = excluded.group_key, display_name = excluded.display_name,
description = excluded.description, stale_after_seconds = excluded.stale_after_seconds, sort_order = excluded.sort_order;`;
  });
  // Emit only SQL, after the entire input has passed validation. Never access D1.
  console.log(statements.join("\n"));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Cannot read component configuration.");
  process.exit(1);
}
