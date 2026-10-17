# Operations: backups, monitoring, retention, incidents

## Backups (the free tier has none)

Supabase Free has **no automated backups and no point-in-time recovery**. Until the hospital moves to
a paid plan, take your own:

```bash
# nightly, from a trusted machine or CI with the DB password stored as a secret
npx supabase@latest db dump --linked -f mediqueue-schema-$(date +%F).sql
npx supabase@latest db dump --linked --data-only -f mediqueue-data-$(date +%F).sql
```

- Encrypt the files at rest and keep at least 14 daily plus 6 monthly copies. They contain patient
  names and phone numbers.
- **Test a restore monthly.** Create a scratch project, `psql` the schema dump then the data dump,
  point a local build at it, and open a few bookings.
- Before every migration push, take an extra dump (see [deployment.md](deployment.md#8-rollback)).

## Monitoring

| What                                                                                | Where                                                                        | Alert when                                                                           |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Database size, egress, MAU, Realtime connections and messages, function invocations | Supabase → **Usage**                                                         | over 70% of a free quota (DB size will be first: about 1.3 MB/day at 300 visits/day) |
| API / Auth / Realtime / function errors                                             | Supabase → **Logs Explorer**                                                 | 5xx bursts, `MQ_RATE_LIMITED` spikes (shared IPs), webhook 5xx                       |
| Security and performance advice                                                     | Supabase → **Advisors**                                                      | any critical item                                                                    |
| Payment webhooks                                                                    | Razorpay → Webhooks → delivery logs                                          | failures (Razorpay disables a webhook after 24 h of failures)                        |
| Frontend availability                                                               | Cloudflare → Pages analytics; optionally a free external uptime check on `/` | non-200 responses                                                                    |
| Project pausing                                                                     | Supabase pauses Free projects after 7 days of inactivity                     | always: a paused project means booking is down                                       |

Useful SQL (SQL editor):

```sql
-- refunds waiting for a decision
select count(*) from refunds where status in ('REQUESTED', 'FAILED');
-- payments captured but booking not confirmed (should be zero or have a refund request)
select p.id from payments p join appointments a on a.id = p.appointment_id
where p.status = 'CAPTURED' and a.status = 'CANCELLED'
  and not exists (select 1 from refunds r where r.payment_id = p.id);
-- counters vs. truth (should return no rows)
select id from queue_states q where q.issued_count <> app.active_token_count(q.id);
-- largest tables
select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r' order by pg_total_relation_size(oid) desc;
```

## Data retention

| Data                               | Kept                                        | Mechanism                                                 |
| ---------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| Payment holds that were never paid | cancelled 30 min after expiry               | `app.expire_payment_holds()` (scheduled)                  |
| Rate-limit counters                | 1 day                                       | `app.cleanup_rate_limits()` (scheduled)                   |
| In-app notifications               | 30 days                                     | `app.purge_old_notifications(30)` (scheduled)             |
| Audit log                          | until exported and purged (minimum 90 days) | export, then `select app.purge_audit_logs('YYYY-MM-DD');` |
| Appointments, payments, refunds    | per hospital policy                         | no automatic deletion                                     |

Export audit rows before purging:

```bash
psql "$DATABASE_URL" -c "\copy (select * from audit_logs where created_at < '2026-01-01') to 'audit-before-2026.csv' csv header"
```

The purge function refuses rows newer than 90 days and writes an `audit.purged` entry. The hospital
must decide its legal retention period for booking records and audit trails (see Data protection
below).

## Tuning without a deploy

Abuse limits live in `app.config` (service role or SQL editor only):

```sql
select * from app.config;
-- e.g. patients on hospital Wi-Fi share one public IP
update app.config set value = 150 where key = 'rate.book_per_ip_hour';
```

## Incident runbooks

**Realtime down or over the connection limit.** Screens show "Auto-refresh every 15 s" and keep
working from polling. No action is needed. If it persists, check Supabase status and the Realtime
quota.

**Database full (500 MB).** Writes fail and bookings stop. Immediately: export and purge audit rows
older than 90 days, then `vacuum full` the purged tables during a quiet hour. Long term: upgrade
the plan.

**A queue looks wrong ("now serving" stuck).** The database is the source of truth. Ask staff to
refresh the console. Check the session status (open, paused). If a patient is stuck in `CALLED`,
start their consultation or skip them; nothing can be called while another patient is `CALLED`.

**Doctor absent at short notice.** Admin opens the queue console. For a session that has not
started, use **Holidays & closures** (stops new bookings) and cancel booked tokens with a reason, or
use `session_control(..., 'CANCEL', note)`, which cancels every active token, notifies patients and
records refund requests for paid bookings. Publish an announcement.

**Payment captured but booking cancelled or slot gone.** The system records a refund request
automatically and never re-adds the patient silently. Review it in **Payments & refunds**. The
refund becomes "processed" only after Razorpay confirms it.

**Webhook failing.** Check `RAZORPAY_WEBHOOK_SECRET`, function logs and Razorpay delivery logs. Events
are idempotent, so re-delivering from Razorpay is safe.

**Suspected leaked tracking link.** The patient (or staff via SQL) rotates the key. In "My bookings",
"New link" invalidates older links.

**Compromised staff account.** Delete the user's roles (Staff & roles), then delete or ban the user
in Supabase Auth. Review `audit_logs` for the actor id.

**Leaked secret key.** Rotate it in Supabase (API keys), update function secrets, redeploy the
functions and rotate Razorpay keys if exposed.

## Data protection (India)

MediQueue stores patient name, mobile number, age and visit metadata. India's **DPDP Act 2023**
applies; its obligations were **not** reviewed in this project. Before real patients:

- Publish a privacy notice (purpose, retention, contact, grievance officer) and link it from the
  booking page.
- Decide retention periods and implement deletion and anonymisation of old appointments.
- Keep a breach-response plan, and restrict and audit staff access (already enforced by roles and
  audit logs).
- Review data residency: choose the Mumbai region. Check the Supabase and Cloudflare DPAs.

## Production readiness checklist

- [ ] Paid Supabase plan (daily backups, no pausing) or an equivalent tested backup and restore
      routine
- [ ] Custom domain, `VITE_APP_ENV=production`, Supabase Site URL updated
- [ ] Turnstile on: `VITE_TURNSTILE_SITE_KEY` deployed first, then Supabase CAPTCHA enabled
      ([deployment.md](deployment.md) §2)
- [ ] Every administrator has turned on two-factor authentication (**2FA** in the staff header);
      strong-password policy in Auth settings
- [ ] Custom SMTP if patient email accounts are offered
- [ ] Scheduled housekeeping running (check `cron.job_run_details`)
- [ ] Load test repeated against the staging project over HTTP; results recorded in
      [09-load-test-report.md](09-load-test-report.md)
- [ ] DPDP review completed; privacy notice published
- [ ] Razorpay live activation, refund policy approved, live keys only in the production project
- [ ] Staff trained on the queue console and incident runbooks; on-call contact defined
