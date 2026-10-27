import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CI gate: every endpoint in src/app/api has its own `### \`METHOD /api/...\`` section in
// docs/04_API_Spec.md, so a new endpoint cannot ship undocumented. Read from the source text, no imports.
const API_DIR = path.resolve(__dirname, "../app/api");
const SPEC = path.resolve(__dirname, "../../docs/04_API_Spec.md");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

// "warehouses/[id]/members" -> "/api/warehouses/:id/members"
export function docPathOf(folder: string): string {
  return `/api/${folder.replace(/\[([^\]]+)\]/g, ":$1")}`;
}

function endpointHeadings(): string[] {
  const out: string[] = [];
  for (const file of routeFiles(API_DIR)) {
    const folder = path.relative(API_DIR, path.dirname(file)).split(path.sep).join("/");
    const source = readFileSync(file, "utf8");
    for (const method of METHODS) {
      if (new RegExp(`export\\s+(const|async\\s+function|function)\\s+${method}\\b`).test(source)) {
        out.push(`${method} ${docPathOf(folder)}`);
      }
    }
  }
  return out.sort();
}

describe("docs/04_API_Spec.md", () => {
  const spec = readFileSync(SPEC, "utf8");
  const headings = new Set(
    spec
      .split("\n")
      .map((line) => /^### `(.+)`$/.exec(line)?.[1])
      .filter((heading): heading is string => Boolean(heading)),
  );

  it("finds the routes (guards against a broken scan)", () => {
    expect(endpointHeadings().length).toBeGreaterThan(15);
  });

  it("has a section for every endpoint in src/app/api", () => {
    const missing = endpointHeadings().filter((endpoint) => !headings.has(endpoint));
    expect(
      missing,
      `Add a "### \`METHOD /path\`" section to docs/04_API_Spec.md for: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("maps dynamic segments to :name", () => {
    expect(docPathOf("warehouses/[id]/members")).toBe("/api/warehouses/:id/members");
    expect(docPathOf("health")).toBe("/api/health");
  });
});
