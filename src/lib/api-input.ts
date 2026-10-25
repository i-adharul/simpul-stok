import { z } from "zod";
import { ApiError, ERROR_CODES } from "./api-error";

type Schemas<B, Q, P> = {
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  params?: z.ZodType<P>;
};

type Parsed<B, Q, P> = { body: B; query: Q; params: P };

// Rule 4: validate on the server. Issues are small and safe to return: path + message only,
// never the rejected value (it may be a password).
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
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Data yang dikirim tidak valid.", [
      { source: "body", path: "", message: "Body must be valid JSON." },
    ]);
  }
}

// Validates body, query and route params together so all problems come back in one 400.
// Throws ApiError (caught by withApiLog). A schema that is not given yields `undefined`.
export async function parseInput<B = undefined, Q = undefined, P = undefined>(
  request: Request,
  context: { params?: Promise<unknown> } | undefined,
  schemas: Schemas<B, Q, P>,
): Promise<Parsed<B, Q, P>> {
  const issues: ReturnType<typeof issuesOf> = [];
  const out: Record<string, unknown> = {};

  async function check(source: string, schema: z.ZodType | undefined, load: () => unknown) {
    if (!schema) return;
    const result = schema.safeParse(await load());
    if (result.success) out[source] = result.data;
    else issues.push(...issuesOf(result.error, source));
  }

  await check("body", schemas.body, () => readJson(request));
  await check("query", schemas.query, () =>
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  await check("params", schemas.params, async () => (await context?.params) ?? {});

  if (issues.length > 0) {
    throw new ApiError(400, ERROR_CODES.VALIDATION_ERROR, "Data yang dikirim tidak valid.", issues);
  }
  return out as Parsed<B, Q, P>;
}
