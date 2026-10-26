# Stock module

The inventory domain of Simpul Stok:

- warehouses and products
- stock levels, receipts and adjustments
- stock movements (immutable history)
- transfers between warehouses

Dependency rule: this module may import from `modules/platform`, never the other way around.
See `docs/decisions/0002-module-boundaries.md`.

Every endpoint of this module is a tenant endpoint: register it in `src/test/tenant-isolation/registry.ts` in the
same story (how: `src/test/README.md`, `docs/06_Test_Plan.md` "Registering a new endpoint").

## Stock writes (BL11, BL15, ADR 0013)

- Every stock write runs in one transaction and takes `lockWarehouse` (`warehouse-lock.ts`) first. Only then does it
  read `archivedAt` and the stock. Archiving a warehouse takes the same lock, so archiving and a stock write cannot
  interleave: an archived warehouse never holds stock.
- The handler calls `authorize()` against `ctx.warehouseIds` before anything else. That list never holds an archived
  warehouse, so a warehouse that was **already** archived when the request arrived gives **403**. A **409** appears
  only when the warehouse is archived while the request is running (the race the lock closes). A product has no such
  list: an archived product gives 409. The id of another organization's warehouse and the id of a missing one both
  give the same 403; a product of another organization gives the same 404 as a missing product.
- The response of a stock write holds only immutable data of the created movement, never the current quantity.
