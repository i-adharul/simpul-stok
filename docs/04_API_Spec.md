# API Specification: Simpul Stok

|          |                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version  | 2.1 (22 Oct 2026)                                                                                                                                                        |
| Purpose  | The list of REST endpoints, who may call them, and the general conventions                                                                                               |
| Audience | People who build endpoints, clients, and API tests                                                                                                                       |
| Related  | The rules for each endpoint are in `02_Functional_Spec.md` (BL); the error format is in BL29; the documentation is run through one `.http` file per resource in the repo |

## REST endpoint list (52)

REST through Next.js Route Handlers is the main path between the UI and the server. List pages may read directly through a service in Server Components, but every write action uses these endpoints. All endpoints follow BL02, BL03, and BL29, are validated with Zod, and return JSON.

| Resource                        | Endpoints                                                                                                                                                                                         | Role                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth (7)                        | `POST /api/auth/login`, `POST /api/auth/register-organization`, `POST /api/auth/accept-invite`, `POST /api/auth/reset-password`, `POST /api/auth/logout`, `GET /api/me`, `PATCH /api/me/password` | The first four are public (accept-invite and reset-password use a token); the rest are for any logged-in user                                                                            |
| Organization (2)                | `GET /api/organization`, `PATCH /api/organization`                                                                                                                                                | Read: every tenant user; update: Owner                                                                                                                                                   |
| Members and invitations (7)     | `GET /api/members`, `PATCH /api/members/:id`, `POST /api/members/:id/reset-link`, `GET /api/invitations`, `POST /api/invitations`, `DELETE /api/invitations/:id`, `GET /api/invitations/:token`   | Owner; the last one is public with a token                                                                                                                                               |
| Warehouses (6)                  | `GET /api/warehouses`, `POST /api/warehouses`, `GET /api/warehouses/:id`, `PATCH /api/warehouses/:id`, `GET /api/warehouses/:id/members`, `PUT /api/warehouses/:id/members`                       | Read according to assigned warehouses; write: Owner                                                                                                                                      |
| Products (4)                    | `GET /api/products`, `POST /api/products`, `GET /api/products/:id`, `PATCH /api/products/:id`                                                                                                     | Read: every tenant user; write: Owner                                                                                                                                                    |
| Stock (7)                       | `GET /api/stock`, `POST /api/stock/receive`, `POST /api/stock/adjust`, `POST /api/stock/transfers`, `GET /api/stock/transfers/:id`, `GET /api/stock/movements`, `GET /api/stock/movements/:id`    | Read according to assigned warehouses; write: Owner and Warehouse Admin according to warehouse                                                                                           |
| Import and export (4)           | `POST /api/imports`, `POST /api/imports/:id/commit`, `GET /api/exports/stock`, `GET /api/exports/movements`                                                                                       | Import: Owner and Warehouse Admin; export according to warehouse. `exports/stock` also serves S07 and accepts `format` csv, xlsx, or pdf; `exports/movements` supports only csv and xlsx |
| Dashboard and notifications (3) | `GET /api/dashboard`, `GET /api/notifications`, `PATCH /api/notifications/:id/read`                                                                                                               | Every tenant user                                                                                                                                                                        |
| Billing (6)                     | `GET /api/billing`, `POST /api/billing/invoices`, `GET /api/billing/invoices`, `GET /api/billing/invoices/:id`, `POST /api/billing/invoices/:id/cancel`, `POST /api/webhooks/xendit`              | Owner; the webhook is public with token verification                                                                                                                                     |
| Audit (1)                       | `GET /api/audit-logs`                                                                                                                                                                             | Owner                                                                                                                                                                                    |
| Platform (3)                    | `GET /api/platform/organizations`, `GET /api/platform/organizations/:id`, `PATCH /api/platform/organizations/:id/status`                                                                          | Platform admin                                                                                                                                                                           |
| System (2)                      | `GET /api/cron/daily`, `GET /api/health`                                                                                                                                                          | Cron with a secret; health is public                                                                                                                                                     |

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
