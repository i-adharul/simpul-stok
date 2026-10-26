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
