import { describe, expect, it } from "vitest";
import { warehouseFormSchema } from "./warehouse-form-schema";

describe("warehouseFormSchema", () => {
  it("trims, uppercases the code and turns an empty address into an empty string", () => {
    const result = warehouseFormSchema.safeParse({
      code: " gd-01 ",
      name: " Pusat ",
      address: "  ",
    });
    expect(result.success && result.data).toEqual({ code: "GD-01", name: "Pusat", address: "" });
  });

  it("requires code and name, with Indonesian messages", () => {
    const result = warehouseFormSchema.safeParse({ code: " ", name: "", address: "" });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "Kode wajib diisi.",
      "Nama wajib diisi.",
    ]);
  });

  it("enforces the same maximum lengths as the API", () => {
    const result = warehouseFormSchema.safeParse({
      code: "A".repeat(21),
      name: "B".repeat(101),
      address: "C".repeat(256),
    });
    expect(result.error?.issues).toHaveLength(3);
  });
});
