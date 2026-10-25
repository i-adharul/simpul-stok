"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { CircleCheck, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/states/error-banner";
import { ApiError, apiFetch } from "@/lib/api-client";
import {
  createChangePasswordFormSchema,
  type ChangePasswordFormValues,
} from "./change-password-form-schema";

const EMPTY: ChangePasswordFormValues = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

const FIELDS = [
  { name: "currentPassword", label: "Password saat ini", autoComplete: "current-password" },
  { name: "newPassword", label: "Password baru", autoComplete: "new-password" },
  { name: "confirmPassword", label: "Konfirmasi password baru", autoComplete: "new-password" },
] as const;

// P17. Opened from S17.
export function ChangePasswordDialog({ email }: { email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const schema = useMemo(() => createChangePasswordFormSchema(email), [email]);
  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const change = useMutation({
    mutationFn: (values: ChangePasswordFormValues) =>
      apiFetch<void>("/api/me/password", {
        method: "PATCH",
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      }),
    onSuccess: () => {
      form.reset(EMPTY);
      setSaved(true);
      setOpen(false);
      router.refresh();
    },
    onError: (error) => {
      // The server is the authority: show its field-level answers under the right input.
      if (!(error instanceof ApiError)) return;
      if (error.code === "INVALID_CURRENT_PASSWORD") {
        form.setError("currentPassword", { message: error.message });
      } else if (error.code === "VALIDATION_ERROR") {
        form.setError("newPassword", { message: error.message });
      }
    },
  });

  const handled =
    change.error instanceof ApiError &&
    ["INVALID_CURRENT_PASSWORD", "VALIDATION_ERROR"].includes(change.error.code);
  const { errors } = form.formState;

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setSaved(false);
    if (!next) {
      form.reset(EMPTY);
      change.reset();
    }
  }

  return (
    <>
      {saved && (
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium text-primary">
          <CircleCheck className="size-4" aria-hidden />
          Password berhasil diubah
        </p>
      )}
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Trigger asChild>
          <Button variant="outline">Ubah password</Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-105 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="font-heading text-lg font-bold">
                  Ubah password
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                  Setelah diubah, perangkat lain harus masuk lagi.
                </Dialog.Description>
              </div>
              <Dialog.Close
                aria-label="Tutup"
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </Dialog.Close>
            </div>
            <form
              onSubmit={form.handleSubmit((values) => change.mutate(values))}
              noValidate
              className="mt-5 space-y-4"
            >
              {change.isError && !handled && (
                <ErrorBanner message="Password belum dapat diubah. Silakan coba lagi." />
              )}
              {FIELDS.map(({ name, label, autoComplete }) => (
                <div key={name} className="space-y-1.5">
                  <label htmlFor={name} className="block text-sm font-semibold">
                    {label}
                  </label>
                  <Input
                    id={name}
                    type="password"
                    autoComplete={autoComplete}
                    aria-invalid={!!errors[name]}
                    {...form.register(name)}
                  />
                  {errors[name] && (
                    <p className="text-sm text-destructive">{errors[name]?.message}</p>
                  )}
                </div>
              ))}
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Batal
                  </Button>
                </Dialog.Close>
                <Button type="submit" disabled={change.isPending}>
                  {change.isPending && <Loader2 className="animate-spin" aria-hidden />}
                  Simpan password
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
