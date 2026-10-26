import { z } from "zod";
import { ApiError } from "@/lib/api-client";

// Client-side check for quick messages only; the server validates again (rule 4). The limits match
// src/modules/stock/stock-schema.ts (BL11). The quantity input is text: an empty or non-numeric value
// is rejected instead of silently becoming 0.
export const stockReceiveSchema = z.object({
  warehouseId: z.string().min(1, "Pilih gudang."),
  productId: z.string().min(1, "Pilih produk."),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+$/, "Jumlah harus bilangan bulat antara 1 dan 1.000.000.")
    .transform(Number)
    .pipe(z.number().min(1, "Jumlah minimal 1.").max(1_000_000, "Jumlah maksimal 1.000.000.")),
  // An empty note is left out of the request.
  note: z
    .string()
    .trim()
    .max(255, "Catatan maksimal 255 karakter.")
    .transform((value) => (value === "" ? undefined : value)),
});

export type StockReceiveInput = z.input<typeof stockReceiveSchema>;
export type StockReceiveValues = z.output<typeof stockReceiveSchema>;

export type ReceiveErrorView = { field?: "quantity"; message: string };

/** Maps the API answer to Indonesian text; a 400 belongs under the quantity input, the rest in a banner. */
export function receiveErrorMessage(error: unknown): ReceiveErrorView {
  if (error instanceof ApiError) {
    if (error.status === 403) return { message: "Anda tidak punya akses ke gudang ini." };
    if (error.status === 404) return { message: "Produk atau gudang tidak ditemukan." };
    // 409: the server text says whether the warehouse or product is archived, or the limit is hit.
    if (error.status === 409) return { message: error.message };
    if (error.status === 400) {
      return {
        field: "quantity",
        message: "Jumlah harus bilangan bulat antara 1 dan 1.000.000.",
      };
    }
  }
  return { message: "Stok belum dapat dicatat. Silakan coba lagi." };
}
