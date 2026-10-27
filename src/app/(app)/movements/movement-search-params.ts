import { TYPE_LABEL } from "./movement-labels";

export type InitialMovementFilters = { productId: string; warehouseId: string; type: string };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * S06 and S08 link to S10 with `?warehouseId=` / `?productId=`. Anything that is not a UUID (or a known
 * type) is dropped, so a hand-edited URL never reaches the API as a 400; the server still validates.
 */
export function parseMovementSearchParams(
  params: Record<string, string | string[] | undefined>,
): InitialMovementFilters {
  const id = (key: string) => {
    const value = first(params[key]);
    return value && UUID.test(value) ? value : "";
  };
  const type = first(params.type);
  return {
    productId: id("productId"),
    warehouseId: id("warehouseId"),
    type: type && Object.hasOwn(TYPE_LABEL, type) ? type : "",
  };
}
