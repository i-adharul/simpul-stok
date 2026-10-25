import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps an in-app path", () => {
    expect(safeRedirectPath("/platform")).toBe("/platform");
  });

  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "dashboard", "", null, 5])(
    "falls back for %s",
    (target) => {
      expect(safeRedirectPath(target)).toBe("/dashboard");
    },
  );
});
