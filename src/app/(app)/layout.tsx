import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell/app-shell";

// Placeholder identity: the session does not exist yet. The login story replaces these with
// values read from the session (organizationId only ever comes from there, rule 1).
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell organizationName="Organisasi Anda" userName="Pengguna" userRole="Owner">
      {children}
    </AppShell>
  );
}
