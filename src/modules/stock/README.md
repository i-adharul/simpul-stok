# Stock module

The inventory domain of Simpul Stok:

- warehouses and products
- stock levels, receipts and adjustments
- stock movements (immutable history)
- transfers between warehouses

Dependency rule: this module may import from `modules/platform`, never the other way around.
See `docs/decisions/0002-module-boundaries.md`.
