// A file in src/modules/stock/ that writes stock without calling lockWarehouse( must be listed here by its
// file name, with the reason (stock-write-lock.test.ts, ADR 0013). Adding an entry is a decision a reviewer may
// reject: the lock is what keeps an archived warehouse free of stock (BL08).
export const LOCK_EXEMPT: Record<string, string> = {};
