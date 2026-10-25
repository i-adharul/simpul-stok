import { Skeleton } from "@/components/ui/skeleton";
import { SidebarNav } from "./sidebar-nav";
import { organizationLabel, type MeResponse } from "./shell-user";
import { UserCard } from "./user-card";

type SidebarProps = {
  me: MeResponse | undefined;
  onNavigate?: () => void;
};

// Shared by the fixed desktop sidebar and the mobile drawer.
export function Sidebar({ me, onNavigate }: SidebarProps) {
  return (
    <div className="flex h-full flex-col gap-5 bg-sidebar p-4">
      <div className="flex items-center gap-2 px-1">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-heading font-bold text-primary-foreground">
          S
        </span>
        <span className="font-heading text-lg font-bold tracking-tight">Simpul</span>
        <span className="rounded-md border border-accent bg-accent px-2 py-0.5 text-[10px] font-bold text-accent-foreground">
          Stok
        </span>
      </div>
      <div className="rounded-lg border bg-card px-3 py-2">
        {me ? (
          <p className="truncate text-sm font-semibold">{organizationLabel(me)}</p>
        ) : (
          <Skeleton className="h-5 w-32" />
        )}
      </div>
      <SidebarNav onNavigate={onNavigate} />
      <UserCard me={me} />
    </div>
  );
}
