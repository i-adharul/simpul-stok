import { z } from "zod";
import { ApiError, ERROR_CODES, internalError } from "./api-error";
import { errorFields, log } from "./logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

export const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Schema = z.ZodType;

export type ApiOptions = {
  // Route pattern such as "/api/invitations/[token]". Required for dynamic routes: the real
  // pathname can carry a secret (an invitation token) and must not reach the log.
  route?: string;
  // Rule 4: input is validated here, before the handler runs. A write route (POST, PUT, PATCH,
  // DELETE) must decide about its body: a schema, or "none" when it takes no body.
  body?: Schema | "none";
  query?: Schema;
  params?: Schema;
  // For credentials: replace the default message and drop `details`, so the response cannot
  // describe the rules a value failed (for example password rules).
  invalidMessage?: string;
  hideIssues?: boolean;
  // Runs BEFORE the input is read or validated, so a caller who may not use the route (401, 403)
  // learns nothing about its body. Its result reaches the handler as the 4th argument. Used by
  // withTenantRoute to resolve the request context first.
  guard?: (request: Request) => Promise<unknown>;
};

type Output<S> = S extends Schema ? z.output<S> : undefined;

// What the handler receives. A source without a schema is `undefined`.
export type ApiInput<O extends ApiOptions> = {
  body: Output<O["body"]>;
  query: Output<O["query"]>;
  params: Output<O["params"]>;
};

// What the guard returned. A route without a guard gets `undefined`.
type Guarded<O extends ApiOptions> = O["guard"] extends (request: Request) => Promise<infer G>
  ? G
  : undefined;

// Route context of the Next.js App Router (only `params` is used here).
export type RouteContext = { params: Promise<unknown> };

const INVALID_MESSAGE = "Data yang dikirim tidak valid.";

// Issues carry path + message only, never the rejected value (it may be a password).
function issuesOf(error: z.ZodError, source: string) {
  return error.issues.map((issue) => ({
    source,
    path: issue.path.join("."),
    message: issue.message,
  }));
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, INVALID_MESSAGE, [
      { source: "body", path: "", message: "Body must be valid JSON." },
    ]);
  }
}

// Validates body, query and route params together so all problems come back in one 400.
// Throws ApiError, which withApiLog maps to the response.
async function parseInput(
  request: Request,
  context: RouteContext | undefined,
  options: ApiOptions,
): Promise<Record<"body" | "query" | "params", unknown>> {
  const issues: ReturnType<typeof issuesOf> = [];
  const out: Record<"body" | "query" | "params", unknown> = {
    body: undefined,
    query: undefined,
    params: undefined,
  };
  const body = options.body === "none" ? undefined : options.body;

  async function check(source: keyof typeof out, schema: Schema | undefined, load: () => unknown) {
    if (!schema) return;
    let value: unknown;
    try {
      value = await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      issues.push(...(error.details as typeof issues));
      return;
    }
    const result = schema.safeParse(value);
    if (result.success) out[source] = result.data;
    else issues.push(...issuesOf(result.error, source));
  }

  await check("body", body, () => readJson(request));
  await check("query", options.query, () =>
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  await check("params", options.params, async () => (await context?.params) ?? {});

  if (issues.length > 0) {
    throw new ApiError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      options.invalidMessage ?? INVALID_MESSAGE,
      options.hideIssues ? null : issues,
    );
  }
  return out;
}

// Fail closed: a write route with no validation decision is a coding mistake, never a request error.
export function hasValidationDecision(method: string, options: ApiOptions): boolean {
  return !WRITE_METHODS.has(method) || options.body !== undefined;
}

// A route file under a dynamic segment ("[token]") must pass its route pattern, because the real
// pathname can carry a secret. Checked by route-validation.test.ts.
export function hasRouteLabel(routeFile: string, options: ApiOptions): boolean {
  return !/\[[^\]]+\]/.test(routeFile) || options.route !== undefined;
}

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
// before the handler). It also validates the input first, so no handler can forget to, and turns an
// unhandled error into the BL29 format without a stack.
// The handler receives (request, validated input, route context, guard result).
export function withApiLog<
  const O extends ApiOptions = ApiOptions,
  Context extends RouteContext = RouteContext,
>(
  handler: (
    request: Request,
    input: ApiInput<O>,
    context: Context,
    guarded: Guarded<O>,
  ) => Promise<Response> | Response,
  options: O = {} as O,
): ((request: Request, context?: Context) => Promise<Response>) & { apiOptions: O } {
  const wrapped = async (request: Request, context?: Context): Promise<Response> => {
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
      if (!hasValidationDecision(request.method, options)) {
        throw new Error(`${request.method} ${base.path} has no body validation decision`);
      }
      const guarded = (await options.guard?.(request)) as Guarded<O>;
      const input = (await parseInput(request, context, options)) as ApiInput<O>;
      response = await handler(request, input, context as Context, guarded);
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
  // Exposed so a test can check every route module (see route-validation.test.ts).
  return Object.assign(wrapped, { apiOptions: options });
}
