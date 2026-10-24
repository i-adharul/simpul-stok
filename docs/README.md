# Simpul Stok documentation

Product and technical documents for Simpul Stok, the stock module of the Simpul platform. The architecture decision records are in [`decisions/`](decisions/).

## Language

The product UI is in Indonesian, and these documents are written in English. Text quoted from the UI is kept in Indonesian and followed by an English gloss where it helps.

## Documents

| Document                                                    | Answers                                                                                    | Read it when                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| [01_PRD.md](01_PRD.md)                                      | What is built, for whom, and why; scope and priorities                                     | You want the big picture            |
| [02_Functional_Spec.md](02_Functional_Spec.md)              | How the product behaves: roles, business logic (BL01 to BL30), screens, popups             | You build a feature or write a test |
| [03_Data_Model.md](03_Data_Model.md)                        | The 17 entities, key columns, and tenant isolation rules                                   | You write the schema or a query     |
| [ERD_Relations.md](ERD_Relations.md) and [ERD.png](ERD.png) | Relations, constraints, and the diagram                                                    | You need the relations in detail    |
| [04_API_Spec.md](04_API_Spec.md)                            | The 51 REST endpoints, who may call them, and the conventions                              | You build or test an endpoint       |
| [05_Technical_Design.md](05_Technical_Design.md)            | Tech stack, architecture, and security decisions, with the alternatives that were rejected | You review the system               |
| [06_Test_Plan.md](06_Test_Plan.md)                          | Which tests prove the main claims and how to write them                                    | You write or run tests              |

## Reading order

1. The PRD, for the problem and the claims the project wants to prove.
2. The Technical Design, for how those claims are met.
3. The Data Model and the Test Plan, for the tenant isolation and concurrency evidence.
4. The Functional Spec and the API Spec, for the details.

## Conventions

- **IDs:** S = screen, P = popup, BL = business logic, E = entity, FR = functional requirement, G = goal.
- **Priorities:** P0 core inventory, P1 SaaS, P2 extras.
- **If two documents disagree:** the Design decisions in effect in the Functional Spec win over the BL table, and the Data Model table wins over the diagram.
