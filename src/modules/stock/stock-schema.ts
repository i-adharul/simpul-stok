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

// BL16 history. Keyset (cursor) pagination, never offset (E4-07): one page is 50 rows. The cursor is
// opaque to the client; it holds only the (createdAt, id) of the last row, never an organization.
export const MOVEMENTS_PAGE_SIZE = 50;
export const MOVEMENT_TYPES = [
  "RECEIVE",
  "ADJUST",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "IMPORT",
] as const;

export type MovementCursor = { createdAt: Date; id: string };

export const encodeMovementCursor = (cursor: MovementCursor): string =>
  Buffer.from(JSON.stringify({ t: cursor.createdAt.toISOString(), id: cursor.id })).toString(
    "base64url",
  );

// Returns null for anything that is not a cursor this API made, so the schema answers 400.
export function decodeMovementCursor(value: string): MovementCursor | null {
  try {
    const raw: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const parsed = z.object({ t: z.iso.datetime(), id: z.uuid() }).safeParse(raw);
    if (!parsed.success) return null;
    return { createdAt: new Date(parsed.data.t), id: parsed.data.id };
  } catch {
    return null;
  }
}

const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

// `from` is inclusive and `to` is exclusive, both instants with an offset (the UI sends WIB day bounds).
export const listMovementsQuery = z.object({
  productId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  createdById: z.uuid().optional(),
  from: instant.optional(),
  to: instant.optional(),
  cursor: z
    .string()
    .max(200)
    .transform((value, ctx) => {
      const decoded = decodeMovementCursor(value);
      if (!decoded) ctx.addIssue({ code: "custom", message: "Invalid cursor." });
      return decoded ?? z.NEVER;
    })
    .optional(),
});
export type ListMovementsQuery = z.output<typeof listMovementsQuery>;
