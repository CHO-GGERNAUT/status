import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export async function adminRequest(path, method, body) {
  const envFile = process.env.STATUS_ADMIN_ENV_FILE ?? "local/admin.env";
  if (process.env.STATUS_ADMIN_ENV_FILE && !existsSync(envFile)) throw new Error("Cannot read STATUS_ADMIN_ENV_FILE");
  const configuration = { ...(existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {}), ...process.env };
  const token = configuration.STATUS_ADMIN_TOKEN;
  if (!token || token.length < 32) throw new Error("Set STATUS_ADMIN_TOKEN or create a private local/admin.env");
  const base = adminOrigin(configuration.STATUS_ADMIN_URL);
  let response;
  try {
    response = await fetch(new URL(path, base), {
      method, redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error("Admin request failed or timed out; check the server before retrying token creation/rotation");
  }
  if (!response.ok) throw new Error(`Admin request rejected (HTTP ${response.status}); check credentials, components and reporter ID`);
  try {
    return await response.json();
  } catch {
    throw new Error("Admin API returned an invalid response; check the server before retrying token creation/rotation");
  }
}

export function adminOrigin(value) {
  if (!value) throw new Error("Set STATUS_ADMIN_URL to your own status server origin");
  let base;
  try {
    base = new URL(value);
  } catch {
    throw new Error("STATUS_ADMIN_URL must be a valid HTTPS origin");
  }
  if ((base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
    || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
    throw new Error("STATUS_ADMIN_URL must be an HTTPS origin (HTTP is allowed only for localhost)");
  }
  return base;
}
