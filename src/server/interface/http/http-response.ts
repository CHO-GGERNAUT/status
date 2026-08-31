import type { ApiErrorResponse } from "../../../contracts/status-api";
import { StatusApplicationError } from "../../application/status/application-error";

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
    const status =
      error.code === "unauthorized"
        ? 401
        : error.code === "conflict"
          ? 409
          : error.code === "invalid_input"
            ? 400
            : 500;
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
