import {
  ArrowLeftRight,
  Boxes,
  CreditCard,
  History,
  LayoutDashboard,
  Package,
  Settings,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { label: string; href: string; icon: LucideIcon };
export type NavSection = { title: string | null; items: NavItem[] };

// Menu structure follows the sidebar of screen S04 (notes/stitch). UI text is Indonesian (rule 12).
export const navSections: NavSection[] = [
  {
    title: null,
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Inventori",
    items: [
      { label: "Ringkasan Stok", href: "/stock", icon: Boxes },
      { label: "Produk", href: "/products", icon: Package },
      { label: "Gudang", href: "/warehouses", icon: Warehouse },
      { label: "Mutasi", href: "/transfers", icon: ArrowLeftRight },
      { label: "Riwayat", href: "/movements", icon: History },
    ],
  },
  {
    title: "Administrasi",
    items: [
      { label: "Anggota", href: "/members", icon: Users },
      { label: "Pengaturan", href: "/settings", icon: Settings },
      { label: "Langganan", href: "/billing", icon: CreditCard },
    ],
  },
];

/** An item is active on its own path and on every path below it, but not on a mere text prefix. */
export function isNavItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
