import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <EmptyState message="Belum ada data stok." action={<Button>Terima barang</Button>} />
    </div>
  );
}
