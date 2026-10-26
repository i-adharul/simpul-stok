import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { roleLabel, type MeResponse } from "./shell-user";

type TopBarProps = {
  me: MeResponse | undefined;
  onOpenMenu: () => void;
};

export function TopBar({ me, onOpenMenu }: TopBarProps) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-4 md:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMenu}
        aria-label="Buka menu"
      >
        <Menu />
      </Button>
      {/* The search field is a shortcut to the product list (S07); filtering by text comes later. */}
      <form
        role="search"
        className="relative max-w-md flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          router.push("/products");
        }}
      >
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input type="search" placeholder="Cari produk atau SKU..." className="pl-9" />
      </form>
      <div className="ml-auto flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Notifikasi">
          <Bell />
        </Button>
        {me ? (
          <Link
            href="/profile"
            aria-label="Profil saya"
            className="text-right leading-tight hover:opacity-80 max-sm:sr-only"
          >
            <p className="text-sm font-semibold">{me.user.name}</p>
            <p className="text-xs text-muted-foreground">{roleLabel(me.user.role)}</p>
          </Link>
        ) : (
          <Skeleton className="h-8 w-28 max-sm:hidden" />
        )}
      </div>
    </header>
  );
}
