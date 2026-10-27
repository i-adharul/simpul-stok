import { TransferDetail } from "../transfer-detail";

// The id comes from the URL only to pick the transfer; the API checks the organization and the
// warehouses of the user from the session.
export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransferDetail id={id} />;
}
