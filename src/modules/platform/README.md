# Platform module

Cross-cutting concerns that any future Simpul module would share:

- authentication and sessions
- organizations, members and invitations
- plans, subscriptions and billing (Xendit sandbox)
- platform admin

Dependency rule: this module must not import from `modules/stock`.
See `docs/decisions/0002-module-boundaries.md`.
