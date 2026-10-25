"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { initials, logout, roleLabel, type MeResponse } from "./shell-user";

type UserCardProps = { me: MeResponse | undefined };

// S04: user card at the bottom of the sidebar. Shared by the desktop sidebar and the drawer, so
// "Keluar" is reachable from every page.
export function UserCard({ me }: UserCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleLogout() {
    setPending(true);
    setFailed(false);
    try {
      await logout(queryClient, (path) => router.replace(path));
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="mt-auto flex flex-col gap-2 border-t pt-3">
      <div className="flex items-center gap-2.5">
        {me ? (
          <>
            <span
              aria-hidden
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground"
            >
              {initials(me.user.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">{me.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{roleLabel(me.user.role)}</p>
            </div>
          </>
        ) : (
          <>
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={handleLogout} disabled={pending}>
        <LogOut aria-hidden />
        {pending ? "Keluar..." : "Keluar"}
      </Button>
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          Gagal keluar. Coba lagi.
        </p>
      )}
    </div>
  );
}
