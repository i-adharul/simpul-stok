import { describe, expect, it } from "vitest";
import { activityTitle, activityText, type DashboardActivity } from "./dashboard-activity";

const base: DashboardActivity = {
  id: "m1",
  type: "RECEIVE",
  quantityDelta: 100,
  reason: null,
  createdAt: "2024-10-24T05:00:00.000Z",
  warehouse: { id: "w1", code: "PST", name: "Gudang Pusat" },
  product: { id: "p1", sku: "BKA", name: "Biji Kopi", unit: "bks" },
  createdBy: { id: "u1", name: "Hendra" },
  transfer: null,
};

describe("dashboard activity", () => {
  it("titles each movement type in Indonesian", () => {
    expect(activityTitle("RECEIVE")).toBe("Penerimaan stok");
    expect(activityTitle("ADJUST")).toBe("Penyesuaian stok");
    expect(activityTitle("TRANSFER_OUT")).toBe("Mutasi keluar");
    expect(activityTitle("TRANSFER_IN")).toBe("Mutasi masuk");
    expect(activityTitle("IMPORT")).toBe("Impor stok");
  });

  it("describes a receipt with a signed, Indonesian-formatted quantity", () => {
    expect(activityText({ ...base, quantityDelta: 1100 })).toBe(
      "+1.100 bks Biji Kopi di Gudang Pusat",
    );
  });

  it("adds the transfer code and the reason when present", () => {
    expect(
      activityText({
        ...base,
        type: "TRANSFER_OUT",
        quantityDelta: -5,
        transfer: { id: "t", code: "TRF-1" },
      }),
    ).toBe("-5 bks Biji Kopi di Gudang Pusat (TRF-1)");
    expect(activityText({ ...base, type: "ADJUST", quantityDelta: -2, reason: "DAMAGED" })).toBe(
      "-2 bks Biji Kopi di Gudang Pusat (Rusak)",
    );
  });
});
