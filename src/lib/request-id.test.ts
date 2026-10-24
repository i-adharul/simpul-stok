import { describe, expect, it } from "vitest";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

describe("resolveRequestId", () => {
  it("uses the header name x-request-id", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });

  it("keeps a valid incoming ID so a trace can span several systems", () => {
    expect(resolveRequestId("abc-123_DEF-456")).toBe("abc-123_DEF-456");
  });

  it("creates a UUID when there is no incoming ID", () => {
    expect(resolveRequestId(null)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ["too short", "abc"],
    ["too long", "a".repeat(65)],
    ["has a space", "abc def ghi jkl"],
    ["has a newline (log injection)", 'abcdefgh\n{"level":"error"}'],
    ["has a quote", 'abcdefgh"'],
  ])("replaces an invalid incoming ID: %s", (_label, value) => {
    const id = resolveRequestId(value);
    expect(id).not.toBe(value);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("creates a different ID each time", () => {
    expect(resolveRequestId(null)).not.toBe(resolveRequestId(null));
  });
});
