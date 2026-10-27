import { MovementList } from "./movement-list";
import { parseMovementSearchParams } from "./movement-search-params";

// The filters of S06 and S08 "see all" links arrive in the URL; the list only uses them as its start value.
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const initial = parseMovementSearchParams(await searchParams);
  return <MovementList initial={initial} />;
}
