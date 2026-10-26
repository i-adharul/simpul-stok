import { WarehouseDetail } from "../warehouse-detail";

// The id comes from the URL only to pick the warehouse; the API checks the organization from the session.
export default async function WarehouseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WarehouseDetail id={id} />;
}
