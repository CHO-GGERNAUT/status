import { getPublicStatus } from "../../application/status/get-public-status";
import { D1StatusRepository } from "../../infrastructure/d1/d1-status-repository";
import type { StatusEnvironment } from "./environment";
import { errorResponse, jsonResponse, methodNotAllowed } from "./http-response";

export async function handleStatusRequest(
  request: Request,
  environment: StatusEnvironment,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD");
  }

  try {
    const status = await getPublicStatus(
      { now: Math.floor(Date.now() / 1000) },
      new D1StatusRepository(environment.STATUS_DB),
    );
    const response = jsonResponse(status, {
      headers: {
        "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=120",
      },
    });
    return request.method === "HEAD" ? new Response(null, response) : response;
  } catch (error) {
    return errorResponse(error);
  }
}
