import { errorFields, log } from "./logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

type ApiHandler = (request: Request) => Promise<Response> | Response;

// Wraps a Route Handler because only here the final status and duration are known (the proxy runs
// before the handler). It also turns an unhandled error into the BL29 format without a stack.
export function withApiLog(handler: ApiHandler): ApiHandler {
  return async (request) => {
    const startedAt = performance.now();
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const base = { requestId, method: request.method, path: new URL(request.url).pathname };

    let response: Response;
    let failure: Record<string, unknown> = {};
    try {
      response = await handler(request);
    } catch (error) {
      failure = errorFields(error);
      response = Response.json(
        { code: "INTERNAL_ERROR", message: "Terjadi kesalahan pada server.", details: null },
        { status: 500 },
      );
    }

    response.headers.set(REQUEST_ID_HEADER, requestId);
    log(response.status >= 500 ? "error" : "info", "api.request", {
      ...base,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      ...failure,
    });
    return response;
  };
}
