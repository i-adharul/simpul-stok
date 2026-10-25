import { describe, expect, it } from "vitest";
import { createChangePasswordFormSchema } from "./change-password-form-schema";

const schema = createChangePasswordFormSchema("rina@kopisenja.id");
const base = {
  currentPassword: "lama-1234x",
  newPassword: "baru-sandi-99",
  confirmPassword: "baru-sandi-99",
};

const messages = (input: unknown) =>
  schema.safeParse(input).error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

describe("changePasswordFormSchema", () => {
  it("accepts a valid form", () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it("requires the current password", () => {
    expect(messages({ ...base, currentPassword: "" })).toEqual([
      "currentPassword: Password saat ini wajib diisi.",
    ]);
  });

  it("applies the shared password rules to the new password", () => {
    const result = messages({ ...base, newPassword: "short1", confirmPassword: "short1" });
    expect(result?.[0]).toMatch(/^newPassword: Password harus minimal 8 karakter/);
    expect(
      messages({ ...base, newPassword: "password123", confirmPassword: "password123" }),
    ).toEqual(["newPassword: Password terlalu umum."]);
  });

  it("requires the confirmation to match", () => {
    expect(messages({ ...base, confirmPassword: "lain-sandi-99" })).toEqual([
      "confirmPassword: Konfirmasi password tidak sama.",
    ]);
  });
});
