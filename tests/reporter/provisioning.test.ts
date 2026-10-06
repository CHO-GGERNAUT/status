import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const adminToken = "admin-" + "a".repeat(43);
const reporterToken = "test-host." + "b".repeat(43);
let directory: string;
let server: Server;
let origin: string;
let calls: { url: string; method: string; authorization: string; body: unknown }[];
let responseStatus: number;
let redirect: boolean;

async function cli(script: string, args: string[] = [], overrides: NodeJS.ProcessEnv = {}) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((accept, reject) => {
    const child = spawn(process.execPath, [resolve("scripts", script), ...args], {
      env: { ...process.env, STATUS_ADMIN_TOKEN: adminToken, STATUS_ADMIN_URL: origin,
        STATUS_PAGES_PROJECT: "test-status-project",
        STATUS_ADMIN_ENV_FILE: "", ...overrides }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (value) => { stdout += value; });
    child.stderr.on("data", (value) => { stderr += value; });
    child.on("error", reject);
    child.on("close", (status) => accept({ status, stdout, stderr }));
  });
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "status-provisioning-"));
  calls = []; responseStatus = 200; redirect = false;
  server = createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    calls.push({ url: request.url ?? "", method: request.method ?? "", authorization: request.headers.authorization ?? "",
      body: text ? JSON.parse(text) : undefined });
    response.setHeader("Content-Type", "application/json");
    if (redirect) {
      response.writeHead(302, { Location: origin + "/should-not-follow" }); response.end(); return;
    }
    response.statusCode = responseStatus;
    response.end(JSON.stringify(request.url?.includes("components") ? { updatedComponents: 1 } :
      { reporterId: "test-host", token: reporterToken }));
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing test server address");
  origin = "http://127.0.0.1:" + address.port;
});
afterEach(async () => {
  await new Promise<void>((accept, reject) => server.close((error) => error ? reject(error) : accept()));
  rmSync(directory, { recursive: true, force: true });
});

describe("admin API provisioning CLI", () => {
  it("adds a device with its name using a single POST and saves its installation token", async () => {
    const output = join(directory, "device");
    const result = await cli("create-reporter-token.mjs", ["test-host", "--name", "Test host", "--output-dir", output]);
    expect(result.status, result.stderr).toBe(0);
    expect(calls).toEqual([{ url: "/api/v1/admin/reporters", method: "POST", authorization: "Bearer " + adminToken,
      body: { id: "test-host", name: "Test host" } }]);
    expect(readFileSync(join(output, "token.env"), "utf8")).toBe("STATUS_REPORTER_TOKEN=" + reporterToken + "\n");
    expect(result.stdout + result.stderr).not.toContain(reporterToken);
  });

  it("registers through the API and writes only a protected token file without leaking credentials", async () => {
    const output = join(directory, "private", "host");
    const result = await cli("create-reporter-token.mjs", ["test-host", "nas", "--output-dir", output]);
    expect(result.status, result.stderr).toBe(0);
    expect(calls).toEqual([{ url: "/api/v1/admin/reporters", method: "POST", authorization: "Bearer " + adminToken,
      body: { id: "test-host", components: ["nas"] } }]);
    expect(readFileSync(join(output, "token.env"), "utf8")).toBe("STATUS_REPORTER_TOKEN=" + reporterToken + "\n");
    expect(existsSync(join(output, "register.sql"))).toBe(false);
    expect(statSync(output).mode & 0o777).toBe(0o700);
    expect(statSync(join(output, "token.env")).mode & 0o777).toBe(0o600);
    expect(result.stdout + result.stderr).not.toContain(reporterToken);
    expect(result.stdout + result.stderr).not.toContain(adminToken);
    const retry = await cli("create-reporter-token.mjs", ["test-host", "nas", "--output-dir", output]);
    expect(retry.status).not.toBe(0);
    expect(calls).toHaveLength(1);
    expect(readFileSync(join(output, "token.env"), "utf8")).toContain(reporterToken);
  });

  it("rotates through the explicit endpoint and reads credentials from a private env file", async () => {
    const file = join(directory, "admin.env");
    writeFileSync(file, "STATUS_ADMIN_URL=" + origin + "\nSTATUS_ADMIN_TOKEN=" + adminToken + "\n");
    const output = join(directory, "rotated");
    const result = await cli("create-reporter-token.mjs", ["--rotate", "test-host", "--output-dir", output],
      { STATUS_ADMIN_TOKEN: undefined, STATUS_ADMIN_URL: undefined, STATUS_ADMIN_ENV_FILE: file });
    expect(result.status, result.stderr).toBe(0);
    expect(calls[0]).toMatchObject({ method: "POST", url: "/api/v1/admin/reporters/test-host/token", body: undefined });
    expect(readFileSync(join(output, "token.env"), "utf8")).toContain(reporterToken);
  });

  it("configures components and updates reporters through the API without emitting SQL", async () => {
    const file = join(directory, "configuration.json");
    const components = [{ slug: "nas", group: "devices", name: "NAS's status" }];
    writeFileSync(file, JSON.stringify(components));
    const registration = await cli("register-status-components.mjs", [file]);
    expect(registration.status, registration.stderr).toBe(0);
    expect(calls[0]).toMatchObject({ method: "PUT", url: "/api/v1/admin/components", body: components });
    expect(registration.stdout).not.toContain("INSERT");
    writeFileSync(file, JSON.stringify({ enabled: false }));
    expect((await cli("update-reporter.mjs", ["test-host", file])).status).toBe(0);
    expect(calls[1]).toMatchObject({ method: "PATCH", url: "/api/v1/admin/reporters/test-host", body: { enabled: false } });
  });

  it("removes empty output after API errors and never prints a token-bearing error response", async () => {
    responseStatus = 401;
    const output = join(directory, "failed");
    const result = await cli("create-reporter-token.mjs", ["test-host", "nas", "--output-dir", output]);
    expect(result.status).not.toBe(0);
    expect(existsSync(output)).toBe(false);
    expect(result.stderr).toContain("HTTP 401");
    expect(result.stdout + result.stderr).not.toContain(reporterToken);
    expect(result.stdout + result.stderr).not.toContain(adminToken);
  });

  it("does not follow redirects or send credentials to insecure remote URLs", async () => {
    redirect = true;
    const output = join(directory, "redirect");
    expect((await cli("create-reporter-token.mjs", ["test-host", "nas", "--output-dir", output])).status).not.toBe(0);
    expect(calls).toHaveLength(1);
    expect(existsSync(output)).toBe(false);
    expect((await cli("create-reporter-token.mjs", ["test-host", "nas", "--output-dir", output],
      { STATUS_ADMIN_URL: "http://remote.example.test" })).status).not.toBe(0);
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["bad'id", "nas"], ["test-host", "bad'component"], [],
    ["test-host", "nas", "nas"], ["test-host", "nas", "--unknown"],
    ["--rotate", "test-host", "nas"],
    ["--rotate", "test-host", "--name", "Unexpected"], ["test-host", "--name", " "],
  ])("rejects malformed arguments before sending any API request: %j", async (...args) => {
    const result = await cli("create-reporter-token.mjs", [...args, "--output-dir", join(directory, "invalid")]);
    expect(result.status).not.toBe(0);
    expect(calls).toHaveLength(0);
    expect(result.stdout).toBe("");
  });

  it("creates a strong private admin secret without printing or overwriting it", async () => {
    const file = join(directory, "admin.env");
    const result = await cli("create-admin-secret.mjs", [file]);
    expect(result.status).toBe(0);
    const contents = readFileSync(file, "utf8");
    const secret = contents.match(/STATUS_ADMIN_TOKEN=([^\n]+)/)?.[1];
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(contents).toContain("STATUS_ADMIN_URL=" + origin);
    expect(contents).toContain("STATUS_PAGES_PROJECT=test-status-project");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect((await cli("create-admin-secret.mjs", [file])).status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe(contents);
  });

  it("requires an explicit server URL instead of falling back to the maintainer's production service", async () => {
    const envFile = join(directory, "admin.env");
    writeFileSync(envFile, "STATUS_ADMIN_TOKEN=" + adminToken + "\n");
    const result = await cli("create-reporter-token.mjs", ["test-host", "nas", "--output-dir", join(directory, "missing-origin")],
      { STATUS_ADMIN_URL: undefined, STATUS_ADMIN_ENV_FILE: envFile });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Set STATUS_ADMIN_URL");
    expect(calls).toHaveLength(0);
  });

  it("uploads the secret to the configured Pages project via stdin without exposing subprocess output", async () => {
    const envFile = join(directory, "admin.env");
    const recorded = join(directory, "upload.json");
    writeFileSync(envFile, "STATUS_ADMIN_TOKEN=" + adminToken + "\nSTATUS_PAGES_PROJECT=someone-elses-status\n");
    writeFileSync(join(directory, "pnpm"), `#!${process.execPath}\nconst fs=require('node:fs'); const secret=fs.readFileSync(0,'utf8'); fs.writeFileSync(process.env.TEST_UPLOAD, JSON.stringify({args:process.argv.slice(2),secret})); console.log(secret);`, { mode: 0o755 });
    const result = await cli("deploy-admin-secret.mjs", ["production", envFile], {
      STATUS_PAGES_PROJECT: undefined, TEST_UPLOAD: recorded, PATH: directory + ":" + process.env.PATH,
    });
    expect(result.status, result.stderr).toBe(0);
    const upload = JSON.parse(readFileSync(recorded, "utf8"));
    expect(upload.args).toEqual(["exec", "wrangler", "pages", "secret", "put", "STATUS_ADMIN_TOKEN", "--project-name", "someone-elses-status", "--env", "production"]);
    expect(upload.secret).toBe(adminToken);
    expect(upload.args.join(" ") + result.stdout + result.stderr).not.toContain(adminToken);
  });
});
