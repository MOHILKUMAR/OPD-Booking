-- MediQueue: automatic refunds.
-- With hospitals.auto_refund_enabled on, refund requests (patient cancellations within the
-- cut-off, bookings cancelled by the hospital, refunds an administrator requests) are sent to
-- Razorpay without waiting for an administrator. Requests above auto_refund_max_paise, when set,
-- still wait on the Payments page. Only the `automation` Edge Function (which holds the Razorpay
-- secret) executes them; the scheduled job only wakes it when there is work.
-- Nothing is promised early: the patient is told "refund initiated" after Razorpay accepts the
-- request and "refund processed" after Razorpay confirms it.

alter table public.hospitals
  add column auto_refund_enabled boolean not null default false,
  add column auto_refund_max_paise integer check (auto_refund_max_paise between 100 and 10000000);

alter table public.refunds
  add column initiated_via text check (initiated_via in ('ADMIN', 'AUTO'));

create index refunds_requested_idx on public.refunds (requested_at) where status = 'REQUESTED';

-- Refund requests the automation may send now. Requests older than a day are left to an
-- administrator, so a misconfigured gateway cannot keep the job busy forever.
create or replace function app.auto_refund_candidates(p_gateway_mode text default null)
returns setof public.refunds
language sql
stable
security definer
set search_path = ''
as $$
  select r.*
  from public.refunds r
  join public.hospitals h on h.id = r.hospital_id
  join public.payments p on p.id = r.payment_id
  where r.status = 'REQUESTED'
    and r.requested_at > now() - interval '1 day'
    and h.auto_refund_enabled
    and (h.auto_refund_max_paise is null or r.amount_paise <= h.auto_refund_max_paise)
    and p.status = 'CAPTURED'
    and p.gateway_payment_id is not null
    and (p_gateway_mode is null or p.gateway_mode = p_gateway_mode);
$$;

-- Claims up to p_limit eligible requests (PROCESSING, initiated_via AUTO) for the Edge Function.
-- SKIP LOCKED + the status check make concurrent runs and an administrator's manual refund safe:
-- whichever locks the row first moves it out of REQUESTED.
create or replace function public.svc_claim_auto_refunds(p_gateway_mode text, p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform app.require_service();
  if p_gateway_mode not in ('test', 'live') then
    perform app.fail('MQ_INVALID_REQUEST', 'Unknown gateway mode.');
  end if;
  with picked as (
    select c.id
    from app.auto_refund_candidates(p_gateway_mode) c
    order by c.requested_at
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
  ), locked as (
    select r.id from public.refunds r
    where r.id in (select id from picked) and r.status = 'REQUESTED'
    for update skip locked
  ), claimed as (
    update public.refunds r
       set status = 'PROCESSING', initiated_via = 'AUTO'
      from locked
     where r.id = locked.id
    returning r.*
  ), audited as (
    insert into public.audit_logs (hospital_id, actor_user_id, actor_role, action, entity_type, entity_id, details)
    select c.hospital_id, null, 'system', 'refund.initiated', 'refund', c.id::text,
           jsonb_build_object('amount_paise', c.amount_paise, 'payment_id', c.payment_id, 'auto', true)
    from claimed c
    returning 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'refund_id', c.id, 'gateway_payment_id', p.gateway_payment_id, 'amount_paise', c.amount_paise,
           'idempotency_key', c.idempotency_key) order by c.requested_at), '[]'::jsonb)
    into v_out
  from claimed c
  join public.payments p on p.id = c.payment_id;
  return v_out;
end;
$$;

-- Same as before, and records that an administrator started it.
create or replace function public.svc_begin_refund(p_refund_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.refunds%rowtype;
  p public.payments%rowtype;
begin
  perform app.require_service();
  select * into r from public.refunds where id = p_refund_id for update;
  if not found then
    perform app.fail('MQ_NOT_FOUND', 'Refund not found.');
  end if;
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_actor_user_id and ur.hospital_id = r.hospital_id and ur.role = 'admin'
  ) then
    perform app.fail('MQ_FORBIDDEN', 'Administrator access required.');
  end if;
  if r.status not in ('REQUESTED', 'FAILED') then
    perform app.fail('MQ_INVALID_TRANSITION', format('This refund is already %s.', r.status));
  end if;
  select * into p from public.payments where id = r.payment_id;
  update public.refunds
     set status = 'PROCESSING', requested_by = coalesce(requested_by, p_actor_user_id), initiated_via = 'ADMIN'
   where id = r.id;
  insert into public.audit_logs (hospital_id, actor_user_id, actor_role, action, entity_type, entity_id, details)
  values (r.hospital_id, p_actor_user_id, 'admin', 'refund.initiated', 'refund', r.id::text,
          jsonb_build_object('amount_paise', r.amount_paise, 'payment_id', p.id));
  return jsonb_build_object('refund_id', r.id, 'gateway_payment_id', p.gateway_payment_id,
                            'amount_paise', r.amount_paise, 'idempotency_key', r.idempotency_key,
                            'gateway_mode', p.gateway_mode);
end;
$$;

-- Same as before, plus a "refund initiated" notification once Razorpay has accepted a refund
-- that is still pending at the bank.
create or replace function public.svc_finish_refund_request(
  p_refund_id uuid,
  p_gateway_refund_id text,
  p_gateway_status text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.refunds%rowtype;
  a public.appointments%rowtype;
  v_status public.refund_status;
begin
  perform app.require_service();
  select * into r from public.refunds where id = p_refund_id for update;
  if not found then
    perform app.fail('MQ_NOT_FOUND', 'Refund not found.');
  end if;
  if r.status = 'PROCESSED' then
    return jsonb_build_object('refund_id', r.id, 'status', r.status);
  end if;
  v_status := case
    when p_gateway_refund_id is null then 'FAILED'
    when p_gateway_status = 'processed' then 'PROCESSED'
    when p_gateway_status = 'failed' then 'FAILED'
    else 'PROCESSING'
  end;
  update public.refunds
     set gateway_refund_id = coalesce(p_gateway_refund_id, gateway_refund_id)
   where id = r.id;
  if v_status = 'PROCESSED' or (v_status = 'FAILED' and p_gateway_refund_id is not null) then
    perform app.complete_refund(p_gateway_refund_id, v_status, p_error);
  elsif v_status = 'FAILED' then
    update public.refunds set status = 'FAILED', failure_reason = left(coalesce(p_error, 'Refund request failed'), 500)
     where id = r.id;
    perform app.audit(r.hospital_id, 'refund.failed', 'refund', r.id::text, jsonb_build_object('error', left(p_error, 200)));
  elsif r.gateway_refund_id is null then
    -- accepted by Razorpay, not yet settled (the webhook or a later call marks it processed)
    select * into a from public.appointments where id = r.appointment_id;
    perform app.notify_appointment(a, 'REFUND_INITIATED', 'Refund initiated',
      format('Razorpay has accepted a refund of Rs %s to your original payment method. You will see another update when it is processed.',
             to_char(r.amount_paise / 100.0, 'FM999999990.00')),
      jsonb_build_object('amount_paise', r.amount_paise));
  end if;
  select * into r from public.refunds where id = p_refund_id;
  return jsonb_build_object('refund_id', r.id, 'status', r.status, 'gateway_refund_id', r.gateway_refund_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Waking the automation Edge Function (pg_cron every minute, see scheduled-jobs.sql)
-- ---------------------------------------------------------------------------
create or replace function app.automation_pending()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from app.auto_refund_candidates(null))
      or exists (
        select 1 from public.notifications n
        where n.status = 'PENDING' and n.channel in ('SMS', 'WHATSAPP')
          and n.created_at > now() - interval '6 hours'
          and (n.claimed_at is null or n.claimed_at < now() - interval '5 minutes')
      );
$$;

-- Calls the Edge Function through pg_net only when there is work. The function URL and its
-- token live in Supabase Vault (never in this repository); without pg_net or the two Vault
-- secrets this returns NOT_CONFIGURED and does nothing.
create or replace function app.kick_automation()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
begin
  if not app.automation_pending() then
    return 'IDLE';
  end if;
  if to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    return 'NOT_CONFIGURED';
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'mediqueue_automation_url';
  select s.decrypted_secret into v_token from vault.decrypted_secrets s where s.name = 'mediqueue_automation_token';
  if v_url is null or v_token is null then
    return 'NOT_CONFIGURED';
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-automation-token', v_token),
    timeout_milliseconds := 30000
  );
  return 'TRIGGERED';
end;
$$;

revoke execute on function
  app.auto_refund_candidates(text),
  app.automation_pending(),
  app.kick_automation()
from public, anon, authenticated;

revoke execute on function public.svc_claim_auto_refunds(text, integer) from public, anon, authenticated;
grant execute on function
  public.svc_claim_auto_refunds(text, integer),
  public.svc_begin_refund(uuid, uuid),
  public.svc_finish_refund_request(uuid, text, text, text)
to service_role;
