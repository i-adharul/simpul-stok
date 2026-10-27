# API Specification: Simpul Stok

|          |                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version  | 2.2 (27 Oct 2026)                                                                                                                                                        |
| Purpose  | The list of REST endpoints, who may call them, and the general conventions                                                                                               |
| Audience | People who build endpoints, clients, and API tests                                                                                                                       |
| Related  | The rules for each endpoint are in `02_Functional_Spec.md` (BL); the error format is in BL29; the documentation is run through one `.http` file per resource in the repo |

## REST endpoint list (53)

REST through Next.js Route Handlers is the main path between the UI and the server. List pages may read directly through a service in Server Components, but every write action uses these endpoints. All endpoints follow BL02, BL03, and BL29, are validated with Zod, and return JSON.

| Resource                        | Endpoints                                                                                                                                                                                                                               | Role                                                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth (7)                        | `POST /api/auth/login`, `POST /api/auth/register-organization`, `POST /api/auth/accept-invite`, `POST /api/auth/reset-password`, `POST /api/auth/logout`, `GET /api/me`, `PATCH /api/me/password`                                       | The first four are public (accept-invite and reset-password use a token); the rest are for any logged-in user                                                                            |
| Organization (2)                | `GET /api/organization`, `PATCH /api/organization`                                                                                                                                                                                      | Read: every tenant user; update: Owner                                                                                                                                                   |
| Members and invitations (7)     | `GET /api/members`, `PATCH /api/members/:id`, `POST /api/members/:id/reset-link`, `GET /api/invitations`, `POST /api/invitations`, `DELETE /api/invitations/:id`, `GET /api/invitations/:token`                                         | Owner; the last one is public with a token                                                                                                                                               |
| Warehouses (6)                  | `GET /api/warehouses`, `POST /api/warehouses`, `GET /api/warehouses/:id`, `PATCH /api/warehouses/:id`, `GET /api/warehouses/:id/members`, `PUT /api/warehouses/:id/members`                                                             | Read according to assigned warehouses; write: Owner                                                                                                                                      |
| Products (4)                    | `GET /api/products`, `POST /api/products`, `GET /api/products/:id`, `PATCH /api/products/:id`                                                                                                                                           | Read: every tenant user; write: Owner                                                                                                                                                    |
| Stock (8)                       | `GET /api/stock`, `POST /api/stock/receive`, `POST /api/stock/adjust`, `POST /api/stock/transfers`, `GET /api/stock/transfers/destinations`, `GET /api/stock/transfers/:id`, `GET /api/stock/movements`, `GET /api/stock/movements/:id` | Read according to assigned warehouses; write: Owner and Warehouse Admin according to warehouse                                                                                           |
| Import and export (4)           | `POST /api/imports`, `POST /api/imports/:id/commit`, `GET /api/exports/stock`, `GET /api/exports/movements`                                                                                                                             | Import: Owner and Warehouse Admin; export according to warehouse. `exports/stock` also serves S07 and accepts `format` csv, xlsx, or pdf; `exports/movements` supports only csv and xlsx |
| Dashboard and notifications (3) | `GET /api/dashboard`, `GET /api/notifications`, `PATCH /api/notifications/:id/read`                                                                                                                                                     | Every tenant user                                                                                                                                                                        |
| Billing (6)                     | `GET /api/billing`, `POST /api/billing/invoices`, `GET /api/billing/invoices`, `GET /api/billing/invoices/:id`, `POST /api/billing/invoices/:id/cancel`, `POST /api/webhooks/xendit`                                                    | Owner; the webhook is public with token verification                                                                                                                                     |
| Audit (1)                       | `GET /api/audit-logs`                                                                                                                                                                                                                   | Owner                                                                                                                                                                                    |
| Platform (3)                    | `GET /api/platform/organizations`, `GET /api/platform/organizations/:id`, `PATCH /api/platform/organizations/:id/status`                                                                                                                | Platform admin                                                                                                                                                                           |
| System (2)                      | `GET /api/cron/daily`, `GET /api/health`                                                                                                                                                                                                | Cron with a secret; health is public                                                                                                                                                     |

Endpoints that exist in the code have their own section below, headed `METHOD /path` (`src/test/api-docs.test.ts` fails when a `route.ts` has none); the others in this list are planned for M2 and M3.

Endpoints that change stock (`receive`, `adjust`, `transfers`, `imports/:id/commit`) accept an `Idempotency-Key` header (BL14). The history (`GET /api/stock/movements`) uses cursor pagination (BL16); other list endpoints use `page` and `pageSize` and return a total. Archiving and restoring a warehouse or product goes through `PATCH` (`archived: true` or `false`). Every write is also checked by BL23.

## Idempotency (BL14)

**Request header `Idempotency-Key`.** Required on every write that changes stock (`POST /api/stock/receive`, `POST /api/stock/adjust`, `POST /api/stock/transfers`, `POST /api/imports/:id/commit`). The value must be a UUID (the client creates a new one each time a form is opened). A missing or malformed header returns `400 { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "source": "header", "path": "Idempotency-Key", "message": "..." }] }`. The check runs after authentication and the role check and before the body is validated. Keys are compared in lower case.

**Scope.** A key is unique per organization and endpoint. The same key on another endpoint, or in another organization, is a different key.

**Replay.** If a request with the same key already succeeded, the server does not act again. It answers with the same status and body shape as the first response, built from the stored resource, and adds the response header `Idempotency-Replayed: true`. The body of the repeated request is not compared. Two requests with the same key at the same time produce one effect; one of them is answered as a replay.

**A replay is authorized again.** If the caller may not see the stored resource (for example a Warehouse Admin of another warehouse), the answer is `404 NOT_FOUND`, identical to a resource that does not exist. A caller who may not perform the action gets `403` even when the key exists.

**Failures.** A request that fails (4xx or 5xx) stores no key, so the same key can be sent again. Keys older than 24 hours are removed by the daily cron; after that the same key counts as new.

`POST /api/billing/invoices` determines `kind` from the organization's condition (INITIAL for a trial, PLAN_CHANGE if subscribed and the plan differs, RENEWAL if the plan is the same) and accepts `planId` (BL21). `POST /api/billing/invoices/:id/cancel` is only for PENDING PLAN_CHANGE invoices and sets them to EXPIRED. `GET /api/billing` returns the effective limits (BL20).

## Auth endpoints: request and response

Every error body is `{ code, message, details }` (BL29). All responses below carry `Cache-Control: no-store`. Error `message` texts are shown to users, so they are in Indonesian.

**CSRF (all write methods).** `POST`, `PUT`, `PATCH`, and `DELETE` must carry an `Origin` header whose scheme and host equal the request's own (scheme from `x-forwarded-proto` when present, host from `x-forwarded-host` or `Host`). Otherwise the proxy answers before any handler runs: `403 { "code": "CSRF_REJECTED", "message": "Request origin is not allowed.", "details": null }`. Only `POST /api/webhooks/xendit` is exempt (it is verified by its callback token). Non-browser clients must send the header themselves.

### `POST /api/auth/login`

Public. Body: `{ "email": string (1-254), "password": string (1-128) }`. Only the shape is validated; the email is matched in lowercase.

| Status | Body                                                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "user": { "id", "name", "email", "role" }, "redirectTo": "/dashboard" }`, or `"/platform"` for `PLATFORM_ADMIN`. Sets the session cookie.                                                  |
| 400    | `{ "code": "VALIDATION_ERROR", "message": "Email dan password wajib diisi.", "details": null }` (missing field, wrong shape, or body is not JSON)                                             |
| 401    | `{ "code": "INVALID_CREDENTIALS", "message": "Email atau password salah.", "details": null }` (unknown email, wrong password, inactive user, or password over 72 bytes: one identical answer) |
| 403    | `CSRF_REJECTED`                                                                                                                                                                               |

The session cookie is `__Host-simpul_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age=28800` (8 hours). The token is never in the body.

### `POST /api/auth/logout`

Any caller, with or without a session; no body. Always `204` with no body and a `Set-Cookie` that empties the session cookie (`Max-Age=0`, same attributes). Logging out twice is harmless. `403 CSRF_REJECTED` when the Origin check fails.

### `GET /api/me`

Any logged-in user.

| Status | Body                                                                                                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "user": { "id", "name", "email", "role" }, "organization": { "id", "name", "slug", "status" } \| null }` (`organization` is `null` for a platform admin)                                                           |
| 401    | `{ "code": "UNAUTHENTICATED", "message": "Sesi tidak valid. Silakan masuk lagi.", "details": null }` (no cookie, bad or expired token, inactive or missing user, or a session issued before the last password change) |

### `PATCH /api/me/password`

Any logged-in user, in every subscription state (BL23). Body: `{ "currentPassword": string (1-128), "newPassword": string (1-128) }`. The password rules apply to `newPassword` only, and only after `currentPassword` is verified.

| Status | Body                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 204    | No body. Sets a new session cookie for this device; sessions created earlier (including on other devices) get `401` afterwards.                                    |
| 400    | `{ "code": "INVALID_CURRENT_PASSWORD", "message": "Password saat ini salah.", "details": null }`                                                                   |
| 400    | `{ "code": "VALIDATION_ERROR", "message": "Password saat ini dan password baru wajib diisi.", "details": null }` (missing field, wrong shape, or body is not JSON) |
| 400    | `{ "code": "VALIDATION_ERROR", "message": <reason the new password is refused>, "details": { "field": "newPassword" } }`                                           |
| 401    | `UNAUTHENTICATED`, as for `GET /api/me`                                                                                                                            |
| 403    | `CSRF_REJECTED`                                                                                                                                                    |

## Error codes

Every error body is `{ code, message, details }` (BL29), with no stack trace. `message` is Indonesian. The codes below are the complete set the code can return (`src/lib/api-error.ts`, plus three set where the check happens).

| Code                       | Status | Meaning                                                                                                                                                                       |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`         | 400    | Header, query, path or body failed validation. `details` is `[{ "source": "header" \| "query" \| "params" \| "body", "path", "message" }]`, or `null` for a rule found later. |
| `INVALID_CURRENT_PASSWORD` | 400    | `PATCH /api/me/password` only: the current password is wrong.                                                                                                                 |
| `UNAUTHENTICATED`          | 401    | No valid session.                                                                                                                                                             |
| `INVALID_CREDENTIALS`      | 401    | `POST /api/auth/login` only: wrong email or password.                                                                                                                         |
| `FORBIDDEN`                | 403    | The role may not do this, the warehouse is outside the caller's reach, or the caller is a platform admin on a tenant endpoint.                                                |
| `CSRF_REJECTED`            | 403    | A write request without a same-origin `Origin` header (set by the proxy, before any handler).                                                                                 |
| `PLAN_LIMIT_REACHED`       | 403    | Defined for plan limits; no endpoint returns it yet (E8).                                                                                                                     |
| `SUBSCRIPTION_READ_ONLY`   | 403    | Defined for a read-only subscription; no endpoint returns it yet (E8).                                                                                                        |
| `NOT_FOUND`                | 404    | Missing, or belongs to another organization (one identical body, rule 2).                                                                                                     |
| `CONFLICT`                 | 409    | The request is valid but the current state refuses it (duplicate code or SKU, archived target, stock still present, quantity limit).                                          |
| `INSUFFICIENT_STOCK`       | 409    | A transfer needs more than the source holds; `details: { "productId" }`.                                                                                                      |
| `INTERNAL_ERROR`           | 500    | Unexpected failure. No cause in the body.                                                                                                                                     |

Every tenant endpoint below also answers `401 UNAUTHENTICATED`, `403 FORBIDDEN` for a platform admin (a platform admin has no organization), `400 VALIDATION_ERROR` for invalid input and `500 INTERNAL_ERROR`; these are not repeated in each table. A role without the right gets `403` before the query or body is validated.

## Warehouses (S05, BL08)

### `GET /api/warehouses`

Every tenant role (`warehouse.read`). Owner: every active warehouse; Warehouse Admin and Viewer: only the assigned ones. Query: `page` (default 1), `pageSize` (default 20, at most 100), `includeArchived` (`true` or `false`, default `false`; honoured for the Owner only). Order: `code`, then `id`.

| Status | Body                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "items": [{ "id", "organizationId", "code", "name", "address", "archivedAt", "createdAt", "updatedAt" }], "total", "page", "pageSize" }` |
| 400    | `VALIDATION_ERROR`: `page` below 1, `pageSize` outside 1 to 100, or `includeArchived` not `true` or `false`                                 |

### `POST /api/warehouses`

Owner only (`warehouse.manage`). Body (unknown fields, including `organizationId`, are rejected): `code` (1 to 20 characters after trimming, stored uppercase, unique per organization), `name` (1 to 100), `address` (optional, at most 255; empty is stored null).

| Status | Body                                                                            |
| ------ | ------------------------------------------------------------------------------- |
| 201    | The created warehouse, same shape as an item of the list above                  |
| 400    | `VALIDATION_ERROR`: wrong shape, a field out of range, or an unknown field      |
| 403    | `FORBIDDEN`: not the Owner                                                      |
| 409    | `CONFLICT`: "Kode gudang sudah dipakai." (the code exists in this organization) |

### `PATCH /api/warehouses/:id`

Owner only (`warehouse.manage`). Body (strict, at least one field): `code`, `name`, `address` (same rules as `POST`) and `archived` (`true` archives, `false` restores). Archiving locks the warehouse row and refuses while any stock row is above 0 (ADR 0013).

| Status | Body                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| 200    | The updated warehouse                                                                                             |
| 400    | `VALIDATION_ERROR`: no field given, wrong shape, or an unknown field                                              |
| 403    | `FORBIDDEN`: not the Owner                                                                                        |
| 404    | `NOT_FOUND`: missing or foreign. An archived warehouse is found only when restoring (`archived: false`).          |
| 409    | `CONFLICT`: the code exists, or "Gudang masih memiliki stok. Kosongkan stok sebelum mengarsipkan." when archiving |

## Products (S07, BL09)

### `GET /api/products`

Every tenant role (`product.read`). Query: `page` (default 1), `pageSize` (default 20, at most 100), `includeArchived` (default `false`; honoured for the Owner only). Order: `sku`, then `id`.

| Status | Body                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "items": [{ "id", "organizationId", "sku", "name", "unit", "minStock", "archivedAt", "createdAt", "updatedAt" }], "total", "page", "pageSize" }` |
| 400    | `VALIDATION_ERROR`: as for `GET /api/warehouses`                                                                                                    |

### `POST /api/products`

Owner only (`product.manage`). Body (strict): `sku` (whitespace removed, stored uppercase, 1 to 50 characters, unique per organization), `name` (1 to 100), `unit` (`bks`, `ktk`, `pcs`, `btl`, `jrg` or `pak`), `minStock` (optional whole number 0 to 1,000,000,000, default 0).

| Status | Body                                                         |
| ------ | ------------------------------------------------------------ |
| 201    | The created product, same shape as an item of the list above |
| 400    | `VALIDATION_ERROR`                                           |
| 403    | `FORBIDDEN`: not the Owner                                   |
| 409    | `CONFLICT`: "SKU sudah dipakai."                             |

### `GET /api/products/:id`

Every tenant role (`product.read`). An archived product is visible to the Owner only.

| Status | Body                                                                                     |
| ------ | ---------------------------------------------------------------------------------------- |
| 200    | The product                                                                              |
| 404    | `NOT_FOUND`: missing, malformed id, foreign, or archived and the caller is not the Owner |

### `PATCH /api/products/:id`

Owner only (`product.manage`). Body (strict, at least one field): `sku`, `name`, `unit`, `minStock` (same rules as `POST`) and `archived` (`true` archives, `false` restores). Archiving a product that still has stock is allowed (BL09).

| Status | Body                                                                  |
| ------ | --------------------------------------------------------------------- |
| 200    | The updated product                                                   |
| 400    | `VALIDATION_ERROR`: no field given, wrong shape, or an unknown field  |
| 403    | `FORBIDDEN`: not the Owner                                            |
| 404    | `NOT_FOUND`: missing or foreign (an archived one only when restoring) |
| 409    | `CONFLICT`: "SKU sudah dipakai."                                      |

## Warehouse detail (S06)

### `GET /api/warehouses/:id`

Every tenant role that may read the warehouse (`warehouse.read`; Warehouse Admin and Viewer only when assigned, else `403`). The `200` body is the warehouse (`id`, `code`, `name`, `address`, `archivedAt`, ...) plus `"assignedUsers": [{ "id", "name", "role" }]`: the active users assigned to it, sorted by name, without emails (the list is empty when nobody is assigned). `404` when the warehouse is missing or belongs to another organization; an archived warehouse is visible to the Owner only.

## Warehouse assignment (BL10)

### `GET /api/warehouses/:id/members`

Owner only (`member.manage`; other roles get `403` before anything else). Lists the users who can be assigned to the warehouse: active users of the organization whose role is `WAREHOUSE_ADMIN` or `VIEWER` (the Owner and platform admins never appear).

| Status | Body                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 200    | `{ "candidates": [{ "id", "name", "email", "role", "assigned": boolean }] }`, sorted by name; `assigned` is for this warehouse |
| 404    | `NOT_FOUND`: the warehouse is missing, archived, or belongs to another organization                                            |

### `PUT /api/warehouses/:id/members`

Owner only (`member.manage`). Body: `{ "userIds": string[] }`: UUIDs, no duplicates, at most 200. It **replaces** the whole set of assignments of this warehouse in one transaction, so repeating the same request gives the same result. An empty list removes every assignment.

| Status | Body                                                                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | Same shape as the `GET` above, after the change                                                                                                             |
| 400    | `VALIDATION_ERROR`: wrong shape, duplicate or malformed IDs, more than 200, or a user that is inactive or not a Warehouse Admin or Viewer (generic message) |
| 404    | `NOT_FOUND`: the warehouse is missing, archived or foreign, or any user ID is missing or belongs to another organization (the same body for both)           |

## Stock summary (S09, BL15, BL16)

### `GET /api/stock`

Every role (`stock.read`). Lists one row per (warehouse, product) pair that **has a stock row**; a pair without a row is not returned (the UI draws that strip in S06 and S08). Only warehouses the caller may access are included (Owner: all active warehouses; others: the assigned ones).

| Query         | Rule                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `warehouseId` | optional UUID; authorized first (`403` for a warehouse the caller cannot access, the same body for a foreign and a missing id) |
| `productId`   | optional UUID; a foreign or unknown product simply gives an empty list                                                         |
| `q`           | optional, at most 100 characters; case-insensitive "contains" on the product SKU or name                                       |
| `status`      | optional `OUT`, `LOW` or `OK`                                                                                                  |
| `page`        | default 1                                                                                                                      |
| `pageSize`    | default 20, at most 100                                                                                                        |

Status of a pair uses the minimum of its own product: `OUT` when quantity is 0; `LOW` when quantity is above 0 and below `minStock`; `OK` when quantity is above 0 and at or above `minStock` (so `minStock` 0 or 1 is never `LOW`). Rows of archived products appear only while their quantity is above 0 (`product.archived: true`). Order: product name, warehouse code, then IDs.

| Status | Body                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 200    | `{ "items": [{ "warehouse": { "id", "code", "name" }, "product": { "id", "sku", "name", "unit", "minStock", "archived" }, "quantity", "status", "updatedAt" }], "total", "page", "pageSize", "summary": { "out", "low", "ok" } }`; `summary` counts the same filters except `status` |
| 400    | `VALIDATION_ERROR`: a malformed ID, an unknown `status`, `page` below 1, or `pageSize` outside 1 to 100                                                                                                                                                                              |
| 403    | `FORBIDDEN`: `warehouseId` is not accessible to the caller                                                                                                                                                                                                                           |

## Stock receipt (BL11)

### `POST /api/stock/receive`

Owner and Warehouse Admin (`stock.receive`; a Warehouse Admin only for an assigned warehouse). Header `Idempotency-Key` (UUID) is required, see "Idempotency (BL14)". Body (unknown fields, including `organizationId`, are rejected):

| Field         | Rule                                                                  |
| ------------- | --------------------------------------------------------------------- |
| `warehouseId` | UUID                                                                  |
| `productId`   | UUID                                                                  |
| `quantity`    | whole number from 1 to 1,000,000                                      |
| `note`        | optional, at most 255 characters after trimming; empty is stored null |

One transaction locks the warehouse row, rejects an archived warehouse or product, creates the stock row of the pair when it is missing, adds `quantity` and writes a `RECEIVE` movement (ADR 0013). The response holds only immutable data of that movement, never the current stock, so a replay equals the first answer; read the stock from `GET /api/stock`.

| Status | Body                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201    | `{ "id", "warehouseId", "productId", "quantity", "createdAt" }`; a replay of the same key gives the same body plus the header `Idempotency-Replayed: true`                                               |
| 400    | `VALIDATION_ERROR`: missing or malformed `Idempotency-Key`, wrong shape, `quantity` out of range, `note` over 255 characters, or an unknown field                                                        |
| 403    | `FORBIDDEN`: a Viewer, or a warehouse that is not assigned to a Warehouse Admin, is archived, belongs to another organization or does not exist (the same body for all of these)                         |
| 404    | `NOT_FOUND`: a product that belongs to another organization or does not exist (the same body for both)                                                                                                   |
| 409    | `CONFLICT` (Indonesian message): the product is archived; the warehouse was archived while the request was running; or the new quantity would pass the largest value the column can hold (2,147,483,647) |

## Stock adjustment (BL12)

### `POST /api/stock/adjust`

Owner and Warehouse Admin (`stock.adjust`; a Warehouse Admin only for an assigned warehouse). Header `Idempotency-Key` (UUID) is required, see "Idempotency (BL14)". Body (strict):

| Field         | Rule                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `warehouseId` | UUID                                                                                                                         |
| `productId`   | UUID                                                                                                                         |
| `mode`        | `SET` (`value` is the new quantity, 0 to 1,000,000) or `DELTA` (`value` is a non-zero whole number, -1,000,000 to 1,000,000) |
| `value`       | whole number, see `mode`                                                                                                     |
| `reason`      | `STOCK_OPNAME`, `DAMAGED`, `LOST` or `CORRECTION`                                                                            |
| `note`        | optional, at most 255 characters after trimming; empty is stored null                                                        |

One transaction locks the warehouse row, reads the current quantity, writes the new one with a conditional update and writes an `ADJUST` movement (ADR 0013). An archived product may be adjusted (so leftover stock can be zeroed); an archived warehouse may not.

| Status | Body                                                                                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201    | `{ "id", "warehouseId", "productId", "quantity", "createdAt", "reason" }` where `quantity` is the signed change; a replay gives the same body plus `Idempotency-Replayed: true`                      |
| 400    | `VALIDATION_ERROR`: missing or malformed `Idempotency-Key`, wrong shape, unknown field, `value` out of range, or the new quantity equals the current one ("Stok baru sama dengan stok saat ini ...") |
| 403    | `FORBIDDEN`: a Viewer, or a warehouse that is not assigned to a Warehouse Admin, is archived, belongs to another organization or does not exist (the same body for all of these)                     |
| 404    | `NOT_FOUND`: a product that belongs to another organization or does not exist                                                                                                                        |
| 409    | `CONFLICT`: the new quantity would be below 0; the warehouse was archived while the request ran; or the stock changed during the request ("Stok berubah saat disesuaikan. Coba lagi.")               |

## Stock history (S10, BL16)

### `GET /api/stock/movements`

Every tenant role (`history.read`, warehouse-level). Only movements of the caller's warehouses are returned (Owner: all active warehouses). Newest first, cursor pagination, 50 rows per page. Query, all optional:

| Query         | Rule                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `productId`   | UUID                                                                       |
| `warehouseId` | UUID; a warehouse outside the caller's reach gives an empty list, not 403  |
| `type`        | `RECEIVE`, `ADJUST`, `TRANSFER_OUT`, `TRANSFER_IN` or `IMPORT`             |
| `createdById` | UUID                                                                       |
| `from`, `to`  | ISO 8601 instants with an offset; `from` is inclusive, `to` is exclusive   |
| `cursor`      | the `nextCursor` of the previous page, opaque; any other value gives `400` |

| Status | Body                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 200    | `{ "items": [{ "id", "warehouseId", "productId", "type", "quantityDelta", "reason", "note", "transferId", "createdById", "createdAt" }], "nextCursor": string \| null }` |
| 400    | `VALIDATION_ERROR`: a malformed ID, an unknown `type`, a bad instant or a bad `cursor`                                                                                   |

### `GET /api/stock/movements/:id`

Every tenant role (`history.read`). A malformed ID, a missing one, another organization's and one outside the caller's warehouses all give the same `404 NOT_FOUND`.

| Status | Body                                                                                                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | An item of the list above plus `"warehouse": { "id", "code", "name" }`, `"product": { "id", "sku", "name", "unit" }`, `"createdBy": { "id", "name", "role" } \| null` and `"transfer": { "id", "code", "fromWarehouse": { "id", "name" }, "toWarehouse": { ... } } \| null`. No email. |
| 404    | `NOT_FOUND`: see above                                                                                                                                                                                                                                                                 |

## Stock transfer (BL13, BL14)

### `POST /api/stock/transfers`

Owner and Warehouse Admin (`stock.transfer`, judged against the SOURCE warehouse; a Warehouse Admin only for an assigned source). The destination may be any active warehouse of the organization. Header `Idempotency-Key` (UUID) is required, see "Idempotency (BL14)". Body (unknown fields, including `organizationId`, are rejected):

| Field               | Rule                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| `fromWarehouseId`   | UUID, the source                                                      |
| `toWarehouseId`     | UUID, must differ from `fromWarehouseId`                              |
| `items`             | 1 to 50 entries, each product at most once                            |
| `items[].productId` | UUID                                                                  |
| `items[].quantity`  | whole number from 1 to 1,000,000                                      |
| `note`              | optional, at most 255 characters after trimming; empty is stored null |

One transaction locks both warehouses in ascending id order, rejects an archived source, destination or product, decrements the source with a conditional update, increments the destination, creates the transfer (`MT-0001`, sequential per organization) and writes a `TRANSFER_OUT` and a `TRANSFER_IN` movement per item (ADR 0013, 0014). The response holds only immutable data, never stock balances, so a replay equals the first answer.

| Status | Body                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201    | `{ "id", "code", "fromWarehouseId", "toWarehouseId", "items": [{ "productId", "quantity" }], "note", "createdAt" }`; a replay of the same key gives the same body plus the header `Idempotency-Replayed: true`               |
| 400    | `VALIDATION_ERROR`: missing or malformed `Idempotency-Key`, wrong shape, 0 or more than 50 items, a duplicate product, `quantity` out of range, source equal to destination, `note` over 255 characters, or an unknown field |
| 403    | `FORBIDDEN`: a Viewer, or a source warehouse that is not assigned to a Warehouse Admin, is archived, belongs to another organization or does not exist (the same body for all of these)                                      |
| 404    | `NOT_FOUND`: a destination warehouse or a product that belongs to another organization or does not exist (the same body for both)                                                                                            |
| 409    | `CONFLICT`: the source, destination or a product is archived; the quantity at the destination would pass 2,147,483,647; or too many concurrent transfers collided ("Terlalu banyak mutasi bersamaan, coba lagi.")            |
| 409    | `INSUFFICIENT_STOCK` with `details: { "productId" }` of the first item (ordered by product id) that the source cannot cover; nothing is written                                                                              |

### `GET /api/stock/transfers/:id`

Any tenant role (`history.read`, warehouse-level). Visible when the caller may see the source OR the destination warehouse (an Owner sees all). A malformed ID, a missing one, another organization's and one outside the caller's warehouses all give the same `404 NOT_FOUND`. Used by S12 and by the link in P13.

| Status | Body                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "id", "code", "note", "createdAt", "createdBy": { "id", "name", "role" } \| null, "fromWarehouse": { "id", "code", "name", "address" }, "toWarehouse": { ... }, "items": [{ "productId", "sku", "name", "unit", "quantity", "outMovementId", "inMovementId" }] }`; items ordered by product ID; a movement ID is `null` when its warehouse is not one the caller may see (P13 would answer 404). No stock balances, no email |
| 404    | `NOT_FOUND`: see above                                                                                                                                                                                                                                                                                                                                                                                                          |

### `GET /api/stock/transfers/destinations`

Owner and Warehouse Admin (`transfer.destinations`, organization-level); a Viewer gets 403. Returns every active warehouse of the organization, because `GET /api/warehouses` lists only the assigned ones for a Warehouse Admin and the destination of a transfer may be any warehouse (BL13). No query parameters.

| Status | Body                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------- |
| 200    | `{ "items": [{ "id", "code", "name" }] }`, ordered by `code`; archived warehouses are left out |
| 403    | `FORBIDDEN`: a Viewer                                                                          |

## Dashboard (S04, BL16)

### `GET /api/dashboard`

Every tenant role. No query, no cache: each call reads the database. `totalProducts` counts the active products of the whole organization; every other figure covers only the caller's warehouses (an Owner has all active ones). `totalUnits` includes the units of archived products; `lowCount` and `outCount` leave archived products out. "Today" is the WIB calendar day (00:00 to 24:00 WIB). A transfer writes two movements, so it counts twice in `movementsToday` and can show twice in `recentActivity`.

| Status | Body                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "summary": { "totalProducts", "totalUnits", "lowCount", "outCount", "movementsToday" }, "restock": { "items": [{ "warehouse": { "id", "code", "name" }, "product": { "id", "sku", "name", "unit", "minStock" }, "quantity", "status": "OUT" \| "LOW" }], "total" }, "recentActivity": [{ "id", "type", "quantityDelta", "reason", "createdAt", "warehouse": { "id", "code", "name" }, "product": { "id", "sku", "name", "unit" }, "createdBy": { "id", "name" } \| null, "transfer": { "id", "code" } \| null }] }`. `restock.items` holds at most 5 pairs, the furthest below `minStock` first; `recentActivity` holds the 5 newest movements. |

## System

### `GET /api/health`

Public, no session. Never cached (`Cache-Control: no-store`). The database check is cached inside the server for 60 seconds when up and 15 seconds when down. The body has no error text, host or database version.

| Status | Body                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------ |
| 200    | `{ "status": "ok", "app": { "commit": string \| null }, "database": { "status": "up", "latencyMs" } }` |
| 503    | `{ "status": "error", "app": { "commit": string \| null }, "database": { "status": "down" } }`         |
