# MediQueue

Single-hospital OPD appointment, digital token and live queue system. Patients find a doctor, book
a token for today or tomorrow, and watch the queue live so they arrive near their turn. Staff run
the queue (check-in, call next, consultation, skip/recall, walk-ins), admins manage doctors,
schedules, holidays, announcements, staff and refunds, and a waiting-room TV shows "now serving".
The whole interface works in English and Hindi. Patients get "your turn is near", delay and
reminder alerts (free, in the app and as browser notifications), admins download CSV reports,
and cancelled paid bookings can be refunded automatically.

**Stack:** React 19 · Vite 8 · TypeScript (strict) · Tailwind 4 · shadcn/ui · React Router ·
TanStack Query · React Hook Form + Zod · Supabase (Postgres + RLS, Auth, Realtime, Edge Functions) ·
Razorpay (test mode, off by default) · Cloudflare Pages.

> **Status:** feature-complete MVP, deployed as a **demo** at **https://mediqueue-5b5.pages.dev**
> (Cloudflare Pages + Supabase Free, Singapore region, fictional demo hospital, Razorpay **test-mode** payments on). The
> free tier is suitable for a demo or pilot with simulated patients only. See
> [docs/deployment.md](docs/deployment.md#current-demo-deployment) and
> [docs/operations.md](docs/operations.md#production-readiness-checklist).

## Why it is safe under load

Token numbers are allocated inside PostgreSQL in one transaction under a per-session row lock,
backed by a unique `(queue, token)` constraint. In tests, 300 simultaneous requests for 200 seats
produced exactly 200 gapless tokens. Duplicate bookings, retries, double-clicked payments and
repeated webhooks are idempotent. The browser never computes tokens, prices or roles.

## Quick start

```bash
npm ci
cp .env.example .env.local      # Supabase URL + publishable key (see docs/deployment.md)
npm run dev
```

## Commands

| Command                                 | What it does                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run dev` / `build` / `preview`     | Vite dev server, production build, preview                                                       |
| `npm run typecheck` / `lint` / `format` | tsc (strict), ESLint, Prettier                                                                   |
| `npm run test:unit`                     | React, hooks, validation and Edge Function handler tests                                         |
| `npm run test:db`                       | Real PostgreSQL 17 (embedded, no Docker): migrations, RLS, booking, queue, payments, concurrency |
| `npm run test:e2e`                      | Playwright on mobile and desktop against a mocked API (uses installed Chrome)                    |
| `npm run load:booking` / `load:day`     | Concurrency stress test and 500-visitor day simulation                                           |
| `node scripts/create-staff-user.mjs`    | Bootstrap the first administrator (needs the secret key locally)                                 |

## Documentation

| Doc                                                            | Contents                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [00 Free-tier verification](docs/00-free-tier-verification.md) | Current provider quotas and terms (checked 2026-10-16)                   |
| [01 Architecture](docs/01-architecture.md)                     | System diagram, request paths, identity without OTP, folder structure    |
| [02 Database](docs/02-database.md)                             | ERD, scheduling model, atomic allocation, status transitions             |
| [03 API](docs/03-api.md)                                       | RPCs, Edge Functions, error codes                                        |
| [04 Permissions](docs/04-permissions.md)                       | Role × capability matrix                                                 |
| [05 Sequences](docs/05-sequences.md)                           | Booking, payment and live-queue sequence diagrams                        |
| [06 Environment](docs/06-environment.md)                       | Every environment variable and where it lives                            |
| [07 Implementation plan](docs/07-implementation-plan.md)       | Phase checklist, what is done and what is pending                        |
| [08 Acceptance criteria](docs/08-acceptance-criteria.md)       | Each criterion mapped to its tests                                       |
| [09 Load test report](docs/09-load-test-report.md)             | Measured latency, invariants, storage projection                         |
| [10 Security review](docs/10-security-review.md)               | Controls, evidence, residual risks                                       |
| [Deployment](docs/deployment.md)                               | Supabase, Edge Functions, Cloudflare Pages, Razorpay test mode, rollback |
| [Operations](docs/operations.md)                               | Backups, monitoring, retention, incident runbooks, go-live checklist     |

## Project layout

```text
src/                 React app (pages/public, pages/staff, pages/admin, pages/display)
supabase/migrations  SQL schema, RLS, booking/queue/payment functions (source of truth)
supabase/functions   Edge Functions (Deno) + shared, unit-tested handlers in _shared/
tests/db             Database behaviour tests on real PostgreSQL
tests/e2e            Playwright specs + mocked Supabase API
scripts/             Embedded PG cluster, load tests, staff bootstrap
docs/                Design, API, operations and verification documents
```
