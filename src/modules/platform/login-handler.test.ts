import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../lib/env";
import { withApiLog } from "../../lib/api-handler";
import type { PrismaClient } from "../../generated/prisma/client";
import { assertTestDatabaseUrl, createTestPrisma } from "../../test/test-database";
import { createLoginHandler, loginRoute } from "./login-handler";
import { DEMO_ACCOUNTS, seedBase } from "./seed";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";

const secret = env.SESSION_SECRET;
const owner = DEMO_ACCOUNTS.find((a) => a.role === "OWNER")!;
const viewer = DEMO_ACCOUNTS.find((a) => a.role === "VIEWER")!;

let prisma: PrismaClient;
let inner: ReturnType<typeof createLoginHandler>;
let handler: ReturnType<typeof withApiLog>;

function post(body: unknown, raw = false): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeAll(async () => {
  prisma = createTestPrisma(assertTestDatabaseUrl(env.TEST_DATABASE_URL));
  await prisma.$executeRaw`TRUNCATE TABLE subscriptions, users, plans, organizations RESTART IDENTITY CASCADE`;
  await seedBase(prisma);
  inner = createLoginHandler({ prisma, secret });
  handler = withApiLog(inner, loginRoute);
});

beforeEach(async () => {
  await prisma.user.updateMany({ data: { isActive: true, lastLoginAt: null } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST login: success", () => {
  it("returns 200 with the user and redirectTo, and sets the session cookie", async () => {
    const response = await handler(post({ email: owner.email, password: owner.password }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({
      user: { id: expect.any(String), name: owner.name, email: owner.email, role: "OWNER" },
      redirectTo: "/dashboard",
    });

    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*SameSite=lax/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
    expect(cookie).toMatch(/;\s*Max-Age=28800/i);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("ignores email case end to end (schema and service)", async () => {
    const response = await handler(
      post({ email: owner.email.toUpperCase(), password: owner.password }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).user.email).toBe(owner.email);
  });

  it("signs a token for exactly this user, and never puts it in the body", async () => {
    const response = await handler(post({ email: owner.email, password: owner.password }));
    const cookie = response.headers.get("set-cookie")!;
    const token = cookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))![1];
    const body = await response.text();
    expect(body).not.toContain(token);
    const session = await verifySessionToken(token, secret);
    expect(session?.userId).toBe(JSON.parse(body).user.id);
  });
});

describe("POST login: failure", () => {
  const failures: [string, () => Promise<Response>][] = [
    ["wrong password", () => handler(post({ email: owner.email, password: "wrong-pass-1" }))],
    [
      "unknown email",
      () => handler(post({ email: "nobody@example.com", password: "wrong-pass-1" })),
    ],
    ["malformed email", () => handler(post({ email: "not-an-email", password: "wrong-pass-1" }))],
    ["weak password", () => handler(post({ email: owner.email, password: "abc" }))],
    [
      "password over 72 bytes",
      () => handler(post({ email: owner.email, password: owner.password + "x".repeat(80) })),
    ],
    [
      "inactive user",
      async () => {
        await prisma.user.update({ where: { email: viewer.email }, data: { isActive: false } });
        return handler(post({ email: viewer.email, password: viewer.password }));
      },
    ],
  ];

  it.each(failures)("%s -> the same generic 401, no cookie", async (_name, attempt) => {
    const response = await attempt();
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Email atau password salah.",
      details: null,
    });
  });
});

describe("POST login: bad request", () => {
  const bad: [string, Request][] = [
    ["invalid JSON", post("{not json", true)],
    ["JSON array", post([])],
    ["missing password", post({ email: owner.email })],
    ["missing email", post({ password: "abc12345" })],
    ["empty strings", post({ email: "", password: "" })],
    ["non-string password", post({ email: owner.email, password: 12345678 })],
    ["password over 128 characters", post({ email: owner.email, password: "a1".repeat(65) })],
  ];

  it.each(bad)("%s -> 400 VALIDATION_ERROR without details", async (_name, request) => {
    const response = await handler(request);
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      code: "VALIDATION_ERROR",
      message: "Email dan password wajib diisi.",
      details: null,
    });
  });
});

describe("POST login: logging", () => {
  it("logs neither the email nor the password nor the token, for success or failure", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const wrapped = withApiLog(inner, { ...loginRoute, route: "/api/auth/login" });
      const ok = await wrapped(post({ email: owner.email, password: owner.password }));
      await wrapped(post({ email: owner.email, password: "wrong-pass-1" }));
      await wrapped(post({ email: "nobody@example.com", password: "unknown-user-pw-9" }));

      const token = ok.headers.get("set-cookie")!.match(/=([^;]+)/)![1];
      const logged = [...info.mock.calls, ...error.mock.calls].flat().join("\n");
      expect(logged).toContain("api.request"); // the lines exist, so the checks below mean something
      for (const secretText of [
        owner.email,
        owner.password,
        "wrong-pass-1",
        "nobody@example.com",
        "unknown-user-pw-9",
        token,
      ]) {
        expect(logged).not.toContain(secretText);
      }
    } finally {
      info.mockRestore();
      error.mockRestore();
    }
  });
});
