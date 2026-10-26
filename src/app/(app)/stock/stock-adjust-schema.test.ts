import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { adjustErrorMessage, stockAdjustSchema } from "./stock-adjust-schema";

const base = {
  warehouseId: "00000000-0000-7000-8000-000000000001",
  productId: "00000000-0000-7000-8000-000000000002",
  reason: "STOCK_OPNAME",
  note: "",
};

describe("stockAdjustSchema", () => {
  it("turns SET text into a number and an empty note into undefined", () => {
    const result = stockAdjustSchema.safeParse({ ...base, mode: "SET", value: " 0 " });
    expect(result.success && result.data).toEqual({
      ...base,
      mode: "SET",
      value: 0,
      note: undefined,
    });
  });

  it.each(["", "-1", "1,5", "abc", "1000001"])("rejects SET value %j", (value) => {
    const result = stockAdjustSchema.safeParse({ ...base, mode: "SET", value });
    expect(result.error?.issues[0]?.path).toEqual(["value"]);
  });

  it.each(["-5", "5", "+3", "1000000", "-1000000"])("accepts DELTA value %j", (value) => {
    expect(stockAdjustSchema.safeParse({ ...base, mode: "DELTA", value }).success).toBe(true);
  });

  it.each(["", "0", "-0", "1.5", "x", "1000001", "-1000001"])("rejects DELTA value %j", (value) => {
    const result = stockAdjustSchema.safeParse({ ...base, mode: "DELTA", value });
    expect(result.error?.issues[0]?.path).toEqual(["value"]);
  });

  it("requires a reason, a warehouse and a product", () => {
    const result = stockAdjustSchema.safeParse({
      warehouseId: "",
      productId: "",
      reason: "",
      mode: "SET",
      value: "1",
      note: "",
    });
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual([
      "productId",
      "reason",
      "warehouseId",
    ]);
  });

  it("rejects a note over 255 characters", () => {
    const result = stockAdjustSchema.safeParse({
      ...base,
      mode: "SET",
      value: "1",
      note: "x".repeat(256),
    });
    expect(result.error?.issues[0]?.path).toEqual(["note"]);
  });
});

describe("adjustErrorMessage", () => {
  it("maps statuses to Indonesian text", () => {
    expect(adjustErrorMessage(new ApiError(403, "FORBIDDEN", "x")).message).toMatch(/akses/);
    expect(adjustErrorMessage(new ApiError(404, "NOT_FOUND", "x")).message).toMatch(
      /tidak ditemukan/,
    );
    expect(adjustErrorMessage(new ApiError(409, "CONFLICT", "Stok habis"))).toEqual({
      message: "Stok habis",
    });
    expect(adjustErrorMessage(new ApiError(400, "VALIDATION_ERROR", "Selisih"))).toEqual({
      field: "value",
      message: "Selisih",
    });
    expect(adjustErrorMessage(new Error("boom")).message).toMatch(/coba lagi/);
  });
});
