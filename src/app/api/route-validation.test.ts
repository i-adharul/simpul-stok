import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasValidationDecision } from "../../lib/api-handler";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const apiDir = path.join(__dirname);

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

// Fail closed: a write route that never decided about validation must not ship.
describe("API route handlers", () => {
  const files = routeFiles(apiDir);

  it("finds the existing routes", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(files.map((file) => [path.relative(apiDir, file), file]))(
    "%s wraps every method in withApiLog and decides about body validation",
    async (_name, file) => {
      const mod = (await import(file)) as Record<string, unknown>;
      for (const method of METHODS.filter((m) => m in mod)) {
        const route = mod[method] as { apiOptions?: Parameters<typeof hasValidationDecision>[1] };
        expect(route.apiOptions, `${method} is not wrapped in withApiLog`).toBeDefined();
        expect(
          hasValidationDecision(method, route.apiOptions!),
          `${method} needs body: schema or body: "none"`,
        ).toBe(true);
      }
    },
  );
});
