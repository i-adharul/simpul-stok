import { describe, expect, it } from "vitest";
import { parseMovementSearchParams } from "./movement-search-params";

const ID = "3f2b8c1e-5a4d-4e7b-9c1a-0d2e4f6a8b10";

describe("parseMovementSearchParams", () => {
  it("keeps a valid warehouse, product and type", () => {
    expect(parseMovementSearchParams({ warehouseId: ID, productId: ID, type: "RECEIVE" })).toEqual({
      warehouseId: ID,
      productId: ID,
      type: "RECEIVE",
    });
  });

  it("drops values that are not a UUID or a known type", () => {
    expect(
      parseMovementSearchParams({ warehouseId: "x", productId: "1 OR 1", type: "NOPE" }),
    ).toEqual({ warehouseId: "", productId: "", type: "" });
  });

  it("rejects names inherited from Object.prototype as a type", () => {
    expect(parseMovementSearchParams({ type: "constructor" }).type).toBe("");
    expect(parseMovementSearchParams({ type: "__proto__" }).type).toBe("");
  });

  it("uses the first value of a repeated parameter and ignores a missing one", () => {
    expect(parseMovementSearchParams({ warehouseId: [ID, "x"] })).toEqual({
      warehouseId: ID,
      productId: "",
      type: "",
    });
  });
});
