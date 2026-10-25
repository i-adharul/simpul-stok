// Single password rule set shared by sign-up, invitation, reset and password change
// (docs/02_Functional_Spec.md, Design decisions: Account). Pure: no HTTP, no database.

export const PASSWORD_FORMAT_MESSAGE =
  "Password harus minimal 8 karakter dan mengandung huruf serta angka.";
export const PASSWORD_TOO_COMMON_MESSAGE = "Password terlalu umum.";

const MIN_LENGTH = 8;
const MAX_LENGTH = 72;

// Compared in lowercase. Kept small on purpose: an offline list of well-known passwords
// that also satisfy the letter+digit rule (the format check runs first).
const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "00000000",
  "87654321",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd",
  "p@ssw0rd",
  "qwerty123",
  "qwerty1234",
  "qwertyuiop",
  "abc12345",
  "abcd1234",
  "abc123456",
  "admin123",
  "admin1234",
  "welcome1",
  "welcome123",
  "letmein123",
  "iloveyou1",
  "iloveyou123",
  "monkey123",
  "dragon123",
  "sayang123",
  "indonesia123",
  "bismillah123",
  "rahasia123",
  "kata sandi123",
  "katasandi123",
  "123qweasd",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "q1w2e3r4",
  "zaq12wsx",
]);

export type PasswordCheck = { ok: true } | { ok: false; message: string };

function hasValidFormat(password: string): boolean {
  // bcrypt only reads the first 72 bytes, so the limit is checked in bytes as well.
  const bytes = new TextEncoder().encode(password).length;
  return (
    password.length >= MIN_LENGTH &&
    password.length <= MAX_LENGTH &&
    bytes <= MAX_LENGTH &&
    /\p{L}/u.test(password) &&
    /\d/.test(password)
  );
}

function matchesEmail(password: string, email: string): boolean {
  const pw = password.toLowerCase();
  const mail = email.trim().toLowerCase();
  return pw === mail || pw === mail.split("@")[0];
}

export function validatePassword(password: string, email: string): PasswordCheck {
  if (!hasValidFormat(password)) return { ok: false, message: PASSWORD_FORMAT_MESSAGE };
  if (matchesEmail(password, email) || COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, message: PASSWORD_TOO_COMMON_MESSAGE };
  }
  return { ok: true };
}
