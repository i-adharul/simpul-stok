import { describe, expect, it } from "vitest";
import { formatDateTimeWib, formatDateWib, formatNumber, formatRupiah } from "./format";

describe("formatNumber", () => {
  it("uses a dot for thousands and a comma for decimals", () => {
    expect(formatNumber(24850)).toBe("24.850");
    expect(formatNumber(1234567.5)).toBe("1.234.567,5");
  });

  it("keeps small numbers and zero as they are", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(148)).toBe("148");
  });

  it("formats negative numbers with a minus sign", () => {
    expect(formatNumber(-2)).toBe("-2");
  });

  it("limits decimals to three places", () => {
    expect(formatNumber(1.23456)).toBe("1,235");
  });
});

describe("formatRupiah", () => {
  it("prefixes Rp and separates it from the digits with a non-breaking space", () => {
    expect(formatRupiah(1500000)).toBe("Rp\u00a01.500.000");
  });

  it("shows zero", () => {
    expect(formatRupiah(0)).toBe("Rp\u00a00");
  });
});

describe("formatDateWib", () => {
  it("shows the WIB calendar day, not the UTC one", () => {
    // 2024-10-24 20:00 UTC is 2024-10-25 03:00 WIB (UTC+7).
    expect(formatDateWib(new Date("2024-10-24T20:00:00Z"))).toBe("25 Okt 2024");
  });

  it("accepts an ISO string", () => {
    expect(formatDateWib("2024-01-05T00:00:00Z")).toBe("5 Jan 2024");
  });
});

describe("formatDateTimeWib", () => {
  it("shows date and 24-hour time followed by WIB", () => {
    expect(formatDateTimeWib(new Date("2024-10-24T20:05:00Z"))).toBe("25 Okt 2024, 03.05 WIB");
  });
});

describe("invalid dates", () => {
  it("throws instead of printing Invalid Date", () => {
    expect(() => formatDateWib("not a date")).toThrow(RangeError);
  });
});
