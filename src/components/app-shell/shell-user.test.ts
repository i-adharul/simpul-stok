import { describe, expect, it, vi } from "vitest";
import { initials, logout, organizationLabel, roleLabel, type MeResponse } from "./shell-user";

const me = (organization: MeResponse["organization"]): MeResponse => ({
  user: { id: "u1", name: "Rina Wijaya", email: "r@x.id", role: "OWNER" },
  organization,
});

describe("roleLabel", () => {
  it.each([
    ["OWNER", "Owner"],
    ["WAREHOUSE_ADMIN", "Admin Gudang"],
    ["VIEWER", "Viewer"],
    ["PLATFORM_ADMIN", "Platform Admin"],
  ])("maps %s to %s", (role, label) => {
    expect(roleLabel(role)).toBe(label);
  });
});

describe("organizationLabel", () => {
  it("shows the organization name", () => {
    expect(
      organizationLabel(me({ id: "o", name: "Kopi Senja", slug: "ks", status: "ACTIVE" })),
    ).toBe("Kopi Senja");
  });

  it("shows Simpul Platform for a platform admin", () => {
    expect(organizationLabel(me(null))).toBe("Simpul Platform");
  });
});

describe("initials", () => {
  it("uses first and last word", () => {
    expect(initials("Rina Wijaya Putri")).toBe("RP");
  });
  it("handles one word and blanks", () => {
    expect(initials("rina")).toBe("R");
    expect(initials("  ")).toBe("?");
  });
});

describe("logout", () => {
  it("posts to logout, clears the cache, then goes to /login", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async () => {
      calls.push("fetch");
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const clear = vi.fn(() => void calls.push("clear"));
    const navigate = vi.fn(() => void calls.push("navigate"));

    await logout({ clear }, navigate, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
    expect(navigate).toHaveBeenCalledWith("/login");
    expect(calls).toEqual(["fetch", "clear", "navigate"]);
  });

  it("keeps the cache and stays put when the request fails", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ code: "X", message: "m" }), { status: 500 }),
    ) as unknown as typeof fetch;
    const clear = vi.fn();
    const navigate = vi.fn();

    await expect(logout({ clear }, navigate, fetchImpl)).rejects.toThrow();
    expect(clear).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
