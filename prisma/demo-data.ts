// The content of the demo organization (E6-03): plain data, no database access. The e2e tests import
// it too, so the names they look for can never drift from what the seed creates.
import type { AdjustBody, TransferBody } from "../src/modules/stock/stock-schema";

export const DEMO_WAREHOUSES = [
  { code: "GDG-JKT", name: "Gudang Pusat Jakarta", address: "Jl. Industri Raya No. 12, Jakarta" },
  { code: "GDG-CKR", name: "Gudang Cikarang", address: "Kawasan Industri Jababeka, Cikarang" },
  { code: "GDG-SBY", name: "Gudang Surabaya", address: "Jl. Rungkut Industri No. 8, Surabaya" },
] as const;

type WarehouseCode = (typeof DEMO_WAREHOUSES)[number]["code"];
type Unit = "bks" | "ktk" | "pcs" | "btl" | "jrg" | "pak";

// Different minStock values on purpose: the status (OUT, LOW, OK) is judged against each product's own.
export const DEMO_PRODUCTS: readonly { sku: string; name: string; unit: Unit; minStock: number }[] =
  [
    { sku: "MIE-GRG-001", name: "Mie Goreng Instan 85 g", unit: "bks", minStock: 100 },
    { sku: "MIE-KUA-002", name: "Mie Kuah Soto 75 g", unit: "bks", minStock: 100 },
    { sku: "BER-5KG-003", name: "Beras Premium 5 kg", unit: "pak", minStock: 30 },
    { sku: "GUL-1KG-004", name: "Gula Pasir 1 kg", unit: "pak", minStock: 40 },
    { sku: "MNY-2LT-005", name: "Minyak Goreng 2 liter", unit: "btl", minStock: 24 },
    { sku: "TEH-CEL-006", name: "Teh Celup 25 kantong", unit: "ktk", minStock: 20 },
    { sku: "KOP-SAC-007", name: "Kopi Sachet 3 in 1", unit: "bks", minStock: 150 },
    { sku: "SUS-UHT-008", name: "Susu UHT Cokelat 1 liter", unit: "ktk", minStock: 36 },
    { sku: "AIR-600-009", name: "Air Mineral 600 ml", unit: "btl", minStock: 120 },
    { sku: "SBN-MND-010", name: "Sabun Mandi Batang", unit: "pcs", minStock: 50 },
    { sku: "SMP-SCH-011", name: "Sampo Sachet 10 ml", unit: "bks", minStock: 200 },
    { sku: "DET-800-012", name: "Deterjen Bubuk 800 g", unit: "pak", minStock: 25 },
    { sku: "PST-GGI-013", name: "Pasta Gigi 120 g", unit: "pcs", minStock: 30 },
    { sku: "TIS-ROL-014", name: "Tisu Gulung 4 roll", unit: "pak", minStock: 40 },
    { sku: "KCP-MNS-015", name: "Kecap Manis 600 ml", unit: "btl", minStock: 20 },
    { sku: "SAU-SBL-016", name: "Saus Sambal 340 ml", unit: "btl", minStock: 20 },
    { sku: "GAR-HLS-017", name: "Garam Halus 250 g", unit: "bks", minStock: 40 },
    { sku: "TPG-TRG-018", name: "Tepung Terigu 1 kg", unit: "pak", minStock: 30 },
    { sku: "BSK-COK-019", name: "Biskuit Cokelat 140 g", unit: "ktk", minStock: 24 },
    { sku: "PEN-BLP-020", name: "Pulpen Hitam", unit: "pcs", minStock: 60 },
    { sku: "BKU-TLS-021", name: "Buku Tulis 38 Lembar", unit: "pcs", minStock: 80 },
    { sku: "MNY-5LT-022", name: "Minyak Goreng 5 liter", unit: "jrg", minStock: 10 },
    { sku: "LPU-LED-023", name: "Lampu LED 9 Watt", unit: "pcs", minStock: 20 },
    { sku: "KRT-SMP-024", name: "Kantong Sampah Hitam", unit: "pak", minStock: 30 },
    { sku: "TLR-AYM-025", name: "Telur Ayam 1 kg", unit: "pak", minStock: 15 },
  ];

// Warehouse assignments by account email. The Owner reaches every warehouse without a row (BL10).
export const DEMO_ASSIGNMENTS: Record<WarehouseCode, readonly string[]> = {
  "GDG-JKT": ["gudang@demotoko.test", "viewer@demotoko.test"],
  "GDG-CKR": [],
  "GDG-SBY": ["viewer@demotoko.test"],
};

// Every operation has a stable NAME. Its idempotency key is derived from that name (demo-seed.ts), so
// a second run replays instead of acting again. Quantities are chosen so the dashboard shows both
// 8 LOW pairs and 2 OUT pairs (JKT 012 by an adjustment, CKR 022 by a transfer). The e2e login
// scenario asserts these two numbers.
const receipt = (warehouse: WarehouseCode, sku: string, quantity: number) => ({
  name: `receive:${warehouse}:${sku}`,
  warehouse,
  sku,
  quantity,
  note: "Stok awal",
});

export const DEMO_RECEIPTS = [
  ...(
    [
      ["MIE-GRG-001", 500],
      ["MIE-KUA-002", 350],
      ["BER-5KG-003", 120],
      ["GUL-1KG-004", 90],
      ["MNY-2LT-005", 60],
      ["TEH-CEL-006", 80],
      ["KOP-SAC-007", 600],
      ["SUS-UHT-008", 15],
      ["AIR-600-009", 400],
      ["SBN-MND-010", 20],
      ["SMP-SCH-011", 900],
      ["DET-800-012", 70],
      ["PST-GGI-013", 100],
      ["TIS-ROL-014", 18],
    ] as const
  ).map(([sku, quantity]) => receipt("GDG-JKT", sku, quantity)),
  ...(
    [
      ["MIE-GRG-001", 200],
      ["MNY-2LT-005", 40],
      ["KCP-MNS-015", 30],
      ["SAU-SBL-016", 12],
      ["MNY-5LT-022", 6],
    ] as const
  ).map(([sku, quantity]) => receipt("GDG-CKR", sku, quantity)),
  ...(
    [
      ["GAR-HLS-017", 60],
      ["TPG-TRG-018", 45],
      ["TLR-AYM-025", 10],
    ] as const
  ).map(([sku, quantity]) => receipt("GDG-SBY", sku, quantity)),
];

export const DEMO_ADJUSTMENTS: readonly {
  name: string;
  warehouse: WarehouseCode;
  sku: string;
  body: Pick<AdjustBody, "mode" | "value" | "reason">;
}[] = [
  {
    name: "adjust:GDG-JKT:AIR-600-009",
    warehouse: "GDG-JKT",
    sku: "AIR-600-009",
    body: { mode: "DELTA", value: -30, reason: "DAMAGED" },
  },
  {
    name: "adjust:GDG-JKT:DET-800-012",
    warehouse: "GDG-JKT",
    sku: "DET-800-012",
    body: { mode: "SET", value: 0, reason: "STOCK_OPNAME" },
  },
];

export const DEMO_TRANSFERS: readonly {
  name: string;
  from: WarehouseCode;
  to: WarehouseCode;
  items: readonly { sku: string; quantity: number }[];
  note: TransferBody["note"];
}[] = [
  {
    name: "transfer:JKT-CKR:1",
    from: "GDG-JKT",
    to: "GDG-CKR",
    items: [
      { sku: "MIE-KUA-002", quantity: 50 },
      { sku: "GUL-1KG-004", quantity: 20 },
    ],
    note: "Pengisian stok Cikarang",
  },
  {
    name: "transfer:JKT-SBY:1",
    from: "GDG-JKT",
    to: "GDG-SBY",
    items: [{ sku: "MIE-GRG-001", quantity: 100 }],
    note: "Pengisian stok Surabaya",
  },
  {
    name: "transfer:CKR-JKT:1",
    from: "GDG-CKR",
    to: "GDG-JKT",
    items: [{ sku: "MNY-5LT-022", quantity: 6 }],
    note: "Konsolidasi stok jerigen",
  },
];
