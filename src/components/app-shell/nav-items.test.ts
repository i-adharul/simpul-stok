import { describe, expect, it } from "vitest";
import { isNavItemActive, navSections } from "./nav-items";

describe("isNavItemActive", () => {
  it("matches the exact path", () => {
    expect(isNavItemActive("/products", "/products")).toBe(true);
  });

  it("matches nested paths of the item", () => {
    expect(isNavItemActive("/products/123", "/products")).toBe(true);
  });

  it("does not match a different path that only shares a prefix", () => {
    expect(isNavItemActive("/products-archive", "/products")).toBe(false);
  });

  it("does not match unrelated paths", () => {
    expect(isNavItemActive("/warehouses", "/products")).toBe(false);
  });
});

describe("navSections", () => {
  it("has unique hrefs", () => {
    const hrefs = navSections.flatMap((section) => section.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
