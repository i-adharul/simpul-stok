import type { PrismaClient } from "../../generated/prisma/client";
import {
  withApiLog,
  type ApiInput,
  type ApiOptions,
  type RouteContext,
} from "../../lib/api-handler";
import { db } from "../../lib/db";
import { env } from "../../lib/env";
import { getRequestContext, type RequestContext } from "./request-context";
import { createTenantClient, type TenantClient } from "./tenant-client";

// What a tenant handler receives next to the validated input: who is asking, and the only database
// client it may use (rule 3).
export type TenantRouteArgs = { ctx: RequestContext; db: TenantClient };

type TenantRouteOptions = Omit<ApiOptions, "guard">;

type TenantHandler<O extends TenantRouteOptions, Context extends RouteContext> = (
  request: Request,
  input: ApiInput<O>,
  tenant: TenantRouteArgs,
  context: Context,
) => Promise<Response> | Response;

// The route helper for every endpoint of a signed-in organization. Order of checks:
//   1. the request context from the session cookie (401 unauthenticated, 403 platform admin),
//   2. the input (400),
//   3. the handler.
// The context comes first so a caller without access learns nothing about the body. The Prisma
// client is injected so tests can use the test database; withTenantRoute below wires the real one.
export function createTenantRoute(deps: { prisma: PrismaClient; secret: string }) {
  async function guard(request: Request): Promise<TenantRouteArgs> {
    const ctx = await getRequestContext(deps.prisma, deps.secret, request);
    return { ctx, db: createTenantClient(deps.prisma, ctx) };
  }

  return function withTenantRoute<
    const O extends TenantRouteOptions = TenantRouteOptions,
    Context extends RouteContext = RouteContext,
  >(handler: TenantHandler<O, Context>, options: O = {} as O) {
    return withApiLog<O & { guard: typeof guard }, Context>(
      (request, input, context, tenant) =>
        handler(request, input as ApiInput<O>, tenant as TenantRouteArgs, context),
      { ...options, guard } as O & { guard: typeof guard },
    );
  };
}

// Plain client on purpose: the context and the tenant client are built from it, per request.
export const withTenantRoute = createTenantRoute({ prisma: db, secret: env.SESSION_SECRET });
