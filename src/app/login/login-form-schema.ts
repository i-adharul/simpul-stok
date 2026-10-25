import { z } from "zod";

// Client-side check for a quick message only; the server validates again (rule 4). Like the API it
// does not apply the password rules, so the form never hints at what a valid password looks like.
export const loginFormSchema = z.object({
  email: z.string().trim().min(1, "Email wajib diisi."),
  password: z.string().min(1, "Password wajib diisi."),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;
