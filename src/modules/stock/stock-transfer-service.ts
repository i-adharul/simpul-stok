import type { IdempotentOutcome } from "../platform/idempotency";
import type { RequestContext } from "../platform/request-context";
import type { TenantClient } from "../platform/tenant-client";
import type { TransferBody } from "./stock-schema";

// Immutable data only, never stock balances (BL14): a replay must equal the first answer.
export type TransferResponse = {
  id: string;
  code: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  items: { productId: string; quantity: number }[];
  note: string | null;
  createdAt: string;
};

// Stub for the failing tests of E5-01 and E5-02; the real service replaces it in the same pull request.
export async function transferStock(
  _db: TenantClient,
  _ctx: RequestContext,
  _key: string,
  _body: TransferBody,
): Promise<IdempotentOutcome<TransferResponse>> {
  throw new Error("transferStock is not implemented yet");
}
