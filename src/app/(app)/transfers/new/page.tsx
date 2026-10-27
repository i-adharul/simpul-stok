import { TransferForm } from "../transfer-form";

// `copy` only names the transfer to copy from S12; the API checks that the user may see it.
export default async function NewTransferPage({
  searchParams,
}: {
  searchParams: Promise<{ copy?: string | string[] }>;
}) {
  const { copy } = await searchParams;
  return <TransferForm copyId={typeof copy === "string" ? copy : undefined} />;
}
