import { z } from "zod";

// BL08: the code is stored uppercase, in a free format; unique per organization (database constraint).
const code = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .transform((value) => value.toUpperCase());
const name = z.string().trim().min(1).max(100);
// An empty address is stored as null.
const address = z
  .string()
  .trim()
  .max(255)
  .nullable()
  .transform((value) => (value === "" ? null : value));

export const createWarehouseBody = z.strictObject({ code, name, address: address.optional() });

// Archiving goes through PATCH too, but arrives in E3-03; until then `archived` is rejected as unknown.
export const updateWarehouseBody = z
  .strictObject({ code: code.optional(), name: name.optional(), address: address.optional() })
  .refine((body) => Object.keys(body).length > 0, { message: "At least one field is required." });

export const warehouseIdParams = z.object({ id: z.string() });

export const listWarehousesQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // Owner only; other roles never see archived warehouses.
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type CreateWarehouseBody = z.output<typeof createWarehouseBody>;
export type UpdateWarehouseBody = z.output<typeof updateWarehouseBody>;
export type ListWarehousesQuery = z.output<typeof listWarehousesQuery>;
