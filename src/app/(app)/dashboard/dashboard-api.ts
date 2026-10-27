import { apiFetch } from "@/lib/api-client";
import { STOCK_QUERY_KEY, type StockStatus } from "../stock/stock-api";
import type { DashboardActivity } from "./dashboard-activity";

// Shape of GET /api/dashboard (E6-01). Declared here because the server type pulls in Prisma.
export type DashboardRestockItem = {
  warehouse: { id: string; code: string; name: string };
  product: { id: string; sku: string; name: string; unit: string; minStock: number };
  quantity: number;
  status: StockStatus;
};

export type Dashboard = {
  summary: {
    totalProducts: number;
    totalUnits: number;
    lowCount: number;
    outCount: number;
    movementsToday: number;
  };
  restock: { items: DashboardRestockItem[]; total: number };
  recentActivity: DashboardActivity[];
};

// Under the stock key, so a receipt, adjustment or transfer refreshes the dashboard too.
export const DASHBOARD_QUERY_KEY = [...STOCK_QUERY_KEY, "dashboard"] as const;

export function fetchDashboard() {
  return apiFetch<Dashboard>("/api/dashboard");
}
