import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { getServerUser } from "@/modules/platform/server-session";

// Server-side guard only: no session means S01. Names and roles are shown by AppShell from
// GET /api/me, so a page and the API never disagree; a later 401 shows P19 instead.
export default async function AppLayout({ children }: { children: ReactNode }) {
  if (!(await getServerUser())) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
