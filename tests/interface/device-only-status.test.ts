import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPublicStatus } from "../../src/server/application/status/get-public-status";
import { D1ReporterAuthenticator } from "../../src/server/infrastructure/auth/d1-reporter-authenticator";
import { D1StatusRepository } from "../../src/server/infrastructure/d1/d1-status-repository";
import { handleAdminRequest } from "../../src/server/interface/http/admin-handler";
import { handleHeartbeatRequest } from "../../src/server/interface/http/heartbeat-handler";
import { testDatabase } from "../helpers/sqlite-d1";

const adminToken = "management-secret-" + "a".repeat(43);
const deviceToken = "device." + "b".repeat(43);
const clusterToken = "cluster." + "c".repeat(43);
const mixedToken = "mixed." + "d".repeat(43);
let fixture: ReturnType<typeof testDatabase>;

beforeEach(() => {
  fixture = testDatabase();
  fixture.sqlite.exec(readFileSync("migrations/0002_seed_components.sql", "utf8"));
  for (const [id, token, slugs] of [
    ["device", deviceToken, ["openwrt"]],
    ["cluster", clusterToken, ["k3s-api"]],
    ["mixed", mixedToken, ["ubuntu-main-server", "k3s-nodes"]],
  ] as const) {
    fixture.sqlite.prepare("INSERT INTO reporters (id, display_name, token_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, id, createHash("sha256").update(token).digest("hex"), 100);
    for (const slug of slugs) fixture.sqlite.prepare("INSERT INTO reporter_components (reporter_id, component_id) SELECT ?, id FROM components WHERE slug = ?").run(id, slug);
  }
  fixture.sqlite.exec(`
    INSERT INTO current_states (component_id, reported_status, received_at, reporter_id, sequence)
      SELECT id, 'outage', unixepoch(), 'cluster', 1 FROM components WHERE slug = 'k3s-api';
    INSERT INTO incidents (component_id, started_at, cause)
      SELECT id, unixepoch(), 'reported' FROM components WHERE slug = 'k3s-api';
  `);
});
afterEach(() => fixture.sqlite.close());

function admin(action: "components" | "create-reporter" | "update-reporter", body: unknown, id = "") {
  return handleAdminRequest(new Request("https://status.test/admin", {
    method: action === "components" ? "PUT" : action === "update-reporter" ? "PATCH" : "POST",
    headers: { Authorization: "Bearer " + adminToken, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), { STATUS_DB: fixture.database, STATUS_ADMIN_TOKEN: adminToken }, action, id);
}

function heartbeat(token: string, component: string) {
  return handleHeartbeatRequest(new Request("https://status.test/api/v1/heartbeat", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ sequence: 1, observations: [{ component, status: "operational" }] }),
  }), { STATUS_DB: fixture.database });
}

describe("device-only monitoring", () => {
  it("excludes legacy cluster components and incidents even before their migration is applied", async () => {
    const snapshot = await getPublicStatus({ now: Math.floor(Date.now() / 1000) }, new D1StatusRepository(fixture.database));
    expect(snapshot.groups.map((group) => group.key)).toEqual(["devices"]);
    expect(snapshot.groups[0].components).toHaveLength(5);
    expect(snapshot.incidents.every((incident) => !incident.component.startsWith("k3s-"))).toBe(true);
    expect(await new D1ReporterAuthenticator(fixture.database).authenticate(clusterToken)).toBeNull();
    expect((await heartbeat(clusterToken, "k3s-api")).status).toBe(401);
    expect((await heartbeat(mixedToken, "k3s-nodes")).status).toBe(401);
    expect((await heartbeat(mixedToken, "ubuntu-main-server")).status).toBe(202);
  });

  it("rejects new cluster configuration or grants while preserving device reporter permissions", async () => {
    expect((await admin("components", [{ slug: "new-cluster", group: "k3s", name: "Cluster" }])).status).toBe(400);
    expect((await admin("create-reporter", { id: "new-cluster", components: ["k3s-api"] })).status).toBe(400);
    expect((await admin("update-reporter", { components: ["k3s-api"] }, "device")).status).toBe(400);
    expect((await admin("create-reporter", { id: "k3s-api" })).status).toBe(400);
    expect((await heartbeat(deviceToken, "openwrt")).status).toBe(202);
  });

  it("retires cluster reporters and grants without changing device records, tokens or status history", async () => {
    const devices = fixture.sqlite.prepare("SELECT * FROM components WHERE group_key = 'devices'").all();
    const reporter = fixture.sqlite.prepare("SELECT * FROM reporters WHERE id = 'device'").get();
    const states = fixture.sqlite.prepare("SELECT * FROM current_states").all();
    const incidents = fixture.sqlite.prepare("SELECT * FROM incidents").all();
    const migration = readFileSync("migrations/0003_retire_k3s_monitoring.sql", "utf8");
    fixture.sqlite.exec(migration);
    fixture.sqlite.exec(migration);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM components WHERE group_key='k3s' AND enabled=0").get()?.count).toBe(4);
    expect(fixture.sqlite.prepare("SELECT enabled FROM reporters WHERE id='cluster'").get()?.enabled).toBe(0);
    expect(fixture.sqlite.prepare("SELECT enabled FROM reporters WHERE id='mixed'").get()?.enabled).toBe(1);
    expect(fixture.sqlite.prepare("SELECT c.slug FROM reporter_components rc JOIN components c ON c.id=rc.component_id WHERE rc.reporter_id='mixed'").all())
      .toEqual([{ slug: "ubuntu-main-server" }]);
    expect(fixture.sqlite.prepare("SELECT * FROM components WHERE group_key = 'devices'").all()).toEqual(devices);
    expect(fixture.sqlite.prepare("SELECT * FROM reporters WHERE id = 'device'").get()).toEqual(reporter);
    expect(fixture.sqlite.prepare("SELECT * FROM current_states").all()).toEqual(states);
    expect(fixture.sqlite.prepare("SELECT * FROM incidents").all()).toEqual(incidents);
    expect((await heartbeat(deviceToken, "openwrt")).status).toBe(202);
    expect((await heartbeat(mixedToken, "ubuntu-main-server")).status).toBe(202);
  });
});
