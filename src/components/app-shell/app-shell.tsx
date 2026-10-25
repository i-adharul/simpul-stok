"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorBanner } from "@/components/states/error-banner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ApiError } from "@/lib/api-client";
import { Sidebar } from "./sidebar";
import { fetchMe, ME_QUERY_KEY } from "./shell-user";
import { TopBar } from "./top-bar";

// Desktop (1024px and up): fixed sidebar. Phone and tablet: the same sidebar in a drawer
// opened from the top bar (DESIGN.md, layout and spacing).
export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // No retry: a 401 must reach apiFetch once so P19 opens; a network error shows "Coba lagi".
  const {
    data: me,
    error,
    refetch,
  } = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    retry: false,
  });
  // A 401 is handled by the P19 dialog (apiFetch notifies it), so only other errors get a banner.
  const showError = error && !(error instanceof ApiError && error.status === 401);

  return (
    <div className="min-h-screen lg:pl-65">
      <aside className="fixed inset-y-0 left-0 hidden w-65 border-r lg:block">
        <Sidebar me={me} />
      </aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-65 p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">Navigasi utama aplikasi</SheetDescription>
          <Sidebar me={me} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      <TopBar me={me} onOpenMenu={() => setMenuOpen(true)} />
      <main className="p-4 md:p-6 lg:p-8">
        {showError && (
          <div className="mb-4">
            <ErrorBanner
              message="Gagal memuat data akun. Periksa koneksi Anda."
              onRetry={() => void refetch()}
            />
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
