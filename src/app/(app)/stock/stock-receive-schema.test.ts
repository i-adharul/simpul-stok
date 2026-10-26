import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import { receiveErrorMessage, stockReceiveSchema } from "./stock-receive-schema";

const ids = {
  warehouseId: "00000000-0000-7000-8000-000000000001",
  productId: "00000000-0000-7000-8000-000000000002",
};

describe("stockReceiveSchema", () => {
  it("turns the quantity text into a number and an empty note into undefined", () => {
    const result = stockReceiveSchema.safeParse({ ...ids, quantity: " 24 ", note: "  " });
    expect(result.success && result.data).toEqual({ ...ids, quantity: 24, note: undefined });
  });

  it.each(["", "0", "-1", "1,5", "abc", "1000001"])("rejects quantity %j", (quantity) => {
    const result = stockReceiveSchema.safeParse({ ...ids, quantity, note: "" });
    expect(result.error?.issues[0]?.path).toEqual(["quantity"]);
  });

  it("accepts the limits 1 and 1.000.000", () => {
    expect(stockReceiveSchema.safeParse({ ...ids, quantity: "1", note: "" }).success).toBe(true);
    expect(stockReceiveSchema.safeParse({ ...ids, quantity: "1000000", note: "" }).success).toBe(
      true,
    );
  });

  it("requires a warehouse and a product", () => {
    const result = stockReceiveSchema.safeParse({
      warehouseId: "",
      productId: "",
      quantity: "1",
      note: "",
    });
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
      "warehouseId",
      "productId",
    ]);
  });

  it("limits the note to 255 characters", () => {
    const result = stockReceiveSchema.safeParse({
      ...ids,
      quantity: "1",
      note: "x".repeat(256),
    });
    expect(result.error?.issues[0]?.path).toEqual(["note"]);
  });
});

describe("receiveErrorMessage", () => {
  it("maps 403 and 404 to Indonesian messages", () => {
    expect(receiveErrorMessage(new ApiError(403, "FORBIDDEN", "x"))).toEqual({
      message: "Anda tidak punya akses ke gudang ini.",
    });
    expect(receiveErrorMessage(new ApiError(404, "NOT_FOUND", "x")).message).toBe(
      "Produk atau gudang tidak ditemukan.",
    );
  });

  it("keeps the server message for 409 (archived, or quantity limit)", () => {
    expect(receiveErrorMessage(new ApiError(409, "CONFLICT", "Produk sudah diarsipkan."))).toEqual({
      message: "Produk sudah diarsipkan.",
    });
  });

  it("puts a 400 under the quantity field", () => {
    expect(receiveErrorMessage(new ApiError(400, "VALIDATION_ERROR", "x"))).toEqual({
      field: "quantity",
      message: "Jumlah harus bilangan bulat antara 1 dan 1.000.000.",
    });
  });

  it("falls back to a generic message", () => {
    expect(receiveErrorMessage(new Error("network")).message).toBe(
      "Stok belum dapat dicatat. Silakan coba lagi.",
    );
  });
});
