import { z } from "zod";

// Client-side check for quick messages only; the server validates again (rule 4). The limits match
// src/modules/stock/warehouse-schema.ts. The API stores an empty address as null.
export const warehouseFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "Kode wajib diisi.")
    .max(20, "Kode maksimal 20 karakter.")
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1, "Nama wajib diisi.").max(100, "Nama maksimal 100 karakter."),
  address: z.string().trim().max(255, "Alamat maksimal 255 karakter."),
});

export type WarehouseFormInput = z.input<typeof warehouseFormSchema>;
export type WarehouseFormValues = z.output<typeof warehouseFormSchema>;
