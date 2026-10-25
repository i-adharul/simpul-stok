import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { getServerUser } from "@/modules/platform/server-session";

const ROLE_LABELS: Record<string, string> = {
  PLATFORM_ADMIN: "Admin Platform",
  OWNER: "Owner",
  WAREHOUSE_ADMIN: "Admin Gudang",
  VIEWER: "Viewer",
};

// Identity comes from the session (organizationId only ever comes from there, rule 1). No session
// means S01; a later API call that finds the session gone shows P19 instead.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const current = await getServerUser();
  if (!current) redirect("/login");

  return (
    <AppShell
      organizationName={current.organization?.name ?? "Simpul"}
      userName={current.user.name}
      userRole={ROLE_LABELS[current.user.role] ?? current.user.role}
    >
      {children}
    </AppShell>
  );
}
