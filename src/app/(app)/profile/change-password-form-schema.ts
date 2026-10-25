import { z } from "zod";
import { validatePassword } from "../../../modules/platform/password";

// Client-side check for quick messages; the server validates again (rule 4). The rules come from
// the shared validator, so the form and PATCH /api/me/password can never disagree.
export function createChangePasswordFormSchema(email: string) {
  return z
    .object({
      currentPassword: z.string().min(1, "Password saat ini wajib diisi."),
      newPassword: z.string(),
      confirmPassword: z.string(),
    })
    .superRefine((values, ctx) => {
      const check = validatePassword(values.newPassword, email);
      if (!check.ok)
        ctx.addIssue({ code: "custom", path: ["newPassword"], message: check.message });
      if (values.confirmPassword !== values.newPassword) {
        ctx.addIssue({
          code: "custom",
          path: ["confirmPassword"],
          message: "Konfirmasi password tidak sama.",
        });
      }
    });
}

export type ChangePasswordFormValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};
