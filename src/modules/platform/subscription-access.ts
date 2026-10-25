import { ApiError, ERROR_CODES } from "../../lib/api-error";
import type { RequestContext } from "./request-context";

// BL23 stage 1: the write-path hook for subscription access (docs/02).
export type AccessStatus = "ACTIVE" | "GRACE" | "READ_ONLY" | "SUSPENDED";

// REPLACEMENT POINT (E10): compute the status per request from Organization.status,
// currentPeriodEnd and graceUntil (BL23). Until then every organization is ACTIVE.
// Keep the signature: only this function body changes, so no route handler needs to be edited.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- E10 reads ctx.organizationId
export async function getAccessStatus(_ctx: RequestContext): Promise<AccessStatus> {
  return "ACTIVE";
}

// Pure rule: ACTIVE and GRACE (a warning only) may write; READ_ONLY and SUSPENDED may not.
export function checkWritable(status: AccessStatus): void {
  if (status === "READ_ONLY" || status === "SUSPENDED") {
    throw new ApiError(
      403,
      ERROR_CODES.SUBSCRIPTION_READ_ONLY,
      "Langganan Anda sedang dalam mode baca saja. Perbarui langganan untuk mengubah data.",
    );
  }
}

// Every tenant WRITE route calls this after getRequestContext. Billing endpoints, logout and
// password change must NOT call it: BL23 keeps them allowed in every condition.
export async function assertWritable(ctx: RequestContext): Promise<void> {
  checkWritable(await getAccessStatus(ctx));
}
