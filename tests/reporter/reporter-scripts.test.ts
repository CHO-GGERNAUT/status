import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HeartbeatRequest } from "../../src/contracts/status-api";
import { recordHeartbeat } from "../../src/server/application/status/record-heartbeat";
import type { PersistHeartbeat } from "../../src/server/domain/status/types";

const reporter = resolve("reporter");
const token = `test-host.${"a".repeat(43)}`;
let directory: string;
let environment: NodeJS.ProcessEnv;

interface RecordedRequest {
  args: string[];
  headers: string;
  payload: HeartbeatRequest;
}

function executable(name: string, code: string) {
  const file = join(directory, "bin", name);
  writeFileSync(file, `#!${process.execPath}\n${code}\n`);
  chmodSync(file, 0o755);
}

function run(kind = "host", overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync("/bin/sh", [join(reporter, `bin/status-${kind}-reporter`)], {
    env: { ...environment, ...overrides }, encoding: "utf8", timeout: 10_000,
  });
}

function request(): RecordedRequest {
  return JSON.parse(readFileSync(join(directory, "request.json"), "utf8"));
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "status-reporter-"));
  mkdirSync(join(directory, "bin"));
  environment = {
    ...process.env, PATH: `${join(directory, "bin")}:${process.env.PATH}`,
    TEST_DIR: directory, STATUS_REPORTER_TOKEN: token,
    STATUS_REPORTER_URL: "https://status.example.test/api/v1/heartbeat",
    STATUS_COMPONENT: "ubuntu-main-server", STATUS_K3S_BIN: join(directory, "bin/k3s"),
    STATUS_K3S_KUBECONFIG: "/test/explicit-kubeconfig",
  };
  executable("curl", `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.writeFileSync(process.env.TEST_DIR + "/request.json", JSON.stringify({
  args, headers: fs.readFileSync(0, "utf8"), payload: JSON.parse(args[args.indexOf("--data") + 1]),
}));
process.stdout.write(process.env.HTTP_CODE || "202");
process.exit(Number(process.env.CURL_EXIT || "0"));
`);
  executable("k3s", `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_DIR + "/k3s.jsonl", JSON.stringify(args) + "\\n");
if (process.env.ALL_K3S_FAIL === "yes") process.exit(1);
if (args.includes("--raw=/readyz")) process.exit(Number(process.env.API_EXIT || "0"));
if (args.includes("nodes")) process.stdout.write(process.env.NODES ?? "node-a|True\\nnode-b|True\\n");
else if (args.includes("coredns")) process.stdout.write(process.env.DNS_COUNTS ?? "1|1");
else if (args.includes("traefik")) process.stdout.write(process.env.INGRESS_COUNTS ?? "1|1");
else process.exit(1);
`);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("portable reporter scripts", () => {
  it("sends a host heartbeat without putting credentials in argv or logs", () => {
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    const sent = request();
    expect(sent.payload.sequence).toBeGreaterThan(0);
    expect(sent.payload.observations).toEqual([
      { component: "ubuntu-main-server", status: "operational", message: "heartbeat" },
    ]);
    expect(sent.headers).toContain(`Bearer ${token}`);
    expect(sent.args.join(" ") + result.stdout + result.stderr).not.toContain(token);
    expect(sent.args[0]).toBe("--disable");
    expect(sent.args).toEqual(expect.arrayContaining(["--max-time", "--proto", "--header", "@-"]));
    expect(sent.args).not.toContain("--location");
    expect(sent.args).not.toContain("--retry-all-errors");
  });

  it.each(["200", "301", "401", "403", "409", "500"])("rejects HTTP %s", (code) => {
    const result = run("host", { HTTP_CODE: code });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`HTTP ${code}`);
    expect(result.stderr).not.toContain(token);
  });

  it("reports transport failure without exposing curl output", () => {
    const result = run("host", { CURL_EXIT: "28", HTTP_CODE: "000" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("transport failed");
  });

  it.each([
    { STATUS_COMPONENT: 'bad"component' }, { STATUS_REPORTER_TOKEN: "" },
    { STATUS_REPORTER_TOKEN: `${token}\nInjected: header` },
    { STATUS_REPORTER_URL: "http://example.test/api/v1/heartbeat" },
  ])("rejects invalid settings before invoking curl: %j", (settings) => {
    expect(run("host", settings).status).not.toBe(0);
    expect(() => request()).toThrow();
  });

  it("exports root-owned cron configuration to the child reporter", () => {
    const config = join(directory, "host.env");
    writeFileSync(config, `STATUS_REPORTER_URL=${environment.STATUS_REPORTER_URL}\nSTATUS_REPORTER_TOKEN=${token}\nSTATUS_COMPONENT=openwrt\n`, { mode: 0o600 });
    const env = { ...environment };
    delete env.STATUS_REPORTER_URL;
    delete env.STATUS_REPORTER_TOKEN;
    delete env.STATUS_COMPONENT;
    const result = spawnSync("/bin/sh", [join(reporter, "bin/status-run-reporter"), config, "host"],
      { env, encoding: "utf8", timeout: 10_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(request().payload.observations[0].component).toBe("openwrt");
  });

  it("uses four bounded K3S queries with an explicit kubeconfig", () => {
    expect(run("k3s").status).toBe(0);
    expect(request().payload.observations.map((item) => item.status)).toEqual(Array(4).fill("operational"));
    const calls: string[][] = readFileSync(join(directory, "k3s.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(calls).toHaveLength(4);
    for (const args of calls) {
      expect(args).toContain("--request-timeout=5s");
      expect(args).toContain("/test/explicit-kubeconfig");
    }
  });

  it("observes other components independently when API readiness fails", () => {
    expect(run("k3s", { API_EXIT: "1" }).status).toBe(0);
    expect(request().payload.observations.map((item) => item.status)).toEqual([
      "outage", "operational", "operational", "operational",
    ]);
  });

  it("handles missing node conditions and partially ready deployments", () => {
    expect(run("k3s", { NODES: "node-a|True\nnode-b|\n", DNS_COUNTS: "|2", INGRESS_COUNTS: "1|2" }).status).toBe(0);
    const observations = request().payload.observations;
    expect(observations[1].status).toBe("degraded");
    expect(observations[2]).toMatchObject({ status: "outage", message: "0/2 replicas ready" });
    expect(observations[3].status).toBe("degraded");
  });

  it("still sends an outage observation when the cluster cannot be reached", () => {
    expect(run("k3s", { ALL_K3S_FAIL: "yes" }).status).toBe(0);
    expect(request().payload.observations.map((item) => item.status)).toEqual(Array(4).fill("outage"));
  });

  it("produces payloads accepted by the status heartbeat use case", async () => {
    expect(run("k3s").status).toBe(0);
    const payload = request().payload;
    let persisted: PersistHeartbeat | undefined;
    const result = await recordHeartbeat(
      { ...payload, bearerToken: token, receivedAt: payload.sequence },
      {
        authenticator: { authenticate: async () => ({ id: "test-host", lastSequence: 0,
          allowedComponentSlugs: new Set(payload.observations.map((item) => item.component)) }) },
        repository: {
          findComponentStatuses: async () => payload.observations.map((item, index) => ({
            component: { id: index + 1, slug: item.component, group: "k3s", name: item.component,
              description: null, staleAfterSeconds: 180, sortOrder: index, monitoringStartedAt: 1 },
            state: null, openIncidentId: null,
          })),
          persistHeartbeat: async (heartbeat) => { persisted = heartbeat; },
          getPublicStatusData: async () => ({ components: [], incidents: [] }),
        },
      },
    );
    expect(result.acceptedComponents).toBe(4);
    expect(persisted?.mutations).toHaveLength(4);
  });

  it.each(["host", "k3s"])("bounds the %s systemd service and permits DNS sockets", (kind) => {
    const unit = readFileSync(join(reporter, `systemd/status-${kind}-reporter.service`), "utf8");
    expect(unit).toContain("TimeoutStartSec=45s");
    expect(unit).toContain("RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6");
  });

  it.each(["status-common.sh", "status-run-reporter", "status-host-reporter", "status-k3s-reporter"])("parses %s as POSIX shell", (name) => {
    const result = spawnSync("/bin/sh", ["-n", join(reporter, "bin", name)], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
});
