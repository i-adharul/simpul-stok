import { describe, expect, it } from "vitest";
import { clampPage, pageCount, pageWindow } from "./pagination";

describe("pageCount", () => {
  it("is at least 1 and rounds up", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
  });
});

describe("pageWindow", () => {
  it("lists every page when there are few", () => {
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it("keeps first and last page and marks gaps with null", () => {
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });
});

describe("clampPage", () => {
  it("keeps a valid page", () => expect(clampPage(2, 45, 20)).toBe(2));
  it("moves back to the last page when it emptied", () => expect(clampPage(3, 40, 20)).toBe(2));
  it("never goes below 1, also for an empty list", () => {
    expect(clampPage(5, 0, 20)).toBe(1);
    expect(clampPage(0, 10, 20)).toBe(1);
  });
});
