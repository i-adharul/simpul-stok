import { z } from "zod";
import { ApiError } from "@/lib/api-client";

// Client-side check for quick messages only; the server validates again (rule 4). The limits match
// src/modules/stock/stock-schema.ts (BL12). Inputs are text so an empty value is rejected instead of
// silently becoming 0.
export const ADJUST_REASON_LABELS = {
  STOCK_OPNAME: "Stok opname",
  DAMAGED: "Rusak",
  LOST: "Hilang",
  CORRECTION: "Koreksi",
} as const;
const REASONS = Object.keys(ADJUST_REASON_LABELS) as [
  keyof typeof ADJUST_REASON_LABELS,
  ...(keyof typeof ADJUST_REASON_LABELS)[],
];

const LIMIT = 1_000_000;

const common = {
  warehouseId: z.string().min(1, "Pilih gudang."),
  productId: z.string().min(1, "Pilih produk."),
  reason: z.enum(REASONS, "Pilih alasan."),
  // An empty note is left out of the request.
  note: z
    .string()
    .trim()
    .max(255, "Catatan maksimal 255 karakter.")
    .transform((value) => (value === "" ? undefined : value)),
};

export const stockAdjustSchema = z.discriminatedUnion("mode", [
  z.object({
    ...common,
    mode: z.literal("SET"),
    value: z
      .string()
      .trim()
      .regex(/^\d+$/, "Stok baru harus bilangan bulat antara 0 dan 1.000.000.")
      .transform(Number)
      .pipe(z.number().max(LIMIT, "Stok baru maksimal 1.000.000.")),
  }),
  z.object({
    ...common,
    mode: z.literal("DELTA"),
    value: z
      .string()
      .trim()
      .regex(/^[+-]?\d+$/, "Selisih harus bilangan bulat, boleh negatif.")
      .transform(Number)
      .pipe(
        z
          .number()
          .refine((n) => n !== 0, "Selisih tidak boleh 0.")
          .refine((n) => Math.abs(n) <= LIMIT, "Selisih maksimal 1.000.000."),
      ),
  }),
]);

export type StockAdjustInput = z.input<typeof stockAdjustSchema>;
export type StockAdjustValues = z.output<typeof stockAdjustSchema>;

export type AdjustErrorView = { field?: "value"; message: string };

/** Maps the API answer to Indonesian text; a 400 belongs under the value input, the rest in a banner. */
export function adjustErrorMessage(error: unknown): AdjustErrorView {
  if (error instanceof ApiError) {
    if (error.status === 403) return { message: "Anda tidak punya akses ke gudang ini." };
    if (error.status === 404) return { message: "Produk atau gudang tidak ditemukan." };
    // 409 and 400 carry a specific Indonesian server text (below 0, no difference, archived, too large).
    if (error.status === 409) return { message: error.message };
    if (error.status === 400) return { field: "value", message: error.message };
  }
  return { message: "Stok belum dapat disesuaikan. Silakan coba lagi." };
}
