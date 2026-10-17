# 9. Load and concurrency test report (2026-10-16)

## What was measured, and what was not

| Measured here                                                                                                                                   | Not yet measured (needs a Supabase project)                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Correctness of token allocation, duplicate prevention, queue actions, payment idempotency and webhook dedupe under real concurrent transactions | HTTP latency India → Supabase region and back                               |
| Database time per operation, including PostgREST-style role switching per request                                                               | Edge Function cold starts, Razorpay API latency                             |
| Lock contention when many requests hit the same OPD session                                                                                     | Realtime connection count and message rate against the 200 / 2M free limits |
| Storage growth per booking                                                                                                                      | Anonymous sign-in limits (30/hour/IP) under real traffic                    |

**Environment:** PostgreSQL 17.10 (embedded-postgres), all six migrations, **fsync and synchronous commit
on**, on a laptop: AMD Ryzen 5 5600H (12 threads), 17 GB RAM, NVMe, Windows 11. Each call
connects as `authenticator`, does `SET LOCAL ROLE`, sets JWT claims and the client IP header,
runs the function and commits, exactly as PostgREST does for a browser request.

Supabase Free runs on a shared CPU with 500 MB RAM. Expect those numbers to be **several times
slower** than the ones below, plus network round trips (typically 30–150 ms from India to a Mumbai
or Singapore region). Do not read these figures as a capacity claim for the free tier. Re-run
the HTTP checks in "Next measurements" against the real project.

Scripts: `npm run load:booking` ([booking-burst.mjs](../scripts/load/booking-burst.mjs)) and
`npm run load:day` ([day-simulation.mjs](../scripts/load/day-simulation.mjs)). Each prints the
tables below and writes `load-results-*.json`.

## 1. Concurrency stress (`load:booking`)

40 database connections, which is about what a Supabase Free pooler exposes.

| Scenario                                                             | Calls |      Succeeded |   Rejected as designed |      p50 |      p95 |      p99 |
| -------------------------------------------------------------------- | ----: | -------------: | ---------------------: | -------: | -------: | -------: |
| 300 simultaneous bookings, one session, 200 online seats             |   300 |            200 |             100 `FULL` | 3,942 ms | 4,561 ms | 4,584 ms |
| 40 simultaneous bookings, same phone                                 |    40 |              1 |         39 `DUPLICATE` |    58 ms |    80 ms |    81 ms |
| 60 check-ins from the desk, 10 at a time                             |    60 |             60 |                      0 |    54 ms |    72 ms |    82 ms |
| "Call next" pressed by 3 desks at once, 30 rounds                    |    90 |             30 |    60 `ALREADY_CALLED` |   8.5 ms |  11.7 ms |  13.7 ms |
| Start / complete consultation                                        |    60 |             60 |                      0 |   5.7 ms |     7 ms |     9 ms |
| Paid checkout retried 3× concurrently (50 patients)                  |   150 | 150 → 50 holds |                      0 |   648 ms | 1,123 ms | 1,159 ms |
| Payment verify + 3 duplicate webhooks + `order.paid`, all concurrent |   250 |   50 confirmed | 200 idempotent replays |   459 ms |   697 ms |   714 ms |

| Invariant                                                                           | Result                   |
| ----------------------------------------------------------------------------------- | ------------------------ |
| Exactly 200 tokens for 200 online seats                                             | PASS                     |
| Token numbers unique and gapless 1–200                                              | PASS                     |
| One token for 40 simultaneous same-phone bookings                                   | PASS                     |
| Every "call next" round called exactly one patient                                  | PASS (0 bad rounds / 30) |
| Queue state consistent after 30 rounds (`current=30, next=31, waiting=30, seen=30`) | PASS                     |
| 50 checkouts × 3 concurrent retries → 50 holds                                      | PASS                     |
| 50 payments confirmed exactly once despite 4 concurrent confirmations each          | PASS                     |
| Duplicate webhook deliveries stored once (100 rows for 100 event ids)               | PASS                     |

**How to read the 4-second p50:** all 300 requests target the same doctor and shift, so they wait
on that session's row lock. That lock is what guarantees unique tokens. Each booking holds it for
about 12 ms under contention (7.5 ms end to end uncontended), giving about 70 bookings per second
per session. Different sessions do not block each other. At 500 visitors per day, the realistic
peak is a few bookings per second across all doctors (see section 2).

## 2. A day at the OPD (`load:day`)

There are 500 visitors and 6 doctors with 50 online tokens each, and 25 visitors are active at
once. The test compresses a full day into **4.4 seconds**, which is roughly 10,000 times real
time. Reception and doctors work their queues the whole time. Afterwards, 50 tracking pages and
10 TV screens poll every second for 20 s, simulating Realtime being unavailable.

| Operation                                      | Calls |     p50 |      p95 |                                           p99 |
| ---------------------------------------------- | ----: | ------: | -------: | --------------------------------------------: |
| Home: `search_doctors`                         |   500 | 27.5 ms |    54 ms | 1,428 ms (cold plan cache on the first calls) |
| Directory search with filters                  |   500 |   30 ms |    39 ms |                                         45 ms |
| Profile: `get_sessions`                        |   500 |   20 ms |    27 ms |                                         33 ms |
| `book_token` (353 booked, 2 `FULL`)            |   355 |   30 ms |   247 ms |                                        667 ms |
| Track: `get_booking`                           | 1,156 |   21 ms |    31 ms |                                         50 ms |
| `cancel_booking` (31 cancelled, 6 past cutoff) |    37 |   25 ms |   267 ms |                                        303 ms |
| Staff: mark arrived / start / complete         |   106 |   24 ms | 32–46 ms |                                      41–47 ms |
| Doctor: call next (25 × queue empty)           |    60 |   29 ms |   700 ms |                                      1,785 ms |
| Burst: 50 tracking pages polling at 1 s        | 1,000 |   33 ms |    58 ms |                                         84 ms |
| Burst: 10 TV boards polling at 1 s             |   200 |   33 ms |    69 ms |                                         95 ms |

Invariants: no duplicate tokens in any queue, no counter drift, no session over capacity, and every
booking audited. **All PASS.** No unexpected errors occurred in any operation.

## 3. Storage: the free-tier limit that matters

Measured at volume (5,000 visitors, 3,550 bookings) after `VACUUM`:

| Table             |      Bytes per row, including indexes | Kept long-term?         |
| ----------------- | ------------------------------------: | ----------------------- |
| `appointments`    |                                ~950 B | yes                     |
| `audit_logs`      | ~690 B (≈ 5 rows per completed visit) | yes, purge after export |
| `notifications`   |       ~410 B (≈ 2–3 rows per booking) | purged after 30 days    |
| `app.rate_limits` |                                ~170 B | purged daily            |

A completed visit is 1 appointment plus about 5 audit rows, so roughly **4–4.5 KB is kept per
visit**. At **~300 visits per day** that is **~1.3 MB per day, or ~480–520 MB per year**. The
Supabase Free database limit is **500 MB**.

**Free-tier verdict:** about 10–12 months of history before the database is full, sooner at higher
volume. Mitigations, all implemented and described in [operations.md](operations.md):

1. Housekeeping deletes notifications older than 30 days and old rate-limit rows. Run it daily
   with pg_cron or the `housekeeping` function.
2. Export audit logs monthly, then run `app.purge_audit_logs(before)`. Rows younger than 90 days
   cannot be purged, and the purge itself is audited.
3. For a live hospital, the paid tier (larger database and daily backups) is the correct fix.

## 4. Bugs found by load testing (fixed)

| Finding                                                                                                                                                    | Fix                                                                                                               | Regression test                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Concurrent retries of the same paid checkout: the 2nd and 3rd requests returned `MQ_INVALID_REQUEST` (99 of 150 calls failed) instead of the existing hold | `svc_hold_paid_booking` re-reads the committed hold after waiting on the session lock (`app.replay_payment_hold`) | `payments.test.ts` "three simultaneous create-order calls…" |
| Per-IP booking limit was hard-coded at 40/hour; patients on hospital Wi-Fi share one public IP                                                             | Limits moved to `app.config` (default 60/hour, adjustable without a deploy)                                       | `booking.test.ts` "configurable limits"                     |

## 5. Realtime and Edge Function budget (estimate, not measured)

- **Realtime messages:** only `queue_states` is published, and each update reaches subscribers of
  that one session (`id=eq.`) plus the TV boards (hospital filter). A 50-token session sees about
  50 × 4 = 200 changes. If 20 patients keep tracking open, that is about 4,000 messages per
  session-day; 10 sessions/day ≈ 1.2M messages/month, **inside the 2M free limit with little room
  to spare**. The directory and profile pages deliberately poll every 30–60 s instead of
  subscribing. Pages close channels when hidden and fall back to 15 s polling on errors. Scaling
  step: move to Realtime Broadcast from a trigger that fires only when `current_token_no` changes.
- **Realtime connections:** one channel per open tracking page or TV. 200 concurrent is the
  free limit; beyond it clients fall back to polling, which section 2 shows the database absorbs
  easily.
- **Edge Functions:** used only for payments and staff provisioning, so about 0 calls per free
  booking, far below 500k/month.

## 6. Next measurements (needs the hosted project)

1. Deploy to a **separate staging** Supabase project and seed it with `seed.sql`.
2. Raise `rate.book_per_ip_hour` there for the test (`update app.config ...`). One load machine is
   one IP.
3. Measure HTTP p50/p95 for `search_doctors`, `book_token` and `get_booking` from a phone network in
   India. Note any 429 or 5xx responses and check Supabase's usage page for egress, Realtime and
   function counts.
4. Open 200+ tracking tabs and confirm the 201st falls back to polling (indicator shows "Auto-refresh
   every 15 s") without errors.
5. Record the results in this file. Do not claim a concurrency level that has not been measured
   there.
