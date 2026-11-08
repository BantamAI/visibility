@AGENTS.md

## Visibility Service

This repo is the visibility service: an Elmo fork plus our local layer (ADR-28, ADR-31 in `docs/plan/architecture.md`). Where these rules conflict with `AGENTS.md`, these win.

- It has its own Postgres and never connects to the platform database. Talk to the platform only through its versioned API and HMAC-signed webhooks.
- Subjects are prospects or clients. A client subject is linked to the platform by `platform_location_id`, the platform location `account_id`.
- There are no client logins: agency staff only, plus revocable public report links.
- Every table has `subject_id` (plus `location_id` once linked) and RLS enabled. All database access, including jobs, goes through `withSubject()`. Cross-subject views use the audited agency role only. No bypass role in app code. Every table needs pgTAP isolation tests (E53-S13). `packages/service/scripts/check-tenant-catalog.mjs` enforces the catalog side in CI.
- A subject is a `brands` row (`subject_id` = brand id). A migration that creates a table ends with `SELECT tenancy.scope_to_subject('<table>')`, or `tenancy.restrict_to_agency('<table>', '<reason>')` for data that belongs to no subject. Use `withSubject()` / `withAgency()` from `@workspace/service/local/tenancy`; pgTAP files live in `packages/service/test/pgtap/`.
- Upstream code in `apps/web` and `apps/worker` still connects as the table owner, which bypasses RLS. Don't copy that pattern into our code.
- It never contacts consumers. Only the platform sends SMS, email or calls.
- MIT notices from Elmo stay in copied files and in `LICENSE.md`. Elmo's name and logo are removed from everything user-visible; internal identifiers (`@elmohq/*`, `ELMO_*`) stay so upstream syncs stay cheap.
- Our code lives in `packages/service`: the local layer in `src/local/`, vendor adapters in `src/providers/`, and the service API in `src/api/v1/` with its OpenAPI spec (`src/api/v1/openapi.yaml`). Don't put our code in upstream packages when it can live there.
- Before syncing upstream, run `scripts/upstream-diff`.
- No `ee/` or `enterprise/` code, and no AGPL, SSPL or BSL dependencies; `pnpm license-check` fails on them.
