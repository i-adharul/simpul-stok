import { describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, onSessionExpired } from "./api-client";

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("apiFetch", () => {
  it("returns the parsed body on success", async () => {
    await expect(apiFetch("/api/me", undefined, reply(200, { ok: 1 }))).resolves.toEqual({ ok: 1 });
  });

  it("notifies listeners when the session has expired", async () => {
    const listener = vi.fn();
    const off = onSessionExpired(listener);
    const fetchImpl = reply(401, { code: "UNAUTHENTICATED", message: "x", details: null });
    await expect(apiFetch("/api/me", undefined, fetchImpl)).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledOnce();
    off();
  });

  it("does not treat a wrong password as an expired session", async () => {
    const listener = vi.fn();
    const off = onSessionExpired(listener);
    const fetchImpl = reply(401, { code: "INVALID_CREDENTIALS", message: "x", details: null });
    await expect(apiFetch("/api/auth/login", { method: "POST" }, fetchImpl)).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it("stops notifying after unsubscribe", async () => {
    const listener = vi.fn();
    onSessionExpired(listener)();
    const fetchImpl = reply(401, { code: "UNAUTHENTICATED", message: "x", details: null });
    await apiFetch("/api/me", undefined, fetchImpl).catch(() => {});
    expect(listener).not.toHaveBeenCalled();
  });
});
