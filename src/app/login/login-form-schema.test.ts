import { describe, expect, it } from "vitest";
import { loginFormSchema } from "./login-form-schema";

describe("loginFormSchema", () => {
  it("accepts any non-empty email and password", () => {
    expect(loginFormSchema.safeParse({ email: "a", password: "b" }).success).toBe(true);
  });

  it("requires both fields, with Indonesian messages", () => {
    const result = loginFormSchema.safeParse({ email: "  ", password: "" });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message);
    expect(messages).toEqual(["Email wajib diisi.", "Password wajib diisi."]);
  });
});
