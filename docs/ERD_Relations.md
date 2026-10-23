# Simpul ERD: relations list (text)

This document is the text version of the ERD, so it can be read without the diagram. Its source is the table "Data model (17 entities)" in `03_Data_Model.md`. The diagram is `ERD.png`. Notation: `A 1—N B` means one A has many B, and the linking column is on table B.

Updated 20 Oct 2026 after a consistency check against the PRD (the changes are summarized in section 8). Re-checked against `03_Data_Model.md` and the diagram redrawn on 21 Oct 2026; there are no differences in content.

## 1. Relations to the tenant (Organization)

Every business entity carries `organizationId`. Plan and WebhookEvent are global and do not have that column.

| No  | Relation                        | Linking column                       | Notes                                                                                                            |
| --- | ------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1   | Organization 1—N User           | User.organizationId                  | Empty for a platform admin                                                                                       |
| 2   | Organization 1—N Invitation     | Invitation.organizationId            |                                                                                                                  |
| 3   | Organization 1—N Warehouse      | Warehouse.organizationId             |                                                                                                                  |
| 4   | Organization 1—N UserWarehouse  | UserWarehouse.organizationId         |                                                                                                                  |
| 5   | Organization 1—N Product        | Product.organizationId               |                                                                                                                  |
| 6   | Organization 1—N StockLevel     | StockLevel.organizationId            |                                                                                                                  |
| 7   | Organization 1—N StockTransfer  | StockTransfer.organizationId         |                                                                                                                  |
| 8   | Organization 1—N StockMovement  | StockMovement.organizationId         |                                                                                                                  |
| 9   | Organization 1—N IdempotencyKey | IdempotencyKey.organizationId        |                                                                                                                  |
| 10  | Organization 1—N ImportJob      | ImportJob.organizationId             |                                                                                                                  |
| 11  | Organization 1—1 Subscription   | Subscription.organizationId (unique) | One subscription per organization. The subscription status is stored in Organization.status, not in Subscription |
| 12  | Organization 1—N Invoice        | Invoice.organizationId               |                                                                                                                  |
| 13  | Organization 1—N AuditLog       | AuditLog.organizationId              | A platform admin's action on an organization uses the target organization's organizationId                       |
| 14  | Organization 1—N Notification   | Notification.organizationId          |                                                                                                                  |

## 2. Access

| No  | Relation                    | Linking column            | Notes                                                                                                                                                                                                    |
| --- | --------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 15  | User 1—N UserWarehouse      | UserWarehouse.userId      |                                                                                                                                                                                                          |
| 16  | Warehouse 1—N UserWarehouse | UserWarehouse.warehouseId | Together with no. 15 this forms a many-to-many relation between User and Warehouse. Only Warehouse Admins and Viewers have rows here. An Owner accesses all active warehouses without UserWarehouse rows |
| 17  | User 1—N Invitation         | Invitation.createdById    | The creator of the invitation. Used by S03 ("invited by")                                                                                                                                                |

An Invitation stores the warehouses to be assigned as a list of IDs (`warehouseIds`), not as a foreign key.

## 3. Inventory

| No  | Relation                                  | Linking column                | Notes                                                                                    |
| --- | ----------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- |
| 18  | Product 1—N StockLevel                    | StockLevel.productId          |                                                                                          |
| 19  | Warehouse 1—N StockLevel                  | StockLevel.warehouseId        | The pair (warehouseId, productId) is unique. The row is created when stock first arrives |
| 20  | Product 1—N StockMovement                 | StockMovement.productId       |                                                                                          |
| 21  | Warehouse 1—N StockMovement               | StockMovement.warehouseId     | One movement row affects one warehouse                                                   |
| 22  | User 1—N StockMovement                    | StockMovement.createdById     | The creator of the movement                                                              |
| 23  | StockTransfer 1—N StockMovement           | StockMovement.transferId      | Optional. One transfer produces two rows per item (TRANSFER_OUT and TRANSFER_IN)         |
| 24  | ImportJob 1—N StockMovement               | StockMovement.importJobId     | Optional. Type IMPORT                                                                    |
| 25  | Warehouse 1—N StockTransfer (source)      | StockTransfer.fromWarehouseId |                                                                                          |
| 26  | Warehouse 1—N StockTransfer (destination) | StockTransfer.toWarehouseId   | Must differ from the source warehouse. May be any active warehouse of the organization   |
| 27  | User 1—N StockTransfer                    | StockTransfer.createdById     |                                                                                          |
| 28  | User 1—N ImportJob                        | ImportJob.createdById         |                                                                                          |

## 4. Subscription

| No  | Relation                 | Linking column         | Notes                                                           |
| --- | ------------------------ | ---------------------- | --------------------------------------------------------------- |
| 29  | Plan 1—N Subscription    | Subscription.planId    | Plan is global. A trial organization points to the Starter plan |
| 30  | Plan 1—N Invoice         | Invoice.planId         | The plan in effect after the invoice is paid                    |
| 31  | Subscription 1—N Invoice | Invoice.subscriptionId |                                                                 |

## 5. System

| No  | Relation              | Linking column      | Notes                             |
| --- | --------------------- | ------------------- | --------------------------------- |
| 32  | User 1—N AuditLog     | AuditLog.actorId    | The actor of the action           |
| 33  | User 1—N Notification | Notification.userId | The recipient of the notification |

## 6. Logical relations (no foreign key)

| No  | Relation                        | Linked by                                | Notes                                                                                                        |
| --- | ------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 34  | StockLevel ↔ StockMovement      | Application rule (BL11 to BL13 and BL18) | Every change to StockLevel writes one StockMovement row in the same transaction                              |
| 35  | WebhookEvent ↔ Invoice          | Invoice.externalId and the event body    | WebhookEvent is global. The platform console (S20) finds an organization's events through Invoice.externalId |
| 36  | IdempotencyKey → request result | IdempotencyKey.resourceId                | Points to a StockTransfer, StockMovement, or ImportJob depending on `endpoint`                               |
| 37  | AuditLog → any object           | AuditLog.entityType and entityId         | A loose reference, not a foreign key                                                                         |

## 7. Important constraints

| Entity         | Constraint                                                                                                                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization   | `slug` is globally unique, 3 to 30 lowercase letters and digits                                                                                                                                                                                                                   |
| User           | `email` is globally unique and stored in lowercase. One Owner per organization (application rule, BL07)                                                                                                                                                                           |
| Invitation     | One pending invitation per (`organizationId`, `email`) (application rule, BL05)                                                                                                                                                                                                   |
| Warehouse      | (`organizationId`, `code`) is unique                                                                                                                                                                                                                                              |
| Product        | (`organizationId`, `sku`) is unique. `unit` comes from a fixed list (bks, ktk, pcs, btl, jrg, pak) and `minStock` defaults to 0                                                                                                                                                   |
| UserWarehouse  | (`userId`, `warehouseId`) is unique                                                                                                                                                                                                                                               |
| StockLevel     | (`warehouseId`, `productId`) is unique and `CHECK quantity >= 0`                                                                                                                                                                                                                  |
| StockTransfer  | (`organizationId`, `code`) is unique, format MT-0001                                                                                                                                                                                                                              |
| StockMovement  | Append-only, never updated or deleted                                                                                                                                                                                                                                             |
| AuditLog       | Append-only                                                                                                                                                                                                                                                                       |
| IdempotencyKey | (`organizationId`, `key`, `endpoint`) is unique. Cleaned up by cron after 24 hours                                                                                                                                                                                                |
| Subscription   | `organizationId` is unique. `billingDay` is 1 to 31, or empty during the trial (application rule, BL21 and BL22)                                                                                                                                                                  |
| Invoice        | (`organizationId`, `number`) is unique, format INV-year-0001. `kind` (INITIAL, PLAN_CHANGE, RENEWAL) and `expiresAt` determine validity (BL21). `periodStart` and `periodEnd` are updated on payment if the invoice is INITIAL or the payment falls after the grace period (BL22) |
| WebhookEvent   | (`provider`, `eventId`) is unique                                                                                                                                                                                                                                                 |

Composite indexes on large tables (StockMovement, StockLevel) start with `organizationId`, per BL16.

## 8. Consistency check results

**Columns added to the entity table in the PRD** because a screen or business rule needs them:

| Entity        | New column                                                                | Reason                                                                                                                     |
| ------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| All entities  | `createdAt` (and `updatedAt` for those that are not append-only tables)   | S08 shows a product's created date, S19 shows an organization's created date                                               |
| User          | `role` was given values: PLATFORM_ADMIN, OWNER, WAREHOUSE_ADMIN, VIEWER   | The enum was not defined before                                                                                            |
| User          | `passwordChangedAt`, `resetTokenHash`, `resetExpiresAt`                   | Password reset by an Owner through a link (BL07), and old sessions are revoked after the password changes                  |
| Invitation    | `createdById`                                                             | S03 shows "invited by"                                                                                                     |
| StockTransfer | `code`                                                                    | S11, S12, and S10 show MT-0021                                                                                             |
| StockMovement | `note`, and the `reason` values (STOCK_OPNAME, DAMAGED, LOST, CORRECTION) | Receipts and adjustments have a note, whereas the earlier column was only `reason`                                         |
| ImportJob     | `rows`                                                                    | An import commit needs the valid rows that were already checked; `errorReport` is not enough                               |
| Invoice       | `planId`, `number`                                                        | The new plan takes effect when the invoice is paid, and S16 shows the invoice number                                       |
| Subscription  | `billingDay`                                                              | The billing anchor date, clamped to the last day of shorter months without shifting its value (not in the ERD diagram yet) |
| Invoice       | `kind`, `expiresAt`                                                       | Validity and period handling differ per invoice kind: initial, plan change, renewal (not in the ERD diagram yet)           |
| Notification  | `type` value TRIAL_ENDING                                                 | Reminder that the 30-day trial is ending (not in the ERD diagram yet)                                                      |

**Column removed:** `Subscription.status`. The subscription status is stored only in `Organization.status` (TRIAL, ACTIVE, PAST_DUE, SUSPENDED), so there are not two statuses to keep in sync. Subscription only stores the plan and the period.

**Derived statuses, not stored:**

| Status                                              | Derived from                                                                                    |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Access status (ACTIVE, GRACE, READ_ONLY, SUSPENDED) | Organization.status, Subscription.currentPeriodEnd, and graceUntil, computed per request (BL23) |
| Invitation Pending, Expired, Accepted               | `expiresAt` and `acceptedAt`. A cancelled invitation is deleted                                 |
| Stock Out, Low, Sufficient                          | `StockLevel.quantity` and `Product.minStock`. A pair without a StockLevel row is not counted    |
| Webhook event Processed                             | `WebhookEvent.processedAt`                                                                      |
| Transfer Completed                                  | Always completed; StockTransfer has no status column                                            |

**Model decisions for this version:** the unit (`unit`) is a fixed list, not an entity. If it ever needs to be managed, it becomes a new entity. MT and INV numbering is sequential per organization, and how to generate the numbers is chosen at implementation time, on the condition that it does not make all transfers queue on a single row (record this in an ADR). The SUSPENDED status in Organization.status is not changed by cron, only by a successful payment or a platform admin. An invitation to the email of an inactive member of the same organization reactivates the same User row instead of creating a new one.
