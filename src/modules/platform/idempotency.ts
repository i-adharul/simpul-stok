import { z } from "zod";
import { ApiError, ERROR_CODES, notFoundError } from "../../lib/api-error";
import { can, type Action } from "./can";
import type { RequestContext } from "./request-context";
import type { TenantClient } from "./tenant-client";

// Idempotency for retried stock writes (BL14, ADR 0012). The table `idempotency_keys` is the only
// source of truth: unique on (organizationId, key, endpoint), no cache. A repeated key replays the
// first result instead of acting a second time; the body of the repeated request is not compared.

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_REPLAYED_HEADER = "Idempotency-Replayed";

// What `work` receives: the tenant client bound to one transaction (the hook scopes it too).
export type TenantTransaction = Omit<TenantClient, "$transaction">;

// Prisma 7's defaults are maxWait 2 s (to get a connection) and timeout 5 s (for the whole transaction).
// A request that waits for a row lock or for the unique index of a concurrent twin (see runIdempotent)
// can wait longer than that under load, and a timeout would roll back a request that was fine. 10 s
// matches the pool's connection timeout (lib/db.ts).
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 10_000 } as const;

const keySchema = z.uuid();

// Called by withTenantRoute({ idempotent: true }) before the input is read. Lower case, so that
// "ABC..." and "abc..." are the same key.
export function parseIdempotencyKey(header: string | null): string {
  const parsed = keySchema.safeParse(header ?? "");
  if (!parsed.success) {
    throw new ApiError(
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Header Idempotency-Key wajib diisi dengan UUID yang valid.",
      [
        {
          source: "header",
          path: IDEMPOTENCY_KEY_HEADER,
          message: header === null ? "Header is required." : "Header must be a UUID.",
        },
      ],
    );
  }
  return parsed.data.toLowerCase();
}

export type IdempotentRun<T> = {
  // The business effect. Runs in the transaction and returns the ID of what it created. It must not
  // return the response: the response is always built from `load`, so the first call and a replay
  // cannot differ.
  work: (tx: TenantTransaction) => Promise<string>;
  // Loads the created resource through the tenant client.
  load: (db: TenantClient, resourceId: string) => Promise<T>;
  // A replay must not hand one user's result to a user who may not see it, so the loaded resource is
  // checked again: `action` for the warehouse that owns it. If not allowed: 404, the same as missing.
  access: { ctx: RequestContext; action: Action; warehouseIdOf: (resource: T) => string };
};

export type IdempotentOutcome<T> = { result: T; replayed: boolean };

async function findStoredKey(
  db: TenantClient,
  key: string,
  endpoint: string,
): Promise<string | null> {
  const row = await db.idempotencyKey.findFirst({ where: { key, endpoint } });
  return row?.resourceId ?? null;
}

// The handler must call authorize() BEFORE this (ADR 0012): the pre-check below answers from the
// table, so a caller who is not allowed to act must be turned away first, not shown a replay.
//
// 1. Pre-check: the key exists, so replay. The ordinary retry; no business effect runs.
// 2. Otherwise `work` and the key row run in ONE transaction. resourceId is NOT NULL, so the key row
//    is the LAST statement: if a concurrent request with the same key committed first, this insert
//    waits on the unique index, fails with P2002 once that one commits, and the whole transaction,
//    including `work`, rolls back.
// 3. If the transaction fails for ANY reason and the key exists now, a twin finished first: replay.
//    P2002 is only one such failure. `work` of the second request runs on top of the first one's
//    committed data and can fail first (for example INSUFFICIENT_STOCK), before it reaches the key
//    insert. If the key does not exist, the error is genuine and is thrown as it was.
export async function runIdempotent<T>(
  db: TenantClient,
  scope: { key: string; endpoint: string },
  run: IdempotentRun<T>,
): Promise<IdempotentOutcome<T>> {
  const { key, endpoint } = scope;
  let resourceId = await findStoredKey(db, key, endpoint);
  let replayed = resourceId !== null;

  if (resourceId === null) {
    try {
      resourceId = await db.$transaction(async (tx) => {
        const id = await run.work(tx);
        // organizationId is required by the type; the tenant client sets it from the session anyway.
        const organizationId = run.access.ctx.organizationId;
        await tx.idempotencyKey.create({ data: { organizationId, key, endpoint, resourceId: id } });
        return id;
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      // A failed lookup must not hide the original error.
      const winner = await findStoredKey(db, key, endpoint).catch(() => null);
      if (winner === null) throw error;
      resourceId = winner;
      replayed = true;
    }
  }

  // First call and replay both answer from the stored resource.
  const result = await run.load(db, resourceId);
  const { ctx, action, warehouseIdOf } = run.access;
  if (!can(ctx, action, { warehouseId: warehouseIdOf(result) })) throw notFoundError();
  return { result, replayed };
}

// Adds the replay header to the response built from the outcome.
export function markReplayed(response: Response, replayed: boolean): Response {
  if (replayed) response.headers.set(IDEMPOTENCY_REPLAYED_HEADER, "true");
  return response;
}
