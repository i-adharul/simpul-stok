# PRD: Simpul Stok

|          |                                                                  |
| -------- | ---------------------------------------------------------------- |
| Product  | Simpul Stok (the stock module of the Simpul platform)            |
| Version  | 2.4 (22 Oct 2026)                                                |
| Author   | @i-adharul                                                       |
| Status   | Final. All decisions have been made, there are no open questions |
| Replaces | "PRD & Backlog" (19 Oct 2026, revised 20 Oct 2026)               |

This document answers **what is being built, for whom, and why**. How the product behaves is in `02_Functional_Spec.md`, and how it is built is in `05_Technical_Design.md`. The full map of documents is in `README.md` in this folder.

## 1. Summary

A multi-warehouse inventory SaaS application used by many companies at once (multi-tenant), complete with sandbox subscription billing, built as one complete product. HRIS and point of sale (POS) are not included.

Working name: **Simpul**, a multi-branch operations platform. This version only builds the stock module (**Simpul Stok**). Two other modules are only ideas for later development outside this scope and have not been designed: **Simpul Tim** (HRIS) and **Simpul POS** (point of sale and sales).

| Module      | Function                                                             | Status                    |
| ----------- | -------------------------------------------------------------------- | ------------------------- |
| Simpul Stok | Multi-warehouse inventory                                            | Built in this version     |
| Simpul Tim  | HRIS: attendance, geolocation, payroll, tax                          | Future plan, not designed |
| Simpul POS  | Point of sale and sales; could automatically reduce stock from sales | Future plan, not designed |

Example user: a coffee shop chain with one central warehouse and several branch shops. Each shop has its own stock, so Simpul Stok records it as one warehouse. This example is only an illustration, not a limit on business type.

## 2. Problem being solved

A business with several branches needs to know how much of each item is in each warehouse, move goods between warehouses, and trace why a number changed. The problems this product wants to prevent:

- Wrong stock balances because input was submitted twice or a transfer was recorded halfway.
- Negative stock because two people reduce the last stock at the same time.
- No trail of who changed what, when, and why.
- In a product used by many companies, one company's data is visible to another company.
- Access to a paid product that does not follow the subscription status.

**Honest note:** this is a product hypothesis for a portfolio project. It has not been validated through interviews with real users.

**Project position:** Simpul Stok is built as a **portfolio project to demonstrate technical ability**, not as a claim that there is a market gap. Basic stock functions already exist in many accounting software products, and this product is not a replacement for accounting software. The abilities it aims to prove:

- **Concurrency control:** two people reduce the last stock at the same time, and the stock never goes negative; guarded by an atomic conditional update and a database constraint (G1; BL15).
- **Atomic transactions:** a transfer between warehouses either completes entirely or is cancelled entirely, with no half-finished data (G1; BL13).
- **Idempotency:** a request that is sent again does not duplicate data (G1; BL14).
- **Multi-tenant isolation:** one company's data is not visible to another company (G2; BL03).
- **SaaS flow:** subscriptions, safe payment webhooks, and access freezing (G3; BL22, BL23).

For the coffee shops in the example, this means simple multi-location stock recording with numbers that can be trusted, without prices, cost of goods, or bookkeeping.

## 3. Goals and success measures

| Goal                                                                                                                           | Success measure                                                                                  | How to prove it                                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **G1 Data integrity**: stock transfers between warehouses are atomic and stock cannot go negative even under concurrent access | No negative, lost, or duplicated stock; a transfer that fails midway cancels everything          | Concurrency and atomicity tests with a real Postgres (BL13, BL14, BL15)        |
| **G2 Isolation between companies**: a user of company A cannot see or change company B's data                                  | Every endpoint answers 404 for an ID belonging to another organization                           | Automated tests across all endpoints (BL03)                                    |
| **G3 SaaS flow**: organization sign-up, subscription, payment, and account freezing                                            | The payment webhook is safe and not processed twice; access is frozen if the invoice is not paid | Webhook tests, access status tests, and a sandbox end-to-end test (BL22, BL23) |

## 4. Users and roles

One user belongs to only one organization. Every organization has exactly one Owner (its creator). The full permission matrix is in `02_Functional_Spec.md`. Role names in the UI are Indonesian (Admin Gudang = Warehouse Admin).

| Role                           | Who                                    | Main need                                                                                                            |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Owner                          | The owner of the customer company      | Manage warehouses, products, members, and the subscription; see all stock in the organization                        |
| Warehouse Admin (Admin Gudang) | The person responsible for a warehouse | Receive, adjust, and transfer stock in the assigned warehouses                                                       |
| Viewer                         | An auditor or manager                  | Read stock and history in the assigned warehouses                                                                    |
| Platform admin                 | The product owner                      | See organizations, subscriptions, and invoices; change an organization's status with a reason. Cannot see stock data |

## 5. Scope and priorities

Everything in this document is one product. Priority only determines the order of work and what is cut first if necessary, not a division into phases by time.

| Priority          | Contents                                                                                                                                  | Reason                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P0 Core inventory | Login, roles, warehouses, products, receipts, adjustments, transfers, history, concurrency and atomicity tests, deploy                    | The main proof of data integrity; can already be demoed with one organization |
| P1 SaaS           | Organization sign-up, invitations, tenant isolation, plans and limits, Xendit sandbox billing, webhooks, account freezing, platform admin | Proof of data isolation and the subscription flow                             |
| P2 Extras         | Import and export, low-stock alerts, notifications, audit log, Row-Level Security, PDF reports                                            | Adds depth; cut first                                                         |

All tables use `organizationId` from the start, so P0 runs with one organization and P1 does not need a big migration.

Cutting order if necessary (earliest first): Row-Level Security, PDF reports, notifications, the Terms & Data Policy page, export, import, audit log. Parts that are cut are hidden from the UI (for example the Import stock button or the bell icon), not left broken.

**Deliberately not built**

- HRIS, attendance, geolocation, payroll, and tax (Simpul Tim)
- Point of sale, sales, and POS integration (Simpul POS)
- Recording of ingredient usage, recipes per menu item, and comparison with sales data
- Rate limiting, a dashboard cache, and Redis; global client state stores (Redux or Zustand). The transfer draft uses local React state
- A mobile app or React Native
- Golang, microservices, GraphQL
- Subdomains per tenant
- Barcode scanner, marketplace integration, multi-currency
- Real payments (sandbox only)
- Purchase and sales orders, suppliers, prices or cost of goods, batches and expiry, stock in transit

## 6. Functional requirements

A product-level summary. The detailed rules for each requirement are in `02_Functional_Spec.md` (Reference column), and the division of work is in the GitHub Issues and project board of this repo.

| ID    | As a                      | I want to                                                                                  | Priority | Reference              |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------ | -------- | ---------------------- |
| FR-01 | User                      | Log in securely and manage my password                                                     | P0       | BL01; S01, S17         |
| FR-02 | System owner              | Permissions enforced on the server by role and warehouse                                   | P0       | BL02                   |
| FR-03 | Owner                     | Manage warehouses (create, edit, archive)                                                  | P0       | BL08; S05, S06         |
| FR-04 | Owner                     | Manage products (create, edit, archive)                                                    | P0       | BL09; S07, S08         |
| FR-05 | Owner                     | Assign users to warehouses                                                                 | P0       | BL10; P06              |
| FR-06 | Warehouse Admin           | Record goods received into a warehouse                                                     | P0       | BL11; P04              |
| FR-07 | Warehouse Admin           | Adjust stock with a clear reason                                                           | P0       | BL12; P05              |
| FR-08 | Warehouse Admin           | Move several items between warehouses at once                                              | P0       | BL13; S11, S12         |
| FR-09 | Tenant user               | Be sure stock never goes negative and a repeated request does not duplicate data           | P0       | BL14, BL15             |
| FR-10 | Tenant user               | See stock per warehouse and product with its status                                        | P0       | S09, S04               |
| FR-11 | Tenant user               | Search and trace the stock movement history                                                | P0       | BL16; S10              |
| FR-12 | Company owner             | Register a new organization and be able to try it immediately                              | P1       | BL04; S02              |
| FR-13 | Owner                     | Invite members, change roles, deactivate, and create password reset links                  | P1       | BL05 to BL07; S03, S14 |
| FR-14 | Owner                     | Be limited and informed about plan limits (warehouses, products, members)                  | P1       | BL20                   |
| FR-15 | Owner                     | Choose a plan, receive an invoice, and pay                                                 | P1       | BL21; S16, S22         |
| FR-16 | System owner              | Payments processed safely through a webhook and not processed twice                        | P1       | BL22                   |
| FR-17 | System owner              | Organization access follows the subscription status (grace, read-only, suspended)          | P1       | BL23, BL24; S21        |
| FR-18 | Platform admin            | See organizations and change their status with a reason                                    | P1       | BL25; S19, S20         |
| FR-19 | System owner              | (Removed 22 Oct 2026) Rate limiting for login and sign-up is deferred to later development | -        | -                      |
| FR-20 | Owner and Warehouse Admin | Be notified about low stock                                                                | P2       | BL17, BL30             |
| FR-21 | Owner and Warehouse Admin | Import stock from CSV or XLSX, all or nothing                                              | P2       | BL18; S13              |
| FR-22 | Tenant user               | Export stock and history (CSV, XLSX, PDF for stock)                                        | P2       | BL19                   |
| FR-23 | Owner                     | See the audit trail of important actions                                                   | P2       | BL26; S18              |
| FR-24 | Tenant user               | A fast dashboard (queries go straight to the database, no cache)                           | P2       | S04                    |

## 7. Non-functional requirements

- **Data integrity:** stock must not be negative, guarded in the application and the database; history is never changed or deleted, corrections are made as new rows.
- **Tenant isolation:** only the `organizationId` from the server session is trusted; another organization's data always results in 404.
- **Security:** see `05_Technical_Design.md`.
- **Performance:** history stays fast with 10,000+ rows (BL16).
- **Subscription access:** computed per request and not dependent on cron (BL23).
- **Transparency:** payments are sandbox only, stated clearly in the README and the UI.

| Item                         | Why it matters                         | Decision                                                                  |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Time zone and formats        | History dates could display wrongly    | Store UTC, display WIB (Asia/Jakarta), Indonesian number and date formats |
| UI language                  | Consistency                            | The UI is in Indonesian; code, commits, and the README are in English     |
| Responsive and accessibility | Warehouses often use phones or tablets | Responsive layout, keyboard focus, and correct form labels                |

## 8. Other product decisions and constraints

Gaps that have been closed. The decision column is final. More detailed cross-feature product rules are in the section "Design decisions in effect" of `02_Functional_Spec.md`.

| Item                                          | Why it matters                                                                                         | Decision                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email for invitations and password reset      | Without an email service, invitations are not sent automatically                                       | Invitations and resets use copied links (P08). There is no email in this version                                                                                                                                                                                                                                                               |
| Forgotten password                            | Users could be locked out                                                                              | The Owner creates a reset link for a member; self-service reset by email is deferred (see BL07; the screen is built without Stitch)                                                                                                                                                                                                            |
| Plan limit numbers                            | BL20 needs numbers                                                                                     | Decided (see Design decisions in effect); prices are still examples                                                                                                                                                                                                                                                                            |
| One user, one organization                    | Simplifies the model                                                                                   | Moving or merging organizations is deferred                                                                                                                                                                                                                                                                                                    |
| Legal page                                    | Looks like a real product                                                                              | One static `/legal` page with brief terms and a data policy, linked from the footer (P2)                                                                                                                                                                                                                                                       |
| Payment sandbox                               | Do not mislead readers                                                                                 | State clearly in the README and the UI that payments are sandbox only                                                                                                                                                                                                                                                                          |
| Branch and warehouse                          | The term "branch" could be mistaken for its own entity                                                 | In Simpul Stok, one branch or shop = one warehouse. There is no level above the warehouse. A branch with several stock locations is created as several warehouses. A Branch entity is only considered when Simpul Tim or Simpul POS is built                                                                                                   |
| Daily usage and input correctness             | Stock used daily has no recording of its own, and the system cannot verify that staff input is correct | Usage is recorded through the "Stock opname" (stock count) adjustment, so normal usage and discrepancies are not distinguished. The system guarantees the integrity of the record (who, when, why, history that cannot be changed), not the correctness of the input. An independent comparison such as sales data and recipes is out of scope |
| Trial                                         | A trial with no time limit equals a free plan                                                          | 30 days from sign-up with the Starter limits. After it ends, the same grace handling as a subscription applies (GRACE 3 days, READ_ONLY 7 days, SUSPENDED); data is not deleted; paying at any time activates the account                                                                                                                      |
| Downgrade                                     | Usage could rise between choosing a plan and paying                                                    | Checked only when choosing. While a downgrade invoice is Pending, the effective limit follows the target plan, and the Owner can cancel it. There is no re-check on payment because a payment that has been received must not end in a rejection                                                                                               |
| Billing date                                  | Not every month has the 29th to the 31st                                                               | The billing day is stored (the anchor date); a month without that date uses its last day without shifting the billing day. A late payment after the grace period starts a new period with billing day = payment date                                                                                                                           |
| Redis, rate limiting, and global client state | Adds technology before a problem requires it                                                           | Not used. The transfer draft uses local React state; idempotency uses a unique key in the database; the dashboard reads the database directly; rate limiting is deferred. To be added if real traffic or needs appear. Accepted consequence: no limit on login and sign-up attempts                                                            |
| Inventory features deliberately absent        | Prevents scope creep                                                                                   | No purchase or sales orders, suppliers, prices, batches, serial numbers, or stock in transit                                                                                                                                                                                                                                                   |

**Final product decisions**

- [x] Two subscription plans and their limit numbers (decided: Starter and Business)
- [x] Invitations by manual link or using Resend (decided: manual link, no email)
- [x] All P2 items are still built (decided: all P2 items have been designed; if they must be cut, the order is in the Scope and priorities section)
- [x] Operational numbers: 30-day trial, GRACE 3 days, READ_ONLY 7 days, regular invoices created 7 days before the end of the period, initial and plan-change invoices valid for 7 days, regular invoices valid until due date + 10 days, invitations valid for 7 days, reset links valid for 1 day, sessions 8 hours, imports at most 5,000 rows (decided)
- [x] Password reset by the Owner is still built, with the screen built without Stitch (decided)
- [x] Password rules: 8 to 72 characters, with letters and digits, not the email, not a common password (decided)

## 9. Assumptions and dependencies

**Assumptions**

- The builder has a basic grounding in JavaScript, React, Postgres, and an ORM.
- An AI assistant (Claude) is used as a pair programmer, with rules in `CLAUDE.md`.
- Every part must be explainable by its builder. A part that cannot be explained is considered unfinished.

**External dependencies:** Xendit (sandbox invoices and webhooks), Neon (Postgres), and Vercel (hosting and cron). External facts such as free-tier limits or payload formats may change; check the official documentation before building the parts that depend on them.

**Risks:** scope creep and bugs that hold up the work. Both are controlled through the P0 to P2 priorities and the cutting order in section 5.

## 10. Out of scope and future plans

The list of "deliberately not built" items is in section 5. Things deferred to later development: HRIS (Simpul Tim), point of sale and sales (Simpul POS), recording of ingredient usage, automatic email for invitations and password reset, self-service password reset, moving or merging organizations, rate limiting (possibly with Redis), and OpenAPI documentation.

## 11. Open questions

None. All proposals from the 20 Oct 2026 revision have been decided.

## 12. Glossary

| Term                        | Meaning                                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Warehouse (Gudang)          | A stock storage point owned by an organization, either a central warehouse or a stock room in a shop or branch. One warehouse has its own stock balance. Simpul Stok has no Branch concept separate from the warehouse |
| Tenant or organization      | One customer company together with all its data                                                                                                                                                                        |
| Transfer (Mutasi)           | Moving stock between warehouses in one organization; completed immediately, with no "in transit" status                                                                                                                |
| Adjustment (Penyesuaian)    | A stock correction with a required reason (Stok opname = stock count, Rusak = damaged, Hilang = lost, Koreksi = correction)                                                                                            |
| Idempotency                 | A request repeated with the same key produces the same result without a double effect                                                                                                                                  |
| Concurrency                 | The condition when several requests change the same data at the same time, for example two people reducing the last stock; guarded so stock does not go negative                                                       |
| Effective limit             | The limit on the number of warehouses, products, and members that the system actually applies at that moment; equal to the plan limit, except while a Pending downgrade invoice exists (it follows the target plan)    |
| Billing day                 | The day of the month (1 to 31) on which a subscription period starts and ends; shorter months use their last day                                                                                                       |
| GRACE, READ_ONLY, SUSPENDED | Access stages after the end of the subscription period: still writable, read-only, then frozen                                                                                                                         |
| ADR                         | A short architecture decision record in `docs/decisions/`                                                                                                                                                              |
| P0, P1, P2                  | Work priorities: core inventory, SaaS, extras                                                                                                                                                                          |

## 13. Related documents

See `README.md` in this folder.
