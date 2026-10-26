import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { productFormSchema, skuConflictMessage } from "./product-form-schema";

const valid = { sku: "x", name: "Gula", unit: "kg", minStock: "0" };

describe("productFormSchema", () => {
  it("strips whitespace from the SKU, uppercases it and turns minStock into a number", () => {
    const result = productFormSchema.safeParse({
      sku: " ab 12 ",
      name: " Gula ",
      unit: "bks",
      minStock: "25",
    });
    expect(result.success && result.data).toEqual({
      sku: "AB12",
      name: "Gula",
      unit: "bks",
      minStock: 25,
    });
  });

  it("requires sku and name, with Indonesian messages", () => {
    const result = productFormSchema.safeParse({ ...valid, sku: " ", name: "", unit: "bks" });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "SKU wajib diisi.",
      "Nama wajib diisi.",
    ]);
  });

  it("rejects an unknown unit", () => {
    const result = productFormSchema.safeParse({ ...valid, unit: "kg" });
    expect(result.error?.issues[0]?.message).toBe("Pilih satuan.");
  });

  it.each(["", "-1", "1.5", "abc"])("rejects minStock %j", (minStock) => {
    const result = productFormSchema.safeParse({ ...valid, unit: "pcs", minStock });
    expect(result.error?.issues[0]?.message).toBe(
      "Batas minimum harus berupa bilangan bulat 0 atau lebih.",
    );
  });

  it("enforces the same maximum lengths as the API", () => {
    const result = productFormSchema.safeParse({
      sku: "A".repeat(51),
      name: "B".repeat(101),
      unit: "pcs",
      minStock: "0",
    });
    expect(result.error?.issues).toHaveLength(2);
  });
});

describe("skuConflictMessage", () => {
  it("returns the server message for a CONFLICT error", () => {
    expect(skuConflictMessage(new ApiError(409, "CONFLICT", "SKU sudah dipakai."))).toBe(
      "SKU sudah dipakai.",
    );
  });

  it("returns null for other errors, so the generic banner is shown", () => {
    expect(skuConflictMessage(new ApiError(400, "VALIDATION_ERROR", "At least one field"))).toBe(
      null,
    );
    expect(skuConflictMessage(new Error("network"))).toBe(null);
  });
});
