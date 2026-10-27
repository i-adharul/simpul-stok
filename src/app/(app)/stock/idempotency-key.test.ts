import { describe, expect, it } from "vitest";
import { nextIdempotencyKey } from "./idempotency-key";

const base = { warehouseId: "w1", productId: "p1", quantity: 5, note: "a" };

function keys() {
  let n = 0;
  return () => `key-${++n}`;
}

describe("nextIdempotencyKey", () => {
  it("creates a key on the first attempt", () => {
    expect(nextIdempotencyKey(null, base, keys()).key).toBe("key-1");
  });

  it("reuses the key for an identical retry", () => {
    const newKey = keys();
    const first = nextIdempotencyKey(null, base, newKey);
    const retry = nextIdempotencyKey(first, { ...base }, newKey);
    expect(retry.key).toBe(first.key);
  });

  it("ignores property order and a missing versus undefined note", () => {
    const newKey = keys();
    const first = nextIdempotencyKey(
      null,
      { quantity: 5, warehouseId: "w1", note: undefined },
      newKey,
    );
    const retry = nextIdempotencyKey(first, { warehouseId: "w1", quantity: 5 }, newKey);
    expect(retry.key).toBe(first.key);
  });

  it.each([
    ["quantity", { quantity: 6 }],
    ["warehouse", { warehouseId: "w2" }],
    ["note", { note: "b" }],
  ])("uses a fresh key when the %s changes", (_name, change) => {
    const newKey = keys();
    const first = nextIdempotencyKey(null, base, newKey);
    expect(nextIdempotencyKey(first, { ...base, ...change }, newKey).key).not.toBe(first.key);
  });

  it("uses a fresh key after change then change back", () => {
    const newKey = keys();
    const a = nextIdempotencyKey(null, base, newKey);
    const b = nextIdempotencyKey(a, { ...base, quantity: 9 }, newKey);
    const back = nextIdempotencyKey(b, base, newKey);
    expect(back.key).not.toBe(a.key);
    expect(back.key).not.toBe(b.key);
  });
});
