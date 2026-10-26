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

// BL12/BL15. SET: value is the new quantity (0 to 1,000,000). DELTA: value is a non-zero whole number
// whose absolute size is at most 1,000,000. The result (new quantity) is checked in the service, under
// the warehouse lock, because it depends on the current stock.
export const MAX_ADJUST_QUANTITY = 1_000_000;
export const ADJUST_REASONS = ["STOCK_OPNAME", "DAMAGED", "LOST", "CORRECTION"] as const;

const adjustBase = {
  warehouseId: z.uuid(),
  productId: z.uuid(),
  reason: z.enum(ADJUST_REASONS),
  note: note.optional(),
};

export const adjustBody = z.discriminatedUnion("mode", [
  z.strictObject({
    ...adjustBase,
    mode: z.literal("SET"),
    value: z.number().int().min(0).max(MAX_ADJUST_QUANTITY),
  }),
  z.strictObject({
    ...adjustBase,
    mode: z.literal("DELTA"),
    value: z
      .number()
      .int()
      .min(-MAX_ADJUST_QUANTITY)
      .max(MAX_ADJUST_QUANTITY)
      .refine((v) => v !== 0, "Selisih tidak boleh 0."),
  }),
]);
export type AdjustBody = z.infer<typeof adjustBody>;
