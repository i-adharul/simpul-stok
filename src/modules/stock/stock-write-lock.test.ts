import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOCK_EXEMPT } from "./lock-exemptions";

// ADR 0013: every stock write takes the warehouse lock first. This static check fails CI when a file in
// this module writes StockLevel or StockMovement without calling lockWarehouse(, so a new stock write
// (adjust, transfer, import) cannot forget the lock that keeps archived warehouses free of stock.

const WRITES =
  /\b(stockLevel\.(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)|stockMovement\.(create|createMany|createManyAndReturn))\b/;
const LOCK_CALL = /\blockWarehouse\(/;

// Comments may mention the calls; only code counts.
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

type SourceFile = { name: string; source: string };

export function lockProblems(files: SourceFile[], exempt: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [name, reason] of Object.entries(exempt)) {
    if (reason.trim() === "") problems.push(`LOCK_EXEMPT "${name}" has no reason`);
  }
  for (const { name, source } of files) {
    const code = stripComments(source);
    if (WRITES.test(code) && !LOCK_CALL.test(code) && !(name in exempt)) {
      problems.push(
        `${name} writes stock without calling lockWarehouse(; take the lock first (ADR 0013) or list the file in lock-exemptions.ts with a reason`,
      );
    }
  }
  return problems;
}

function moduleFiles(): SourceFile[] {
  return readdirSync(__dirname)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({ name, source: readFileSync(path.join(__dirname, name), "utf8") }));
}

describe("stock write lock (real files)", () => {
  it("every non-test file in modules/stock that writes stock calls lockWarehouse(", () => {
    const files = moduleFiles();
    expect(files.map((f) => f.name)).toContain("stock-service.ts");
    expect(lockProblems(files, LOCK_EXEMPT)).toEqual([]);
  });
});

describe("lockProblems (synthetic files)", () => {
  const unlocked = "await tx.stockLevel.update({ where: {}, data: {} });";
  const locked = `await lockWarehouse(tx, id);\n${unlocked}`;

  it("fails a file that writes stock without the lock", () => {
    for (const write of [
      "tx.stockLevel.update(x)",
      "tx.stockLevel.updateMany(x)",
      "tx.stockLevel.createMany(x)",
      "tx.stockLevel.upsert(x)",
      "tx.stockLevel.delete(x)",
      "tx.stockLevel.deleteMany(x)",
      "tx.stockMovement.create(x)",
      "tx.stockMovement.createMany(x)",
    ]) {
      expect(lockProblems([{ name: "adjust.ts", source: write }], {}), write).toEqual([
        expect.stringContaining("adjust.ts writes stock without calling lockWarehouse("),
      ]);
    }
  });

  it("passes a file that takes the lock, and a file that only reads", () => {
    expect(lockProblems([{ name: "adjust.ts", source: locked }], {})).toEqual([]);
    expect(
      lockProblems([{ name: "list.ts", source: "await db.stockLevel.findMany({});" }], {}),
    ).toEqual([]);
  });

  it("ignores a write that is only named in a comment", () => {
    const source = "// tx.stockLevel.update(x) happens in the service\n/* stockMovement.create */";
    expect(lockProblems([{ name: "doc.ts", source }], {})).toEqual([]);
  });

  it("passes a listed exemption and fails one without a reason", () => {
    const file = { name: "import.ts", source: unlocked };
    expect(lockProblems([file], { "import.ts": "writes through the locked service" })).toEqual([]);
    expect(lockProblems([file], { "import.ts": " " })).toEqual([
      expect.stringContaining('LOCK_EXEMPT "import.ts" has no reason'),
    ]);
  });
});
