import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPublicStatus } from "../../src/server/application/status/get-public-status";
import { recordHeartbeat } from "../../src/server/application/status/record-heartbeat";
import type { ComponentStatus } from "../../src/contracts/status-api";
import { D1ReporterAuthenticator } from "../../src/server/infrastructure/auth/d1-reporter-authenticator";
import { D1StatusRepository } from "../../src/server/infrastructure/d1/d1-status-repository";
import { testDatabase } from "../helpers/sqlite-d1";

const token = "router." + "a".repeat(43);
const firstReceipt = 1_000_000;
let fixture: ReturnType<typeof testDatabase>;
let repository: D1StatusRepository;

beforeEach(() => {
  fixture = testDatabase();
  fixture.sqlite.exec(`
    INSERT INTO components (slug, group_key, display_name, monitoring_started_at)
      VALUES ('router', 'devices', 'Router', 100);
  `);
  fixture.sqlite.prepare("INSERT INTO reporters (id, display_name, token_hash, created_at) VALUES ('router', 'Router', ?, 500)")
    .run(createHash("sha256").update(token).digest("hex"));
  fixture.sqlite.exec("INSERT INTO reporter_components (reporter_id, component_id) VALUES ('router', 1)");
  repository = new D1StatusRepository(fixture.database);
});
afterEach(() => fixture.sqlite.close());

function heartbeat(status: ComponentStatus, receivedAt: number, sequence = 1) {
  return recordHeartbeat({ bearerToken: token, sequence, receivedAt,
    observations: [{ component: "router", status }] }, {
    authenticator: new D1ReporterAuthenticator(fixture.database), repository,
  });
}

describe("monitoring begins at the first accepted heartbeat", () => {
  it("shows unobserved devices as unknown, with no outage history or measured uptime", async () => {
    const status = await getPublicStatus({ now: firstReceipt }, repository);
    expect(status.status).toBe("unknown");
    expect(status.groups[0].components[0]).toMatchObject({
      status: "unknown", lastReceivedAt: null,
      availability: { month: { monitoredSeconds: 0, outageSeconds: 0 } },
    });
    expect(status.groups[0].components[0].daily.every((day) => day.monitoredSeconds === 0)).toBe(true);
    expect(status.incidents).toEqual([]);
  });

  it("excludes registration-to-installation time and never resets the start on later heartbeats", async () => {
    await heartbeat("operational", firstReceipt);
    await heartbeat("operational", firstReceipt + 60, 2);
    expect(fixture.sqlite.prepare("SELECT monitoring_started_at FROM components").get()?.monitoring_started_at).toBe(firstReceipt);
    const status = await getPublicStatus({ now: firstReceipt + 120 }, repository);
    const component = status.groups[0].components[0];
    expect(component.availability.month).toEqual({ percentage: 100, monitoredSeconds: 120, outageSeconds: 0 });
    expect(component.daily.slice(0, -1).every((day) => day.monitoredSeconds === 0)).toBe(true);
    expect(status.incidents).toEqual([]);
    expect(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM incidents").get()?.count).toBe(0);
  });

  it("counts an explicitly unavailable first heartbeat as a real outage starting at receipt", async () => {
    await heartbeat("outage", firstReceipt);
    let status = await getPublicStatus({ now: firstReceipt + 60 }, repository);
    expect(status.groups[0].components[0].availability.month).toEqual({ percentage: 0, monitoredSeconds: 60, outageSeconds: 60 });
    expect(status.incidents).toMatchObject([{ cause: "reported", startedAt: new Date(firstReceipt * 1000).toISOString() }]);
    await heartbeat("operational", firstReceipt + 60, 2);
    status = await getPublicStatus({ now: firstReceipt + 120 }, repository);
    expect(status.groups[0].components[0].availability.month).toEqual({ percentage: 50, monitoredSeconds: 120, outageSeconds: 60 });
    expect(status.incidents[0].endedAt).toBe(new Date((firstReceipt + 60) * 1000).toISOString());
  });

  it("still counts stale periods after monitoring begins, including recovery", async () => {
    await heartbeat("operational", firstReceipt);
    const stale = await getPublicStatus({ now: firstReceipt + 240 }, repository);
    expect(stale.status).toBe("outage");
    expect(stale.groups[0].components[0].availability.month).toEqual({ percentage: 75, monitoredSeconds: 240, outageSeconds: 60 });
    await heartbeat("operational", firstReceipt + 300, 2);
    const recovered = await getPublicStatus({ now: firstReceipt + 360 }, repository);
    expect(recovered.status).toBe("operational");
    expect(recovered.groups[0].components[0].availability.month).toEqual({ percentage: 66.667, monitoredSeconds: 360, outageSeconds: 120 });
    expect(recovered.incidents).toMatchObject([{ cause: "stale", startedAt: new Date((firstReceipt + 180) * 1000).toISOString() }]);
  });

  it("excludes corrected pre-monitoring history while retaining later real incidents", async () => {
    await heartbeat("operational", firstReceipt);
    fixture.sqlite.prepare("INSERT INTO incidents (component_id, started_at, ended_at, cause) VALUES (1, 100, ?, 'stale')").run(firstReceipt);
    await heartbeat("outage", firstReceipt + 60, 2);
    await heartbeat("operational", firstReceipt + 120, 3);
    const status = await getPublicStatus({ now: firstReceipt + 180 }, repository);
    expect(status.incidents).toHaveLength(1);
    expect(status.incidents[0].cause).toBe("reported");
    expect(status.groups[0].components[0].availability.month).toEqual({ percentage: 66.667, monitoredSeconds: 180, outageSeconds: 60 });
    expect(fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM incidents").get()?.count).toBe(2);
  });
});
