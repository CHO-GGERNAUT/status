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
    STATUS_COMPONENT: "ubuntu-main-server",
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

  it("rejects the retired cluster reporter kind before invoking curl", () => {
    const result = spawnSync("/bin/sh", [join(reporter, "bin/status-run-reporter"), "/unused/config.env", "k3s"],
      { env: environment, encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(2);
    expect(() => request()).toThrow();
  });

  it("produces payloads accepted by the status heartbeat use case", async () => {
    expect(run().status).toBe(0);
    const payload = request().payload;
    let persisted: PersistHeartbeat | undefined;
    const result = await recordHeartbeat(
      { ...payload, bearerToken: token, receivedAt: payload.sequence },
      {
        authenticator: { authenticate: async () => ({ id: "test-host", tokenHash: "fixture-hash", lastSequence: 0,
          allowedComponentSlugs: new Set(payload.observations.map((item) => item.component)) }) },
        repository: {
          findComponentStatuses: async () => payload.observations.map((item, index) => ({
            component: { id: index + 1, slug: item.component, group: "devices", name: item.component,
              description: null, staleAfterSeconds: 180, sortOrder: index, monitoringStartedAt: 1 },
            state: null, openIncidentId: null,
          })),
          persistHeartbeat: async (heartbeat) => { persisted = heartbeat; },
          getPublicStatusData: async () => ({ components: [], incidents: [] }),
        },
      },
    );
    expect(result.acceptedComponents).toBe(1);
    expect(persisted?.mutations).toHaveLength(1);
  });

  it("bounds the host systemd service and permits DNS sockets", () => {
    const unit = readFileSync(join(reporter, "systemd/status-host-reporter.service"), "utf8");
    expect(unit).toContain("TimeoutStartSec=45s");
    expect(unit).toContain("RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6");
  });

  it.each(["status-common.sh", "status-run-reporter", "status-host-reporter"])("parses %s as POSIX shell", (name) => {
    const result = spawnSync("/bin/sh", ["-n", join(reporter, "bin", name)], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
});
