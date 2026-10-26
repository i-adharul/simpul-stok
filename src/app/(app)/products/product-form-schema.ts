import { z } from "zod";
import { ApiError } from "@/lib/api-client";

// Client-side check for quick messages only; the server validates again (rule 4). The limits and units
// match src/modules/stock/product-schema.ts (not imported: that file is server-side code).
export const PRODUCT_UNITS = [
  { value: "bks", label: "bks (bungkus)" },
  { value: "ktk", label: "ktk (kotak)" },
  { value: "pcs", label: "pcs (buah)" },
  { value: "btl", label: "btl (botol)" },
  { value: "jrg", label: "jrg (jeriken)" },
  { value: "pak", label: "pak (paket)" },
] as const;

export const productFormSchema = z.object({
  // Same normalisation as BL09: no whitespace, uppercase.
  sku: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().min(1, "SKU wajib diisi.").max(50, "SKU maksimal 50 karakter.")),
  name: z.string().trim().min(1, "Nama wajib diisi.").max(100, "Nama maksimal 100 karakter."),
  unit: z.enum(["bks", "ktk", "pcs", "btl", "jrg", "pak"], {
    message: "Pilih satuan.",
  }),
  // The input is text; an empty or non-numeric value is rejected instead of silently becoming 0.
  minStock: z
    .string()
    .trim()
    .regex(/^\d+$/, "Batas minimum harus berupa bilangan bulat 0 atau lebih.")
    .transform(Number)
    .pipe(z.number().max(1_000_000_000, "Batas minimum terlalu besar.")),
});

export type ProductFormInput = z.input<typeof productFormSchema>;
export type ProductFormValues = z.output<typeof productFormSchema>;

/** A duplicate SKU (409 CONFLICT) belongs under the SKU input; any other error is shown as a banner. */
export function skuConflictMessage(error: unknown): string | null {
  return error instanceof ApiError && error.code === "CONFLICT" ? error.message : null;
}
