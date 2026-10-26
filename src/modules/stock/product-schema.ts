import { z } from "zod";

// BL09: the SKU is stored uppercase without any whitespace; unique per organization (database constraint).
const sku = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().min(1).max(50));
const name = z.string().trim().min(1).max(100);
export const PRODUCT_UNITS = ["bks", "ktk", "pcs", "btl", "jrg", "pak"] as const;
const unit = z.enum(PRODUCT_UNITS);
const minStock = z.number().int().min(0).max(1_000_000_000);

export const createProductBody = z.strictObject({
  sku,
  name,
  unit,
  minStock: minStock.default(0),
});

// Archiving (true) and restoring (false) go through PATCH too (docs/04).
export const updateProductBody = z
  .strictObject({
    sku: sku.optional(),
    name: name.optional(),
    unit: unit.optional(),
    minStock: minStock.optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required." });

export const productIdParams = z.object({ id: z.string() });

export const listProductsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // Owner only; other roles never see archived products.
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type CreateProductBody = z.output<typeof createProductBody>;
export type UpdateProductBody = z.output<typeof updateProductBody>;
export type ListProductsQuery = z.output<typeof listProductsQuery>;
