import { createHash, randomBytes } from "node:crypto";

const [, , reporterId, ...componentSlugs] = process.argv;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

if (reporterId === undefined || !slugPattern.test(reporterId) || componentSlugs.length === 0) {
  console.error(
    "Usage: pnpm token:create <reporter-id> <component-slug> [component-slug ...]",
  );
  process.exit(1);
}

if (!componentSlugs.every((slug) => slugPattern.test(slug))) {
  console.error("Reporter and component identifiers must use lowercase letters, numbers, and hyphens.");
  process.exit(1);
}

const token = `${reporterId}.${randomBytes(32).toString("base64url")}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const componentList = componentSlugs.map((slug) => `'${slug}'`).join(", ");

console.log("Store this token on the reporter host. It will not be shown again:");
console.log(token);
console.log("");
console.log("Apply the following SQL to D1:");
console.log(
  `INSERT INTO reporters (id, display_name, token_hash, created_at) VALUES ('${reporterId}', '${reporterId}', '${tokenHash}', unixepoch());`,
);
console.log(
  `INSERT INTO reporter_components (reporter_id, component_id) SELECT '${reporterId}', id FROM components WHERE slug IN (${componentList});`,
);
