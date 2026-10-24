"use client";

import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

type AppShellProps = {
  organizationName: string;
  userName: string;
  userRole: string;
  children: ReactNode;
};

// Desktop (1024px and up): fixed sidebar. Phone and tablet: the same sidebar in a drawer
// opened from the top bar (DESIGN.md, layout and spacing).
export function AppShell({ organizationName, userName, userRole, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen lg:pl-65">
      <aside className="fixed inset-y-0 left-0 hidden w-65 border-r lg:block">
        <Sidebar organizationName={organizationName} />
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-65 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Navigasi utama aplikasi</SheetDescription>
          <Sidebar organizationName={organizationName} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <TopBar userName={userName} userRole={userRole} onOpenMenu={() => setMenuOpen(true)} />
      <main className="p-4 md:p-6 lg:p-8">{children}</main>
    </div>
  );
}
