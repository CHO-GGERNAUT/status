import type {
  ComponentStatus,
  HeartbeatObservationRequest,
  HeartbeatRequest,
} from "../../../contracts/status-api";
import { StatusApplicationError } from "../../application/status/application-error";
import { recordHeartbeat } from "../../application/status/record-heartbeat";
import { D1ReporterAuthenticator } from "../../infrastructure/auth/d1-reporter-authenticator";
import { D1StatusRepository } from "../../infrastructure/d1/d1-status-repository";
import type { StatusEnvironment } from "./environment";
import { errorResponse, jsonResponse, methodNotAllowed } from "./http-response";

const MAX_BODY_BYTES = 8 * 1024;
const VALID_STATUSES = new Set<ComponentStatus>(["operational", "degraded", "outage"]);

export async function handleHeartbeatRequest(
  request: Request,
  environment: StatusEnvironment,
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }

  try {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      throw new StatusApplicationError("invalid_input", "Request body is too large");
    }

    const authorization = request.headers.get("Authorization");
    if (authorization === null || !authorization.startsWith("Bearer ")) {
      throw new StatusApplicationError("unauthorized", "Reporter token is required");
    }

    const body = parseHeartbeatRequest(await request.json());
    const result = await recordHeartbeat(
      {
        bearerToken: authorization.slice("Bearer ".length).trim(),
        sequence: body.sequence,
        observations: body.observations,
        receivedAt: Math.floor(Date.now() / 1000),
      },
      {
        authenticator: new D1ReporterAuthenticator(environment.STATUS_DB),
        repository: new D1StatusRepository(environment.STATUS_DB),
      },
    );

    return jsonResponse(result, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}

function parseHeartbeatRequest(value: unknown): HeartbeatRequest {
  if (!isObject(value) || !Number.isSafeInteger(value.sequence) || !Array.isArray(value.observations)) {
    throw new StatusApplicationError("invalid_input", "Invalid heartbeat request");
  }

  const observations: HeartbeatObservationRequest[] = value.observations.map((item) => {
    if (
      !isObject(item) ||
      typeof item.component !== "string" ||
      typeof item.status !== "string" ||
      !VALID_STATUSES.has(item.status as ComponentStatus) ||
      (item.message !== undefined && typeof item.message !== "string")
    ) {
      throw new StatusApplicationError("invalid_input", "Invalid heartbeat observation");
    }

    return {
      component: item.component,
      status: item.status as ComponentStatus,
      ...(item.message === undefined ? {} : { message: item.message }),
    };
  });

  return { sequence: value.sequence as number, observations };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
