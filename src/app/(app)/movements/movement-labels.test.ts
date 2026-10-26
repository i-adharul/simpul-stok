import { describe, expect, it } from "vitest";
import { dayBoundsWib, formatDelta } from "./movement-labels";

describe("formatDelta", () => {
  it("shows an explicit sign and Indonesian grouping", () => {
    expect(formatDelta(40)).toBe("+40");
    expect(formatDelta(-2)).toBe("-2");
    expect(formatDelta(1100)).toBe("+1.100");
  });
});

describe("dayBoundsWib", () => {
  it("turns WIB days into an inclusive start and an exclusive next-midnight end", () => {
    expect(dayBoundsWib("2024-10-24", "2024-10-24")).toEqual({
      from: "2024-10-23T17:00:00.000Z",
      to: "2024-10-24T17:00:00.000Z",
    });
  });
  it("leaves out an empty or invalid day", () => {
    expect(dayBoundsWib("", "")).toEqual({});
    expect(dayBoundsWib("bad", "")).toEqual({});
  });
});
