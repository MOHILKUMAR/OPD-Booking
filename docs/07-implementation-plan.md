# 7. Implementation plan and checklist

Legend: ✅ done and tested · 🟡 done, needs a hosted project to verify · ⬜ not started (planned)

## Phase A: foundation

- ✅ Vite 8 + React 19 + TypeScript 6 (strict) + Tailwind 4 + shadcn/ui, ESLint 10, Prettier
- ✅ Routes with lazy staff/admin/display chunks (patient first load ≈ 250 KB gzipped JS)
- ✅ Migrations: schema, RLS and privileges, booking and queue logic, payments, grants and Realtime,
  staff provisioning ([02-database.md](02-database.md))
- ✅ Roles, RLS and the permission matrix ([04-permissions.md](04-permissions.md))
- ✅ Real-PostgreSQL test harness (embedded PG 17 + Supabase role stubs)
- 🟡 `supabase db push` to a hosted project (not run: no project linked yet)

## Phase B: hospital, directory, profiles, schedules

- ✅ Home, directory (server-side filters and pagination), doctor profile, department and specialty browsing
- ✅ Shifts, weekly schedules, overlap prevention, holiday/closure/hours/capacity exceptions

## Phase C: booking, tokens, tracking

- ✅ Atomic `book_token`, duplicate policy, capacity, idempotent retries, rate limits
- ✅ Confirmation page, tracking by reference + secret key (fragment), masked identity, cancellation
  rules, "My bookings", key rotation
- ✅ Optional patient account (anonymous → email/password upgrade). Manual test only

## Phase D: staff dashboards

- ✅ Queue console (start/pause/resume/close, delay note, call next, per-role actions, optimistic
  concurrency), walk-in tokens with print slip, appointment search
- ✅ Waiting-room TV display (PII-free)

## Phase E: live queue

- ✅ Realtime subscription on `queue_states` with 15 s polling fallback, hidden-tab handling, 60 s
  safety poll
- ✅ Audit logging for every queue, session, booking, payment and config change
- 🟡 Realtime against Supabase (connection and message quotas): verify after deployment

## Phase F: payments (test mode, off by default)

- ✅ Edge Functions: create order, verify (signature + gateway fetch + capture), webhook (raw-body
  HMAC, dedupe), admin refund (idempotency header), staff provisioning, housekeeping
- ✅ Holds with expiry, late-payment handling, refund requests (never automatic promises)
- ✅ End-to-end with Razorpay test keys on the live demo: checkout-signature path and webhook path
  both confirmed real test payments (2026-10-18)

## Phase G: quality

- ✅ 96 DB tests, 71 unit/component tests, 12 Playwright tests (mobile + desktop)
- ✅ Load and concurrency tests with measured results ([09-load-test-report.md](09-load-test-report.md));
  2 bugs found and fixed
- ✅ Security self-review ([10-security-review.md](10-security-review.md)); `npm audit` clean
- 🟡 HTTP load test and Realtime limits against the hosted staging project

## Phase H: operations

- ✅ Deployment guide, rollback, Razorpay test configuration ([deployment.md](deployment.md))
- ✅ Backups, monitoring, retention, incident runbooks, production checklist ([operations.md](operations.md))
- ✅ Turnstile widget (Supabase CAPTCHA), optional via `VITE_TURNSTILE_SITE_KEY`: booking page
  (first booking on a device, also for online payment), staff sign-in and patient account sign-in
- ✅ Two-factor authentication (TOTP) for staff: enrol/remove dialog (**2FA** in the staff header),
  code step after the password, staff routes require `aal2` once a user has enrolled
- 🟡 Turnstile and TOTP against a hosted project (needs a Cloudflare widget and Supabase settings;
  see [deployment.md](deployment.md) §2)
- ✅ Hindi interface: every patient, staff, admin and TV screen; language switch in the header,
  `?lang=hi` links (e.g. the TV display); database errors, session reasons and notifications are
  translated by code; hospital-entered data (doctor names, notes, announcements) is shown as typed
- ✅ Report exports: Admin → Reports & exports, CSV for appointments (patient details only on
  explicit opt-in), daily OPD summary, payments, refunds and the audit log; every export audited
- ✅ Automatic refunds: hospital setting with an optional amount limit; pg_cron wakes the
  `automation` Edge Function through pg_net only when there is work; failures stay for an admin
- ✅ Patient alerts: "your turn is near", delay notices and visit reminders as free in-app
  notifications, shown as browser notifications while the tracking page is open
- ✅ WhatsApp alerts (paid, off by default): per-booking patient opt-in on the tracking page,
  WhatsApp Cloud API sender with approved English/Hindi templates, STOP and failed-delivery
  webhook; needs the Meta setup in deployment.md §9 and the Settings switch
- 🟡 SMS copies of alerts: queue, dispatcher and `MessageSender` adapter built; off by default
  (`hospitals.sms_alerts_enabled`, `MESSAGE_PROVIDER`); no SMS provider wired
- ⬜ Alerts while the browser is closed (Web Push, free) — not built

## SMS/WhatsApp provider interface

In-app notifications are written by the database in the same transaction as the event that
caused them. When a hospital turns on `sms_alerts_enabled`, `TURN_NEAR` and `VISIT_REMINDER`
alerts also queue an `SMS` copy (`status = 'PENDING'`). The `automation` Edge Function claims
queued copies and sends each through the sender named by `MESSAGE_PROVIDER`
(`supabase/functions/_shared/messaging.ts`):

```ts
interface MessageSender {
  readonly name: string
  send(message: {
    channel: 'SMS' | 'WHATSAPP'
    phone: string // 10-digit Indian mobile
    kind: string // TURN_NEAR, VISIT_REMINDER (maps to a DLT template)
    text: string
    data: Record<string, unknown>
  }): Promise<{ ok: true } | { ok: false; error: string }>
}
```

The WhatsApp Cloud API sender ships (`whatsappCloudSender`, active with the `WHATSAPP_*`
secrets). No SMS provider ships. Each costs money per message (about ₹0.15–0.30 per SMS) and needs DLT
registration and approved templates in India, so add one only after the provider and its cost
are approved; until then queued copies are marked FAILED and nothing is sent.
