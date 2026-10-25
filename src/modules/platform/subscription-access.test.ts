import { describe, expect, it } from "vitest";
import { ApiError, ERROR_CODES } from "../../lib/api-error";
import type { RequestContext } from "./request-context";
import { assertWritable, checkWritable, getAccessStatus } from "./subscription-access";

const ctx: RequestContext = {
  userId: "u1",
  organizationId: "org1",
  role: "OWNER",
  warehouseIds: [],
};

describe("getAccessStatus (temporary E2-07 hook)", () => {
  it("is always ACTIVE until E10 computes it from the subscription", async () => {
    await expect(getAccessStatus(ctx)).resolves.toBe("ACTIVE");
  });
});

describe("checkWritable", () => {
  it("allows writes while ACTIVE or GRACE", () => {
    expect(() => checkWritable("ACTIVE")).not.toThrow();
    expect(() => checkWritable("GRACE")).not.toThrow();
  });

  it.each(["READ_ONLY", "SUSPENDED"] as const)("rejects writes when %s", (status) => {
    try {
      checkWritable(status);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(403);
      expect((error as ApiError).code).toBe(ERROR_CODES.SUBSCRIPTION_READ_ONLY);
    }
  });
});

describe("assertWritable", () => {
  it("passes for now because the hook returns ACTIVE", async () => {
    await expect(assertWritable(ctx)).resolves.toBeUndefined();
  });
});
