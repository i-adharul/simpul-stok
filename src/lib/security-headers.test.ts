import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

function asMap() {
  return new Map(securityHeaders().map((h) => [h.key, h.value]));
}

describe("securityHeaders", () => {
  it("sets the baseline headers", () => {
    const headers = asMap();
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("uses a CSP that blocks framing and plugins without restricting scripts", () => {
    const csp = asMap().get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("script-src");
  });

  it("sends HSTS", () => {
    expect(asMap().get("Strict-Transport-Security")).toContain("max-age=");
  });

  it("opens no CORS", () => {
    expect(asMap().has("Access-Control-Allow-Origin")).toBe(false);
  });
});
