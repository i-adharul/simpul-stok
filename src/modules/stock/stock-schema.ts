import { z } from "zod";

// BL11: a whole number from 1 to 1,000,000. strictObject rejects organizationId (rule 1) and any other
// unknown field with a 400.
export const MAX_RECEIPT_QUANTITY = 1_000_000;

// An empty note is stored as null.
const note = z
  .string()
  .trim()
  .max(255)
  .transform((value) => (value === "" ? null : value));

export const receiveBody = z.strictObject({
  warehouseId: z.uuid(),
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_RECEIPT_QUANTITY),
  note: note.optional(),
});
export type ReceiveBody = z.infer<typeof receiveBody>;
