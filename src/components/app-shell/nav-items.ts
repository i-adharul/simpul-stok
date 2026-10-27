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

// `hiddenFor` lists the roles that do not see the item (the API refuses them anyway; this only avoids a dead link).
export type NavItem = { label: string; href: string; icon: LucideIcon; hiddenFor?: string[] };
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
      { label: "Mutasi", href: "/transfers/new", icon: ArrowLeftRight, hiddenFor: ["VIEWER"] },
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

/** The sections a role sees; a section left without items is dropped. */
export function navSectionsFor(role: string | undefined): NavSection[] {
  return navSections
    .map((section) => ({
      ...section,
      // Until the role is known, a restricted item stays hidden rather than flashing for a Viewer.
      items: section.items.filter(
        (item) => !item.hiddenFor || (role && !item.hiddenFor.includes(role)),
      ),
    }))
    .filter((section) => section.items.length > 0);
}
