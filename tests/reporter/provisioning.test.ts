import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let directory: string;
let database: DatabaseSync;

function cli(script: string, ...args: string[]) {
  return spawnSync(process.execPath, [resolve("scripts", script), ...args], { encoding: "utf8" });
}

function components(input: unknown) {
  const file = join(directory, "components.json");
  writeFileSync(file, JSON.stringify(input));
  return cli("register-status-components.mjs", file);
}

function sqlite(sql: string) {
  if (sql.trimStart().startsWith("SELECT ")) {
    return database.prepare(sql).all().map((row) => Object.values(row).join("|")).join("\n");
  }
  database.exec(sql);
  return "";
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "status-provisioning-"));
  database = new DatabaseSync(":memory:");
});
afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("reporter provisioning", () => {
  it("writes protected token and SQL files without printing the secret", () => {
    const output = join(directory, "private", "host");
    const result = cli("create-reporter-token.mjs", "test-host", "example-host", "--output-dir", output);
    expect(result.status, result.stderr).toBe(0);
    const token = readFileSync(join(output, "token.env"), "utf8").trim().split("=")[1];
    expect(token).toMatch(/^test-host\.[A-Za-z0-9_-]{43}$/);
    expect(result.stdout + result.stderr).not.toContain(token);
    const sql = readFileSync(join(output, "register.sql"), "utf8");
    expect(sql).toContain(createHash("sha256").update(token).digest("hex"));
    expect(sql).not.toContain(token);
    expect(statSync(output).mode & 0o777).toBe(0o700);
    for (const file of ["token.env", "register.sql"]) expect(statSync(join(output, file)).mode & 0o777).toBe(0o600);
    const retry = cli("create-reporter-token.mjs", "test-host", "example-host", "--output-dir", output);
    expect(retry.status).not.toBe(0);
    expect(readFileSync(join(output, "token.env"), "utf8")).toContain(token);
    expect(readFileSync(join(output, "register.sql"), "utf8")).toBe(sql);
  });

  it.each([
    ["bad'id", "example-host"], ["test-host", "bad'component"], ["test-host"],
    ["test-host", "example-host", "example-host"], ["test-host", "example-host", "--unknown"],
  ])("rejects malformed token arguments: %j", (...args) => {
    const result = cli("create-reporter-token.mjs", ...args);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
  });

  it("registers escaped display text without resetting existing state or reactivating a component", () => {
    sqlite(readFileSync(resolve("migrations/0001_initial.sql"), "utf8"));
    const first = components([{ slug: "example-host", group: "devices", name: "Host's status" }]);
    expect(first.status, first.stderr).toBe(0);
    sqlite(first.stdout);
    sqlite(`UPDATE components SET enabled = 0, monitoring_started_at = 100;
INSERT INTO reporters (id, display_name, token_hash, created_at) VALUES ('fixture', 'Fixture', 'hash', 100);
INSERT INTO reporter_components VALUES ('fixture', 1);
INSERT INTO current_states VALUES (1, 'outage', 'test outage', NULL, 150, 'fixture', 1);
INSERT INTO incidents (component_id, started_at, cause) VALUES (1, 150, 'reported');`);
    const second = components([{ slug: "example-host", group: "devices", name: "Renamed host", staleAfterSeconds: 240 }]);
    expect(second.status, second.stderr).toBe(0);
    sqlite(second.stdout);
    expect(sqlite("SELECT id, display_name, enabled, monitoring_started_at, stale_after_seconds FROM components;")).toBe("1|Renamed host|0|100|240");
    expect(sqlite("SELECT (SELECT COUNT(*) FROM current_states), (SELECT COUNT(*) FROM incidents), (SELECT COUNT(*) FROM reporter_components);")).toBe("1|1|1");
  });

  it("grants only registered enabled component permissions and does not rotate an existing token", () => {
    sqlite(readFileSync(resolve("migrations/0001_initial.sql"), "utf8"));
    const registered = components([
      { slug: "active", group: "devices", name: "Active" },
      { slug: "disabled", group: "devices", name: "Disabled" },
    ]);
    sqlite(registered.stdout);
    sqlite("UPDATE components SET enabled = 0 WHERE slug = 'disabled';");
    const output = join(directory, "host");
    expect(cli("create-reporter-token.mjs", "fixture", "active", "disabled", "--output-dir", output).status).toBe(0);
    const sql = readFileSync(join(output, "register.sql"), "utf8");
    sqlite(sql);
    expect(sqlite("SELECT c.slug FROM reporter_components rc JOIN components c ON c.id = rc.component_id;")).toBe("active");
    const hash = sqlite("SELECT token_hash FROM reporters WHERE id = 'fixture';");
    expect(() => sqlite(sql)).toThrow();
    expect(sqlite("SELECT token_hash FROM reporters WHERE id = 'fixture';")).toBe(hash);
  });

  it.each([
    [], [{ slug: "host", group: "devices", name: "Host", internalIp: "127.0.0.1" }],
    [{ slug: "host", group: "devices", name: "Host", staleAfterSeconds: 30 }],
    [{ slug: "host", group: "devices", name: "Host" }, { slug: "host", group: "k3s", name: "Duplicate" }],
    [{ slug: "host", group: "invalid", name: "Host" }],
  ].map((input) => ({ input })))("rejects invalid component lists without emitting partial SQL: %j", ({ input }) => {
    const result = components(input);
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
  });
});
