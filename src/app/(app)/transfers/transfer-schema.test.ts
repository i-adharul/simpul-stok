import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client";
import {
  MAX_TRANSFER_ITEMS,
  transferErrorMessage,
  validateDraft,
  type Draft,
} from "./transfer-schema";

const base: Draft = {
  fromWarehouseId: "a",
  toWarehouseId: "b",
  rows: [{ productId: "p1", quantity: " 5 " }],
  note: "  ",
};

describe("validateDraft", () => {
  it("builds the payload: numeric quantity, empty note left out", () => {
    const result = validateDraft(base);
    expect(result.ok && result.payload).toEqual({
      fromWarehouseId: "a",
      toWarehouseId: "b",
      items: [{ productId: "p1", quantity: 5 }],
    });
  });

  it("keeps a trimmed note", () => {
    const result = validateDraft({ ...base, note: " isi ulang " });
    expect(result.ok && result.payload.note).toBe("isi ulang");
  });

  it("rejects equal warehouses and missing choices", () => {
    const same = validateDraft({ ...base, toWarehouseId: "a" });
    expect(!same.ok && same.errors.toWarehouseId).toMatch(/berbeda/);
    const none = validateDraft({ ...base, fromWarehouseId: "", toWarehouseId: "" });
    expect(!none.ok && none.errors.fromWarehouseId).toBeDefined();
    expect(!none.ok && none.errors.toWarehouseId).toBeDefined();
  });

  it.each(["", "0", "-1", "1.5", "abc", "1000001"])("rejects quantity %j", (quantity) => {
    const result = validateDraft({ ...base, rows: [{ productId: "p1", quantity }] });
    expect(!result.ok && result.errors.rows.p1).toBeDefined();
  });

  it("accepts the limits 1 and 1,000,000", () => {
    for (const quantity of ["1", "1000000"]) {
      expect(validateDraft({ ...base, rows: [{ productId: "p1", quantity }] }).ok).toBe(true);
    }
  });

  it("needs at least one item and at most 50", () => {
    const none = validateDraft({ ...base, rows: [] });
    expect(!none.ok && none.errors.items).toBeDefined();
    const rows = Array.from({ length: MAX_TRANSFER_ITEMS + 1 }, (_, i) => ({
      productId: `p${i}`,
      quantity: "1",
    }));
    const many = validateDraft({ ...base, rows });
    expect(!many.ok && many.errors.items).toBeDefined();
    expect(validateDraft({ ...base, rows: rows.slice(0, MAX_TRANSFER_ITEMS) }).ok).toBe(true);
  });

  it("rejects a note over 255 characters", () => {
    const result = validateDraft({ ...base, note: "x".repeat(256) });
    expect(!result.ok && result.errors.note).toBeDefined();
  });
});

describe("transferErrorMessage", () => {
  const name = (id: string) => (id === "p1" ? "Kopi Arabika" : undefined);

  it("names the product of INSUFFICIENT_STOCK", () => {
    const view = transferErrorMessage(
      new ApiError(409, "INSUFFICIENT_STOCK", "x", { productId: "p1" }),
      name,
    );
    expect(view).toEqual({
      productId: "p1",
      message: "Stok Kopi Arabika di gudang asal tidak cukup.",
    });
  });

  it("falls back when the product is unknown", () => {
    const view = transferErrorMessage(new ApiError(409, "INSUFFICIENT_STOCK", "x", {}), name);
    expect(view.productId).toBeUndefined();
    expect(view.message).toMatch(/salah satu produk/);
  });

  it("offers a retry for concurrent transfers, not for an archived warehouse", () => {
    const busy = transferErrorMessage(
      new ApiError(409, "CONFLICT", "Terlalu banyak mutasi bersamaan, coba lagi."),
      name,
    );
    expect(busy.retry).toBe(true);
    const archived = transferErrorMessage(
      new ApiError(409, "CONFLICT", "Gudang tujuan sudah diarsipkan, mutasi tidak bisa dilakukan."),
      name,
    );
    expect(archived.retry).toBeFalsy();
    expect(archived.message).toMatch(/diarsipkan/);
  });

  it("uses generic text for 403 and 404 and for unknown errors", () => {
    expect(
      transferErrorMessage(new ApiError(403, "FORBIDDEN", "secret"), name).message,
    ).not.toMatch(/secret/);
    expect(
      transferErrorMessage(new ApiError(404, "NOT_FOUND", "secret"), name).message,
    ).not.toMatch(/secret/);
    expect(transferErrorMessage(new Error("boom"), name).retry).toBe(true);
  });
});
