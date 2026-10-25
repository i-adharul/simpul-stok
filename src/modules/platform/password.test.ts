import { describe, expect, it } from "vitest";
import { PASSWORD_FORMAT_MESSAGE, PASSWORD_TOO_COMMON_MESSAGE, validatePassword } from "./password";

const email = "budi.santoso@example.com";

describe("validatePassword length", () => {
  it.each([
    [7, false],
    [8, true],
    [72, true],
    [73, false],
  ])("length %i -> ok=%s", (length, ok) => {
    const pw = "a1".repeat(40).slice(0, length);
    const result = validatePassword(pw, email);
    expect(result.ok).toBe(ok);
    if (!result.ok) expect(result.message).toBe(PASSWORD_FORMAT_MESSAGE);
  });

  it("rejects multibyte passwords over 72 bytes (bcrypt limit)", () => {
    const pw = "é1" + "é".repeat(36); // 38 chars, 76 bytes
    const result = validatePassword(pw, email);
    expect(result).toEqual({ ok: false, message: PASSWORD_FORMAT_MESSAGE });
  });
});

describe("PASSWORD_FORMAT_MESSAGE", () => {
  it("says the maximum is in bytes and that accents and emoji count as more than one", () => {
    expect(PASSWORD_FORMAT_MESSAGE).toContain("72 byte");
    expect(PASSWORD_FORMAT_MESSAGE).toMatch(/beraksen/);
    expect(PASSWORD_FORMAT_MESSAGE).toMatch(/emoji/);
    expect(PASSWORD_FORMAT_MESSAGE).toMatch(/lebih dari 1 byte/);
  });

  it("is returned for an emoji password that is under 72 characters but over 72 bytes", () => {
    const pw = "a1" + "😀".repeat(18); // 20 characters (38 UTF-16 units), 74 bytes
    expect(validatePassword(pw, email)).toEqual({ ok: false, message: PASSWORD_FORMAT_MESSAGE });
  });
});

describe("validatePassword character rules", () => {
  it("requires a letter", () => {
    expect(validatePassword("93847561920", email)).toEqual({
      ok: false,
      message: PASSWORD_FORMAT_MESSAGE,
    });
  });

  it("requires a digit", () => {
    expect(validatePassword("kudaterbangtinggi", email)).toEqual({
      ok: false,
      message: PASSWORD_FORMAT_MESSAGE,
    });
  });

  it("does not require a symbol", () => {
    expect(validatePassword("kudaterbang7", email).ok).toBe(true);
  });
});

describe("validatePassword email rules", () => {
  it("rejects the part before the @", () => {
    expect(validatePassword("budi.santoso7", "budi.santoso7@example.com")).toEqual({
      ok: false,
      message: PASSWORD_TOO_COMMON_MESSAGE,
    });
    expect(validatePassword("BudiSantoso1", "budisantoso1@example.com").ok).toBe(false);
  });

  it("rejects the full email", () => {
    expect(validatePassword("a1@b.co", "a1@b.co").ok).toBe(false);
    expect(validatePassword("budi.santoso@example.com", email).ok).toBe(false);
  });

  it("accepts a password that merely contains the local part", () => {
    expect(validatePassword("budi.santoso-2026", email).ok).toBe(true);
  });
});

describe("validatePassword common list", () => {
  it.each(["password123", "Password123", "qwerty123"])("rejects %s", (pw) => {
    expect(validatePassword(pw, email)).toEqual({
      ok: false,
      message: PASSWORD_TOO_COMMON_MESSAGE,
    });
  });

  it("rejects 12345678 (no letter, so by the format rule)", () => {
    expect(validatePassword("12345678", email).ok).toBe(false);
  });

  it("accepts an uncommon password", () => {
    expect(validatePassword("kopi-susu-4-pagi", email)).toEqual({ ok: true });
  });
});
