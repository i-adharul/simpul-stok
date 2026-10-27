import { describe, expect, it } from "vitest";
import { buildStatusWhere, stockStatusOf } from "./stock-status";

describe("stockStatusOf", () => {
  it.each([
    [0, 5, "OUT"],
    [0, 0, "OUT"],
    [1, 5, "LOW"],
    [4, 5, "LOW"],
    [5, 5, "OK"],
    [6, 5, "OK"],
    [1, 0, "OK"],
    [1, 1, "OK"],
    [2, 2, "OK"],
    [1, 2, "LOW"],
  ] as const)("quantity %i with minStock %i is %s", (quantity, minStock, status) => {
    expect(stockStatusOf(quantity, minStock)).toBe(status);
  });
});

describe("buildStatusWhere", () => {
  it("matches nothing for LOW when minStock is only 0 or 1", () => {
    expect(buildStatusWhere("LOW", [0, 1])).toEqual({ id: { in: [] } });
  });

  it("builds one branch per distinct minStock", () => {
    expect(buildStatusWhere("OK", [0, 3])).toEqual({
      OR: [
        { product: { minStock: 0 }, quantity: { gte: 1 } },
        { product: { minStock: 3 }, quantity: { gte: 3 } },
      ],
    });
  });
});
