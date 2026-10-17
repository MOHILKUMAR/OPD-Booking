-- Scheduled jobs. Run in the Supabase SQL editor (or `supabase db query --linked -f`) after
-- enabling the pg_cron extension (Database → Extensions → pg_cron). Both extensions used here
-- (pg_cron, pg_net) and Vault are available on the Free plan. If pg_cron is unavailable, call
-- the `housekeeping` Edge Function from an external scheduler with the x-housekeeping-token header.

-- Every 10 minutes: cancel unpaid payment holds 30 min after expiry, clean rate-limit buckets,
-- delete in-app notifications older than 30 days, and trim pg_cron's own run history.
select cron.schedule(
  'mediqueue-housekeeping',
  '*/10 * * * *',
  $$ select app.expire_payment_holds(); select app.cleanup_rate_limits(); select app.purge_old_notifications(30);
     delete from cron.job_run_details where end_time < now() - interval '7 days'; $$
);

-- Every minute: visit reminders, then wake the `automation` Edge Function (automatic refunds,
-- queued SMS copies) only when there is work. Waking needs pg_net and two Vault secrets:
--   create extension if not exists pg_net;
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/automation',
--                              'mediqueue_automation_url', 'MediQueue automation function URL');
--   select vault.create_secret('<the AUTOMATION_TOKEN function secret>',
--                              'mediqueue_automation_token', 'MediQueue automation shared secret');
-- Use scripts/setup-automation.mjs to generate the token and set both sides without printing it.
-- Without them app.kick_automation() returns NOT_CONFIGURED and refunds wait for an administrator.
select cron.schedule(
  'mediqueue-automation',
  '* * * * *',
  $$ select app.queue_visit_reminders(); select app.kick_automation(); $$
);

-- Audit retention is deliberately NOT scheduled: export first (Admin → Reports → Audit log,
-- docs/operations.md), then run
--   select app.purge_audit_logs(date '2025-10-01');

-- To remove the jobs:
--   select cron.unschedule('mediqueue-housekeeping');
--   select cron.unschedule('mediqueue-automation');
