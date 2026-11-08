@AGENTS.md

## Visibility Service

This repo is the visibility service: an Elmo fork plus our local layer (ADR-28 and ADR-31 in the platform's architecture doc; this service's own ADRs, from ADR-32, in `docs/plan/architecture.md`). Where these rules conflict with `AGENTS.md`, these win.

- It has its own Postgres and never connects to the platform database. Talk to the platform only through its versioned API and HMAC-signed webhooks.
- Subjects are prospects or clients. A client subject is linked to the platform by `platform_location_id`, the platform location `account_id`.
- There are no client logins: agency staff only, plus revocable public report links.
- Every table has `subject_id` (plus `location_id` once linked) and RLS enabled. All database access, including jobs, goes through `withSubject()`. Cross-subject views use the audited agency role only. No bypass role in app code. Every table needs pgTAP isolation tests (E53-S13). `packages/service/scripts/check-tenant-catalog.mjs` enforces the catalog side in CI.
- A subject is a `brands` row (`subject_id` = brand id). A migration that creates a table ends with `SELECT tenancy.scope_to_subject('<table>')`, or `tenancy.restrict_to_agency('<table>', '<reason>')` for data that belongs to no subject. Use `withSubject()` / `withAgency()` from `@workspace/service/local/tenancy`; pgTAP files live in `packages/service/test/pgtap/`.
- The app connects as `visibility_app` (`DATABASE_URL`), a NOINHERIT login role that reaches no subject rows on its own; only migrations use the owner (`MIGRATION_DATABASE_URL`). Web and worker refuse to start as a role that gets past RLS.
- The shared `db` runs every query in the caller's tenant scope (`packages/lib/src/db/tenant-pool.ts`), so scopes open at entry points, not per query: signed-in server functions, `/api/v1` and MCP requests run in `withAgency()` (`apps/web/src/middleware/auth.ts`, `apps/web/src/lib/api/handler.ts`); each worker queue runs in `withSubject()` or `withAgency()` (`apps/worker/src/handlers.ts`). A new route, queue or background loop opens its own scope.
- A table the login role must reach before a request is scoped (auth lookups) uses `tenancy.grant_to_app`; an agency-only table that subject-scoped work needs uses `tenancy.share_with_subjects`.
- It never contacts consumers. Only the platform sends SMS, email or calls.
- MIT notices from Elmo stay in copied files and in `LICENSE.md`. Elmo's name and logo are removed from everything user-visible; internal identifiers (`@elmohq/*`, `ELMO_*`) stay so upstream syncs stay cheap.
- Our code lives in `packages/service`: the local layer in `src/local/`, vendor adapters in `src/providers/`, and the service API in `src/api/v1/` with its OpenAPI spec (`src/api/v1/openapi.yaml`). Don't put our code in upstream packages when it can live there.
- Before syncing upstream, run `scripts/upstream-diff`.
- No `ee/` or `enterprise/` code, and no AGPL, SSPL or BSL dependencies; `pnpm license-check` fails on them.
