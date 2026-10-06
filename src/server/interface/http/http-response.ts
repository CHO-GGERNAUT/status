import type { ApiErrorResponse } from "../../../contracts/status-api";
import { StatusApplicationError, type ApplicationErrorCode } from "../../application/status/application-error";

const ERROR_STATUS: Record<ApplicationErrorCode, number> = {
  unauthorized: 401, conflict: 409, not_found: 404,
  unavailable: 503, invalid_input: 400, internal_error: 500,
};

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  return Response.json(body, { ...init, headers });
}

export function methodNotAllowed(allowed: string): Response {
  return jsonResponse(
    { error: "method_not_allowed", message: "Method not allowed" } satisfies ApiErrorResponse,
    { status: 405, headers: { Allow: allowed } },
  );
}

export function errorResponse(error: unknown): Response {
  if (error instanceof StatusApplicationError) {
    const status = ERROR_STATUS[error.code];
    return jsonResponse(
      {
        error: error.code,
        message: error.code === "internal_error" ? "Internal server error" : error.message,
      } satisfies ApiErrorResponse,
      { status },
    );
  }

  console.error("Unhandled status API error", error);
  return jsonResponse(
    { error: "internal_error", message: "Internal server error" } satisfies ApiErrorResponse,
    { status: 500 },
  );
}
