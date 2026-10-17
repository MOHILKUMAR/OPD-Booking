-- Optional scheduled jobs. Run in the Supabase SQL editor after enabling the pg_cron
-- extension (Database → Extensions → pg_cron). pg_cron availability on the Free plan could
-- not be verified (docs/00-free-tier-verification.md); if it is unavailable, call the
-- `housekeeping` Edge Function from any external scheduler with the x-housekeeping-token header.

-- Every 10 minutes: cancel unpaid payment holds 30 min after expiry, clean rate-limit buckets,
-- delete in-app notifications older than 30 days.
select cron.schedule(
  'mediqueue-housekeeping',
  '*/10 * * * *',
  $$ select app.expire_payment_holds(); select app.cleanup_rate_limits(); select app.purge_old_notifications(30); $$
);

-- Audit retention is deliberately NOT scheduled: export first (docs/operations.md), then run
--   select app.purge_audit_logs(date '2025-10-01');

-- To remove the job:
--   select cron.unschedule('mediqueue-housekeeping');
