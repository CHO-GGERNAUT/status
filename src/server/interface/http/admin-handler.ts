import { configureComponents, createReporter, rotateReporterToken, updateReporter } from "../../application/status/manage-reporters";
import { StatusApplicationError } from "../../application/status/application-error";
import { constantTimeEqual, sha256Hex } from "../../infrastructure/auth/token-crypto";
import { WebCryptoReporterTokenIssuer } from "../../infrastructure/auth/web-crypto-reporter-token-issuer";
import { D1ReporterManagementRepository } from "../../infrastructure/d1/d1-reporter-management-repository";
import type { StatusEnvironment } from "./environment";
import { errorResponse, jsonResponse, methodNotAllowed } from "./http-response";

type AdminAction = "components" | "create-reporter" | "update-reporter" | "rotate-token";
const METHODS: Record<AdminAction, string> = {
  components: "PUT", "create-reporter": "POST", "update-reporter": "PATCH", "rotate-token": "POST",
};

export async function handleAdminRequest(
  request: Request,
  environment: StatusEnvironment,
  action: AdminAction,
  reporterId = "",
): Promise<Response> {
  let response: Response;
  try {
    if (request.method !== METHODS[action]) return privateResponse(methodNotAllowed(METHODS[action]));
    await authenticateAdmin(request, environment.STATUS_ADMIN_TOKEN);
    const repository = new D1ReporterManagementRepository(environment.STATUS_DB);
    const tokens = new WebCryptoReporterTokenIssuer();
    if (action === "components") {
      const count = await configureComponents(await readJson(request), repository, Math.floor(Date.now() / 1000));
      response = jsonResponse({ updatedComponents: count });
    } else if (action === "create-reporter") {
      const result = await createReporter(await readJson(request), repository, tokens, Math.floor(Date.now() / 1000));
      response = jsonResponse(result, { status: 201 });
    } else if (action === "update-reporter") {
      response = jsonResponse(await updateReporter(reporterId, await readJson(request), repository));
    } else {
      response = jsonResponse(await rotateReporterToken(reporterId, repository, tokens));
    }
  } catch (error) {
    response = errorResponse(error);
  }
  return privateResponse(response);
}

async function authenticateAdmin(request: Request, secret: string | undefined) {
  if (secret === undefined || secret.length < 32) throw new StatusApplicationError("unavailable", "Reporter administration is not configured");
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ") || header.length > 512) throw new StatusApplicationError("unauthorized", "Admin token is required");
  const [expected, actual] = await Promise.all([sha256Hex(secret), sha256Hex(header.slice(7).trim())]);
  if (!constantTimeEqual(expected, actual)) throw new StatusApplicationError("unauthorized", "Invalid admin token");
}

async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new StatusApplicationError("invalid_input", "Content-Type must be application/json");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new StatusApplicationError("invalid_input", "JSON body is required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16 * 1024) {
      await reader.cancel();
      throw new StatusApplicationError("invalid_input", "Request body is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new StatusApplicationError("invalid_input", "Invalid JSON body");
  }
}

function privateResponse(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
