# API Specification: Simpul Stok

|          |                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version  | 2.1 (22 Oct 2026)                                                                                                                                                        |
| Purpose  | The list of REST endpoints, who may call them, and the general conventions                                                                                               |
| Audience | People who build endpoints, clients, and API tests                                                                                                                       |
| Related  | The rules for each endpoint are in `02_Functional_Spec.md` (BL); the error format is in BL29; the documentation is run through one `.http` file per resource in the repo |

## REST endpoint list (51)

REST through Next.js Route Handlers is the main path between the UI and the server. List pages may read directly through a service in Server Components, but every write action uses these endpoints. All endpoints follow BL02, BL03, and BL29, are validated with Zod, and return JSON.

| Resource                        | Endpoints                                                                                                                                                                                         | Role                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth (7)                        | `POST /api/auth/login`, `POST /api/auth/register-organization`, `POST /api/auth/accept-invite`, `POST /api/auth/reset-password`, `POST /api/auth/logout`, `GET /api/me`, `PATCH /api/me/password` | The first four are public (accept-invite and reset-password use a token); the rest are for any logged-in user                                                                            |
| Organization (2)                | `GET /api/organization`, `PATCH /api/organization`                                                                                                                                                | Read: every tenant user; update: Owner                                                                                                                                                   |
| Members and invitations (7)     | `GET /api/members`, `PATCH /api/members/:id`, `POST /api/members/:id/reset-link`, `GET /api/invitations`, `POST /api/invitations`, `DELETE /api/invitations/:id`, `GET /api/invitations/:token`   | Owner; the last one is public with a token                                                                                                                                               |
| Warehouses (5)                  | `GET /api/warehouses`, `POST /api/warehouses`, `GET /api/warehouses/:id`, `PATCH /api/warehouses/:id`, `PUT /api/warehouses/:id/members`                                                          | Read according to assigned warehouses; write: Owner                                                                                                                                      |
| Products (4)                    | `GET /api/products`, `POST /api/products`, `GET /api/products/:id`, `PATCH /api/products/:id`                                                                                                     | Read: every tenant user; write: Owner                                                                                                                                                    |
| Stock (7)                       | `GET /api/stock`, `POST /api/stock/receive`, `POST /api/stock/adjust`, `POST /api/stock/transfers`, `GET /api/stock/transfers/:id`, `GET /api/stock/movements`, `GET /api/stock/movements/:id`    | Read according to assigned warehouses; write: Owner and Warehouse Admin according to warehouse                                                                                           |
| Import and export (4)           | `POST /api/imports`, `POST /api/imports/:id/commit`, `GET /api/exports/stock`, `GET /api/exports/movements`                                                                                       | Import: Owner and Warehouse Admin; export according to warehouse. `exports/stock` also serves S07 and accepts `format` csv, xlsx, or pdf; `exports/movements` supports only csv and xlsx |
| Dashboard and notifications (3) | `GET /api/dashboard`, `GET /api/notifications`, `PATCH /api/notifications/:id/read`                                                                                                               | Every tenant user                                                                                                                                                                        |
| Billing (6)                     | `GET /api/billing`, `POST /api/billing/invoices`, `GET /api/billing/invoices`, `GET /api/billing/invoices/:id`, `POST /api/billing/invoices/:id/cancel`, `POST /api/webhooks/xendit`              | Owner; the webhook is public with token verification                                                                                                                                     |
| Audit (1)                       | `GET /api/audit-logs`                                                                                                                                                                             | Owner                                                                                                                                                                                    |
| Platform (3)                    | `GET /api/platform/organizations`, `GET /api/platform/organizations/:id`, `PATCH /api/platform/organizations/:id/status`                                                                          | Platform admin                                                                                                                                                                           |
| System (2)                      | `GET /api/cron/daily`, `GET /api/health`                                                                                                                                                          | Cron with a secret; health is public                                                                                                                                                     |

Endpoints that change stock (`receive`, `adjust`, `transfers`, `imports/:id/commit`) accept an `Idempotency-Key` header (BL14). The history (`GET /api/stock/movements`) uses cursor pagination (BL16); other list endpoints use `page` and `pageSize` and return a total. Archiving and restoring a warehouse or product goes through `PATCH` (`archived: true` or `false`). Every write is also checked by BL23.

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
