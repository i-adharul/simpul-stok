import { formatNumber } from "@/lib/format";

export type MovementType = "RECEIVE" | "ADJUST" | "TRANSFER_OUT" | "TRANSFER_IN" | "IMPORT";
export type MovementReason = "STOCK_OPNAME" | "DAMAGED" | "LOST" | "CORRECTION";

export const TYPE_LABEL: Record<MovementType, string> = {
  RECEIVE: "Penerimaan",
  ADJUST: "Penyesuaian",
  TRANSFER_OUT: "Mutasi keluar",
  TRANSFER_IN: "Mutasi masuk",
  IMPORT: "Impor",
};

export const REASON_LABEL: Record<MovementReason, string> = {
  STOCK_OPNAME: "Stok opname",
  DAMAGED: "Rusak",
  LOST: "Hilang",
  CORRECTION: "Koreksi",
};

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Pemilik",
  WAREHOUSE_ADMIN: "Admin Gudang",
  VIEWER: "Viewer",
};

/** Role as shown on a movement; an unknown role stays as text. hasOwn keeps "constructor" from matching. */
export function movementRoleLabel(role: string): string {
  return Object.hasOwn(ROLE_LABEL, role) ? ROLE_LABEL[role] : role;
}

/** 40 -> "+40", -2 -> "-2", 1100 -> "+1.100" (Indonesian grouping, an explicit sign). */
export function formatDelta(delta: number): string {
  return `${delta > 0 ? "+" : delta < 0 ? "-" : ""}${formatNumber(Math.abs(delta))}`;
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * A calendar day picked in the filter ("2024-10-24") -> the instants the API expects: `from` inclusive
 * and `to` exclusive, at WIB (+07:00) midnight. The "to" date is a whole day, so `to` is the next midnight.
 */
export function dayBoundsWib(from: string, to: string): { from?: string; to?: string } {
  const start = (day: string) => new Date(`${day}T00:00:00+07:00`);
  const bounds: { from?: string; to?: string } = {};
  if (from && !Number.isNaN(start(from).getTime())) bounds.from = start(from).toISOString();
  if (to && !Number.isNaN(start(to).getTime())) {
    bounds.to = new Date(start(to).getTime() + DAY).toISOString();
  }
  return bounds;
}
