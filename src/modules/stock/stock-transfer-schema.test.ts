import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { transferBody } from "./stock-schema";

const from = randomUUID();
const to = randomUUID();
const item = (quantity: unknown = 1) => ({ productId: randomUUID(), quantity });
const valid = (overrides: Record<string, unknown> = {}) => ({
  fromWarehouseId: from,
  toWarehouseId: to,
  items: [item()],
  ...overrides,
});

describe("transferBody", () => {
  it("accepts one item and fifty items, and turns an empty note into null", () => {
    expect(transferBody.safeParse(valid()).success).toBe(true);
    const fifty = Array.from({ length: 50 }, () => item());
    expect(transferBody.safeParse(valid({ items: fifty })).success).toBe(true);
    expect(transferBody.parse(valid({ note: "  " })).note).toBeNull();
  });

  it("rejects no items and fifty-one items", () => {
    expect(transferBody.safeParse(valid({ items: [] })).success).toBe(false);
    const many = Array.from({ length: 51 }, () => item());
    expect(transferBody.safeParse(valid({ items: many })).success).toBe(false);
  });

  it("rejects a product that appears twice", () => {
    const one = item();
    const result = transferBody.safeParse(valid({ items: [one, { ...one, quantity: 2 }] }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["items", 1, "productId"]);
  });

  it.each([0, -1, 1_000_001, 1.5, "5", null])("rejects quantity %j", (quantity) => {
    expect(transferBody.safeParse(valid({ items: [item(quantity)] })).success).toBe(false);
  });

  it("accepts the quantity boundaries 1 and 1,000,000", () => {
    expect(transferBody.safeParse(valid({ items: [item(1), item(1_000_000)] })).success).toBe(true);
  });

  it("rejects the same source and destination", () => {
    expect(transferBody.safeParse(valid({ toWarehouseId: from })).success).toBe(false);
  });

  it("rejects organizationId and any other unknown field, at the top level and in an item", () => {
    expect(transferBody.safeParse(valid({ organizationId: randomUUID() })).success).toBe(false);
    const withExtra = { productId: randomUUID(), quantity: 1, organizationId: randomUUID() };
    expect(transferBody.safeParse(valid({ items: [withExtra] })).success).toBe(false);
  });
});
