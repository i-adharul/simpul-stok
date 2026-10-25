import { ApiError, internalError } from "./api-error";
import { errorFields, log } from "./logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

type ApiOptions = {
  // Route pattern such as "/api/invitations/[token]". Required for dynamic routes: the real
  // pathname can carry a secret (an invitation token) and must not reach the log.
  route?: string;
};

// Sets the header, or on a copy when the response is immutable (a Response from fetch or
// Response.redirect). The copy keeps status, statusText, headers and body.
function withRequestId(response: Response, requestId: string): Response {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.set(REQUEST_ID_HEADER, requestId);
    return copy;
  }
}

// Wraps a Route Handler because only here the final status and duration are known (the proxy runs
// before the handler). It also turns an unhandled error into the BL29 format without a stack.
// Every argument after the request (the Next.js route context with `params`) is passed through.
export function withApiLog<Args extends unknown[]>(
  handler: (request: Request, ...args: Args) => Promise<Response> | Response,
  options: ApiOptions = {},
): (request: Request, ...args: Args) => Promise<Response> {
  return async (request, ...args) => {
    const startedAt = performance.now();
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const base = {
      requestId,
      method: request.method,
      path: options.route ?? new URL(request.url).pathname,
    };

    let response: Response;
    let failure: Record<string, unknown> = {};
    try {
      response = await handler(request, ...args);
    } catch (error) {
      if (error instanceof ApiError) {
        // Expected failure (validation, 404, 409...): map it, no error log fields.
        response = error.toResponse();
      } else {
        failure = errorFields(error);
        response = internalError();
      }
    }

    response = withRequestId(response, requestId);
    log(response.status >= 500 ? "error" : "info", "api.request", {
      ...base,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
      ...failure,
    });
    return response;
  };
}
