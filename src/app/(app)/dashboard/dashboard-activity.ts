import {
  formatDelta,
  REASON_LABEL,
  TYPE_LABEL,
  type MovementReason,
  type MovementType,
} from "../movements/movement-labels";

// Shape of recentActivity in GET /api/dashboard (E6-01). Declared here because the server type pulls in Prisma.
export type DashboardActivity = {
  id: string;
  type: MovementType;
  quantityDelta: number;
  reason: MovementReason | null;
  createdAt: string;
  warehouse: { id: string; code: string; name: string };
  product: { id: string; sku: string; name: string; unit: string };
  createdBy: { id: string; name: string } | null;
  transfer: { id: string; code: string } | null;
};

const TITLE: Partial<Record<MovementType, string>> = {
  RECEIVE: "Penerimaan stok",
  ADJUST: "Penyesuaian stok",
  IMPORT: "Impor stok",
};

export function activityTitle(type: MovementType): string {
  return TITLE[type] ?? TYPE_LABEL[type];
}

/** "+40 bks Kopi di Gudang Pusat (TRF-1)": signed quantity, product, warehouse, then transfer code or reason. */
export function activityText(item: DashboardActivity): string {
  const extra = item.transfer?.code ?? (item.reason ? REASON_LABEL[item.reason] : null);
  const head = `${formatDelta(item.quantityDelta)} ${item.product.unit} ${item.product.name} di ${item.warehouse.name}`;
  return extra ? `${head} (${extra})` : head;
}
