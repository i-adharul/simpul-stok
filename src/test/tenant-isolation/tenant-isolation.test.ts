import { describe, expect, it } from "vitest";
import { TENANT_ENDPOINTS } from "./registry";
import { describeTenantIsolation } from "./run-harness";

// Runs the harness on every registered tenant endpoint. Nothing to write per endpoint here: add the
// endpoint to registry.ts (see src/test/README.md) and these tests appear.
describeTenantIsolation(TENANT_ENDPOINTS);

describe("registry", () => {
  it("is a list", () => {
    expect(Array.isArray(TENANT_ENDPOINTS)).toBe(true);
  });
});
