// Every route under src/app/api must be in exactly ONE of three places (inventory.test.ts):
//   1. TENANT_ENDPOINTS in registry.ts: a tenant route with cross-tenant tests;
//   2. EXEMPT_ROUTES: a tenant route that cannot be tested that way, with the reason;
//   3. PUBLIC_ROUTES: a route that is not tenant at all (no withTenantRoute), with the reason.
// Keys are the route folder below src/app/api, for example "warehouses/[id]".
// Adding an entry here is a security decision: write the reason so a reviewer can disagree.

export const EXEMPT_ROUTES: Record<string, string> = {};

export const PUBLIC_ROUTES: Record<string, string> = {
  health: "Health check; reads no tenant data.",
  "auth/login": "Authentication; there is no session yet, so there is no tenant.",
  "auth/logout": "Only clears the caller's own session cookie.",
  me: "The signed-in user's own profile, read through getCurrentUser; no tenant resource ID.",
  "me/password": "The signed-in user changes their own password; no tenant resource ID.",
};

// A registry entry that writes under stock/, transfers or imports must be `idempotent: true`
// (inventory.test.ts). One that really needs no Idempotency-Key is listed here by its name, for
// example "POST /api/imports", with the reason. Adding an entry is a decision a reviewer may reject.
export const IDEMPOTENCY_EXEMPT: Record<string, string> = {};
