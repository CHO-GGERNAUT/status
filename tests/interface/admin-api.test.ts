import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleAdminRequest } from "../../src/server/interface/http/admin-handler";
import { handleHeartbeatRequest } from "../../src/server/interface/http/heartbeat-handler";
import { recordHeartbeat } from "../../src/server/application/status/record-heartbeat";
import { D1ReporterAuthenticator } from "../../src/server/infrastructure/auth/d1-reporter-authenticator";
import { D1ReporterManagementRepository } from "../../src/server/infrastructure/d1/d1-reporter-management-repository";
import { D1StatusRepository } from "../../src/server/infrastructure/d1/d1-status-repository";
import { testDatabase } from "../helpers/sqlite-d1";

const adminToken = "management-secret-" + "a".repeat(43);
let fixture: ReturnType<typeof testDatabase>;

beforeEach(() => { fixture = testDatabase(); });
afterEach(() => fixture.sqlite.close());

function admin(action: Parameters<typeof handleAdminRequest>[2], body?: unknown, id = "", token = adminToken) {
  const method = action === "components" ? "PUT" : action === "update-reporter" ? "PATCH" : "POST";
  return handleAdminRequest(new Request("https://status.test/api/v1/admin", {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { STATUS_DB: fixture.database, STATUS_ADMIN_TOKEN: adminToken }, action, id);
}

async function setupReporter() {
  expect((await admin("components", [
    { slug: "nas", group: "devices", name: "NAS" }, { slug: "other", group: "devices", name: "Other" },
  ])).status).toBe(200);
  const response = await admin("create-reporter", { id: "nas-host", components: ["nas"] });
  expect(response.status).toBe(201);
  return (await response.json() as { token: string }).token;
}

function heartbeat(token: string, component = "nas", sequence = 1) {
  return handleHeartbeatRequest(new Request("https://status.test/api/v1/heartbeat", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sequence, observations: [{ component, status: "operational" }] }),
  }), { STATUS_DB: fixture.database });
}

describe("secret-protected reporter administration", () => {
  it("fails closed without a configured admin secret and does not cache errors", async () => {
    for (const secret of [undefined, "too-short"]) {
      const response = await handleAdminRequest(new Request("https://status.test/admin", { method: "POST" }),
        { STATUS_DB: fixture.database, STATUS_ADMIN_TOKEN: secret }, "create-reporter");
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    expect((await admin("components", [], "", "wrong-admin-token")).status).toBe(401);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM components").get()?.count).toBe(0);
  });

  it("creates scoped tokens on the server, stores only their hashes and rejects admin keys as heartbeats", async () => {
    const token = await setupReporter();
    expect(token).toMatch(/^nas-host\.[A-Za-z0-9_-]{43}$/);
    const row = fixture.sqlite.prepare("SELECT * FROM reporters WHERE id = 'nas-host'").get();
    expect(row?.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
    expect((await heartbeat(token)).status).toBe(202);
    expect((await heartbeat(token, "other", 2)).status).toBe(401);
    expect((await heartbeat(adminToken)).status).toBe(401);
    const managementAttempt = await admin("components", [{ slug: "hack", group: "devices", name: "Hack" }], "", token);
    expect(managementAttempt.status).toBe(401);
  });

  it("preserves current states, history, component IDs and disabled state when configuring existing components", async () => {
    const token = await setupReporter();
    await heartbeat(token);
    fixture.sqlite.exec("UPDATE components SET enabled = 0, monitoring_started_at = 100 WHERE slug = 'nas'; INSERT INTO incidents (component_id, started_at, cause) VALUES (1, 100, 'reported');");
    const history = fixture.sqlite.prepare("SELECT * FROM incidents").all();
    const response = await admin("components", [{ slug: "nas", group: "devices", name: "NAS's new name", staleAfterSeconds: 240 }]);
    expect(response.status).toBe(200);
    expect(fixture.sqlite.prepare("SELECT id, enabled, monitoring_started_at, stale_after_seconds, display_name FROM components WHERE slug='nas'").get())
      .toMatchObject({ id: 1, enabled: 0, monitoring_started_at: 100, stale_after_seconds: 240, display_name: "NAS's new name" });
    expect(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM current_states").get()?.count).toBe(1);
    expect(fixture.sqlite.prepare("SELECT * FROM incidents").all()).toEqual(history);
    expect((await admin("components", [{ slug: "nas", group: "devices", name: "NAS", enabled: true }])).status).toBe(200);
    expect((await heartbeat(token, "nas", 2)).status).toBe(202);
  });

  it("preserves tokens and sequence during metadata/permission edits; disabling revokes reporting", async () => {
    const token = await setupReporter();
    await heartbeat(token);
    const updated = await admin("update-reporter", { name: "Renamed NAS", components: ["other"] }, "nas-host");
    expect(await updated.json()).toEqual({ id: "nas-host", name: "Renamed NAS", enabled: true, components: ["other"] });
    expect(fixture.sqlite.prepare("SELECT last_sequence FROM reporters").get()?.last_sequence).toBe(1);
    expect((await heartbeat(token, "nas", 2)).status).toBe(401);
    expect((await heartbeat(token, "other", 2)).status).toBe(202);
    expect((await admin("update-reporter", { enabled: false }, "nas-host")).status).toBe(200);
    expect((await heartbeat(token, "other", 3)).status).toBe(401);
  });

  it("rotates a token, invalidates the old token and preserves permissions/history", async () => {
    const oldToken = await setupReporter();
    await heartbeat(oldToken);
    const response = await admin("rotate-token", undefined, "nas-host");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const { token } = await response.json() as { token: string };
    expect(token).not.toBe(oldToken);
    expect(await new D1ReporterAuthenticator(fixture.database).authenticate(oldToken)).toBeNull();
    expect((await heartbeat(oldToken, "nas", 2)).status).toBe(401);
    expect((await heartbeat(token)).status).toBe(202);
    expect((await heartbeat(token, "other", 2)).status).toBe(401);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM current_states").get()?.count).toBe(1);
    await admin("update-reporter", { enabled: false }, "nas-host");
    const disabledRotation = await admin("rotate-token", undefined, "nas-host");
    expect((await heartbeat((await disabledRotation.json() as { token: string }).token, "nas", 2)).status).toBe(401);
  });

  it("returns conflicts/missing IDs without changing the existing token or creating partial grants", async () => {
    const token = await setupReporter();
    expect((await admin("create-reporter", { id: "nas-host", components: ["other"] })).status).toBe(409);
    expect((await heartbeat(token)).status).toBe(202);
    expect((await admin("create-reporter", { id: "new-host", components: ["nas", "missing"] })).status).toBe(400);
    expect(fixture.sqlite.prepare("SELECT id FROM reporters WHERE id = 'new-host'").get()).toBeUndefined();
    expect((await admin("update-reporter", { enabled: true }, "missing")).status).toBe(404);
    expect((await admin("rotate-token", undefined, "missing")).status).toBe(404);
    expect((await admin("update-reporter", { name: "Must not persist", components: ["missing"] }, "nas-host")).status).toBe(400);
    expect(fixture.sqlite.prepare("SELECT display_name FROM reporters").get()?.display_name).toBe("nas-host");
  });

  it("rolls back reporter creation and grant replacement when a grant write fails", async () => {
    await setupReporter();
    fixture.sqlite.exec("CREATE TRIGGER block_other BEFORE INSERT ON reporter_components WHEN NEW.component_id = 2 BEGIN SELECT RAISE(ABORT, 'test write failure'); END;");
    const repository = new D1ReporterManagementRepository(fixture.database);
    await expect(repository.createReporter({ id: "new-host", components: ["nas", "other"] }, "hash", 100)).rejects.toThrow();
    expect(await repository.getReporter("new-host")).toBeNull();
    await expect(repository.updateReporter("nas-host", { name: "Must roll back", components: ["other"] })).rejects.toThrow();
    expect(await repository.getReporter("nas-host")).toMatchObject({ name: "nas-host", components: ["nas"] });
  });

  it.each(["rotation", "disable", "permissions", "sequence"])("rejects in-flight stale authentication after %s without altering states/history", async (change) => {
    const token = await setupReporter();
    const identity = await new D1ReporterAuthenticator(fixture.database).authenticate(token);
    expect(identity).not.toBeNull();
    if (change === "rotation") await admin("rotate-token", undefined, "nas-host");
    if (change === "disable") await admin("update-reporter", { enabled: false }, "nas-host");
    if (change === "permissions") await admin("update-reporter", { components: ["other"] }, "nas-host");
    if (change === "sequence") await heartbeat(token);
    const state = fixture.sqlite.prepare("SELECT * FROM current_states").all();
    const history = fixture.sqlite.prepare("SELECT * FROM incidents").all();
    await expect(recordHeartbeat({ bearerToken: token, sequence: 1, receivedAt: Math.floor(Date.now() / 1000),
      observations: [{ component: "nas", status: "outage" }] }, {
      authenticator: { authenticate: async () => identity }, repository: new D1StatusRepository(fixture.database),
    })).rejects.toMatchObject({ code: change === "sequence" ? "conflict" : "unauthorized" });
    expect(fixture.sqlite.prepare("SELECT * FROM current_states").all()).toEqual(state);
    expect(fixture.sqlite.prepare("SELECT * FROM incidents").all()).toEqual(history);
  });

  it.each([
    [{ slug: "nas", group: "devices", name: "NAS", privateIp: "10.0.0.1" }],
    [{ slug: "nas", group: "devices", name: "NAS", staleAfterSeconds: 30 }],
    [{ slug: "nas", group: "devices", name: "NAS" }, { slug: "nas", group: "devices", name: "Duplicate" }],
  ])("rejects invalid component configurations without partial writes", async (...items) => {
    expect((await admin("components", items)).status).toBe(400);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM components").get()?.count).toBe(0);
  });

  it("rejects unexpected fields and oversized/invalid JSON, including streams without Content-Length", async () => {
    expect((await admin("create-reporter", { id: "nas", components: ["nas"], token: "caller-selected" })).status).toBe(400);
    for (const body of ["not-json", JSON.stringify({ value: "a".repeat(17 * 1024) })]) {
      const response = await handleAdminRequest(new Request("https://status.test/admin", {
        method: "POST", headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body,
      }), { STATUS_DB: fixture.database, STATUS_ADMIN_TOKEN: adminToken }, "create-reporter");
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
    const response = await handleAdminRequest(new Request("https://status.test/admin"),
      { STATUS_DB: fixture.database, STATUS_ADMIN_TOKEN: adminToken }, "create-reporter");
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
