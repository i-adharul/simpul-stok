import { describe, expect, it } from "vitest";
import { checkOrigin } from "./csrf";

const base = { host: "app.example.com", pathname: "/api/warehouses" };

describe("checkOrigin", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("does not check safe method %s", (method) => {
    expect(checkOrigin({ ...base, method, origin: null })).toEqual({ ok: true });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("allows %s from the same origin", (method) => {
    expect(checkOrigin({ ...base, method, origin: "https://app.example.com" })).toEqual({
      ok: true,
    });
  });

  it("allows a preview deployment calling its own host", () => {
    expect(
      checkOrigin({
        method: "POST",
        pathname: "/api/auth/login",
        host: "simpul-stok-git-x.vercel.app",
        origin: "https://simpul-stok-git-x.vercel.app",
      }),
    ).toEqual({ ok: true });
  });

  it("allows localhost with a port", () => {
    expect(
      checkOrigin({
        method: "POST",
        pathname: "/api/auth/login",
        host: "localhost:3000",
        origin: "http://localhost:3000",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a foreign origin", () => {
    expect(checkOrigin({ ...base, method: "POST", origin: "https://evil.example" })).toEqual({
      ok: false,
      reason: "origin_mismatch",
    });
  });

  it("rejects a look-alike host and a different port", () => {
    expect(
      checkOrigin({ ...base, method: "POST", origin: "https://app.example.com.evil.example" }).ok,
    ).toBe(false);
    expect(
      checkOrigin({ ...base, method: "POST", origin: "https://app.example.com:8443" }).ok,
    ).toBe(false);
  });

  it("rejects a missing origin on a write method", () => {
    expect(checkOrigin({ ...base, method: "DELETE", origin: null })).toEqual({
      ok: false,
      reason: "origin_missing",
    });
  });

  it("rejects the opaque origin 'null' and garbage", () => {
    expect(checkOrigin({ ...base, method: "POST", origin: "null" }).ok).toBe(false);
    expect(checkOrigin({ ...base, method: "POST", origin: "not a url" }).ok).toBe(false);
  });

  it("rejects when the host is unknown", () => {
    expect(
      checkOrigin({ method: "POST", pathname: "/api/x", host: null, origin: "https://a.com" }).ok,
    ).toBe(false);
  });

  it("skips the Xendit webhook, which is verified by token instead", () => {
    expect(
      checkOrigin({
        method: "POST",
        pathname: "/api/webhooks/xendit",
        host: "a.com",
        origin: null,
      }),
    ).toEqual({ ok: true });
  });

  it("does not skip look-alike paths", () => {
    expect(
      checkOrigin({ method: "POST", pathname: "/api/webhooks-evil", host: "a.com", origin: null })
        .ok,
    ).toBe(false);
  });
});
