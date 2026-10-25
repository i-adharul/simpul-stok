import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerUser } from "@/modules/platform/server-session";
import { LoginForm } from "./login-form";
import { BrandPanel } from "./brand-panel";

export const metadata: Metadata = { title: "Masuk - Simpul Stok" };

export default async function LoginPage() {
  // Already logged in: skip the form. Reads the session, so this page is never prerendered.
  if (await getServerUser()) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-360 flex-col lg:flex-row">
      <BrandPanel />
      <section className="flex flex-1 items-center justify-center p-6 lg:p-14">
        <LoginForm />
      </section>
    </main>
  );
}
