import { EmptyState } from "@/components/states/empty-state";
import { AdjustStockButton } from "../stock/stock-adjust-dialog";
import { ReceiveStockButton } from "../stock/stock-receive-dialog";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <EmptyState
        message="Belum ada data stok."
        action={
          <div className="flex gap-2">
            <ReceiveStockButton />
            <AdjustStockButton />
          </div>
        }
      />
    </div>
  );
}
