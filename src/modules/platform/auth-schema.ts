import { z } from "zod";

// Login only checks the shape of the body. It must NOT apply the password rules (validatePassword):
// that would tell an attacker what a valid password looks like, and would lock out an older account.
// The email is not format-checked either, so a malformed address gets the same 401 as an unknown one.
// 128 characters caps the work done before hashing; 72 bytes is enforced in the service.
export const loginSchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;
