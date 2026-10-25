"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBanner } from "@/components/states/error-banner";
import { ApiError, apiFetch } from "@/lib/api-client";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { loginFormSchema, type LoginFormValues } from "./login-form-schema";

type LoginResponse = { redirectTo: string };

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: "", password: "" },
  });

  const login = useMutation({
    mutationFn: (values: LoginFormValues) =>
      apiFetch<LoginResponse>("/api/auth/login", { method: "POST", body: JSON.stringify(values) }),
    // The server decides where to go (S04, platform admin); the client only checks it is in-app.
    onSuccess: (data) => router.push(safeRedirectPath(data.redirectTo)),
  });

  const wrongCredentials =
    login.error instanceof ApiError && login.error.code === "INVALID_CREDENTIALS";
  const otherError = login.isError && !wrongCredentials;
  const { errors } = form.formState;

  return (
    <div className="w-full max-w-115 rounded-xl border bg-card p-8 lg:p-10">
      <h2 className="font-heading text-xl font-bold tracking-tight">Masuk ke Simpul</h2>
      <p className="mt-1.5 mb-7 text-sm text-muted-foreground">
        Kelola operasional dan stok cabang bisnis Anda.
      </p>

      <form
        onSubmit={form.handleSubmit((values) => login.mutate(values))}
        noValidate
        className="space-y-5"
      >
        {otherError && (
          <ErrorBanner
            message="Tidak dapat masuk saat ini. Silakan coba lagi."
            onRetry={() => form.handleSubmit((values) => login.mutate(values))()}
          />
        )}

        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-semibold">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="nama@perusahaan.com"
            className="h-10"
            aria-invalid={!!errors.email || wrongCredentials}
            {...form.register("email")}
          />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-semibold">
            Password
          </label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Masukkan password"
              className="h-10 pr-10"
              aria-invalid={!!errors.password || wrongCredentials}
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
          {wrongCredentials && (
            <p
              role="alert"
              className="flex items-center gap-1.5 pt-1 text-sm font-medium text-destructive"
            >
              <CircleAlert className="size-4" aria-hidden />
              Email atau password salah
            </p>
          )}
        </div>

        <Button
          type="submit"
          size="lg"
          className="h-10 w-full"
          disabled={login.isPending || login.isSuccess}
        >
          {login.isPending && <Loader2 className="animate-spin" aria-hidden />}
          {login.isPending ? "Memproses..." : "Masuk"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Lupa password? Hubungi Owner organisasi Anda.
        </p>
      </form>

      <div className="mt-8 border-t pt-6 text-center text-sm text-muted-foreground">
        Belum punya akun?{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Daftarkan organisasi
        </Link>
      </div>
    </div>
  );
}
