-- MediQueue: WhatsApp alerts (paid; off by default).
-- A WhatsApp copy of the "turn near" and visit-reminder alerts is queued only when BOTH
--   * the hospital turns on hospitals.whatsapp_alerts_enabled (Settings, after approving the cost), and
--   * the patient opted in for that booking on the tracking page (consent time and language kept).
-- The `automation` Edge Function sends queued copies through Meta's WhatsApp Cloud API with
-- approved templates (WHATSAPP_* secrets); without them nothing is sent. Patients opt out on the
-- tracking page or by replying STOP (`whatsapp-webhook` Edge Function).

alter table public.hospitals add column whatsapp_alerts_enabled boolean not null default false;

alter table public.appointments
  add column whatsapp_consent_at timestamptz,
  add column alert_language text not null default 'en' check (alert_language in ('en', 'hi'));

-- WhatsApp message id, to match delivery-status webhooks
alter table public.notifications add column provider_message_id text;
create unique index notifications_provider_message_uq
  on public.notifications (provider_message_id) where provider_message_id is not null;

-- ---------------------------------------------------------------------------
-- Queueing: same as before, plus the WhatsApp copy for consenting patients
-- ---------------------------------------------------------------------------
create or replace function app.send_alert(
  p_appt public.appointments,
  p_kind text,
  p_title text,
  p_body text,
  p_data jsonb,
  p_sms_text text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  h public.hospitals%rowtype;
begin
  insert into public.notifications (hospital_id, recipient_user_id, appointment_id, kind, title, body, data)
  values (p_appt.hospital_id, p_appt.patient_user_id, p_appt.id, p_kind, p_title, p_body,
          coalesce(p_data, '{}'::jsonb))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  if p_sms_text is not null then
    select * into h from public.hospitals where id = p_appt.hospital_id;
    -- no recipient_user_id: outbound copies are never listed in the app
    if h.sms_alerts_enabled then
      insert into public.notifications (hospital_id, appointment_id, channel, kind, title, body, data, status)
      values (p_appt.hospital_id, p_appt.id, 'SMS', p_kind, p_title, left(p_sms_text, 500),
              coalesce(p_data, '{}'::jsonb), 'PENDING')
      on conflict do nothing;
    end if;
    if h.whatsapp_alerts_enabled and p_appt.whatsapp_consent_at is not null then
      insert into public.notifications (hospital_id, appointment_id, channel, kind, title, body, data, status)
      values (p_appt.hospital_id, p_appt.id, 'WHATSAPP', p_kind, p_title, left(p_sms_text, 500),
              coalesce(p_data, '{}'::jsonb), 'PENDING')
      on conflict do nothing;
    end if;
  end if;
  return true;
end;
$$;

-- Same as before, plus the language and hospital name for templates. WhatsApp copies of a patient
-- who has since opted out are dropped instead of sent.
create or replace function public.svc_claim_outbound_notifications(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  perform app.require_service();
  update public.notifications
     set status = 'FAILED', error = coalesce(error, 'Not sent within 6 hours')
   where status = 'PENDING' and channel in ('SMS', 'WHATSAPP') and created_at < now() - interval '6 hours';
  update public.notifications n
     set status = 'FAILED', error = 'Patient opted out'
    from public.appointments a
   where a.id = n.appointment_id and n.status = 'PENDING' and n.channel = 'WHATSAPP'
     and a.whatsapp_consent_at is null;

  with picked as (
    select n.id
    from public.notifications n
    where n.status = 'PENDING' and n.channel in ('SMS', 'WHATSAPP')
      and (n.claimed_at is null or n.claimed_at < now() - interval '5 minutes')
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 20), 1), 100)
    for update skip locked
  ), claimed as (
    update public.notifications n
       set claimed_at = now()
      from picked
     where n.id = picked.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'channel', c.channel, 'kind', c.kind, 'phone', a.patient_phone,
           'text', c.body, 'data', c.data, 'language', a.alert_language, 'hospital', h.name)), '[]'::jsonb)
    into v_out
  from claimed c
  join public.appointments a on a.id = c.appointment_id
  join public.hospitals h on h.id = c.hospital_id;
  return v_out;
end;
$$;

-- Same as before, plus the provider's message id (matched by delivery-status webhooks).
drop function public.svc_finish_outbound_notification(uuid, boolean, text);
create function public.svc_finish_outbound_notification(
  p_id uuid,
  p_ok boolean,
  p_error text default null,
  p_provider_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_service();
  update public.notifications
     set status = case when p_ok then 'SENT' else 'FAILED' end,
         sent_at = case when p_ok then now() else sent_at end,
         error = case when p_ok then null else left(coalesce(p_error, 'Not sent'), 300) end,
         provider_message_id = case when p_ok then left(p_provider_id, 200) else provider_message_id end
   where id = p_id and status = 'PENDING' and channel in ('SMS', 'WHATSAPP');
end;
$$;

-- ---------------------------------------------------------------------------
-- Patient consent (tracking page): booking holder only, per booking, revocable
-- ---------------------------------------------------------------------------
create or replace function public.set_whatsapp_alerts(
  p_booking_reference text,
  p_access_key text default null,
  p_enabled boolean default false,
  p_language text default 'en'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.appointments%rowtype;
  v_ref text := upper(btrim(coalesce(p_booking_reference, '')));
  v_ip text := app.client_ip();
  v_on boolean := coalesce(p_enabled, false);
  v_lang text := case when p_language = 'hi' then 'hi' else 'en' end;
begin
  if v_ip is not null then
    perform app.hit_rate_limit('lookup:ip:' || v_ip, app.config_int('rate.lookup_per_ip_10min', 120), 600);
  end if;
  perform app.hit_rate_limit('lookup:ref:' || left(v_ref, 20), app.config_int('rate.lookup_per_ref_10min', 60), 600);

  select * into a from public.appointments where booking_reference = v_ref;
  if not found or not (
    (auth.uid() is not null and a.patient_user_id = auth.uid())
    or (nullif(btrim(coalesce(p_access_key, '')), '') is not null and a.access_key_hash = app.hash_key(p_access_key))
  ) then
    perform app.fail('MQ_NOT_FOUND', 'Booking not found. Check the booking reference and link.');
  end if;
  if v_on then
    if not (select h.whatsapp_alerts_enabled from public.hospitals h where h.id = a.hospital_id) then
      perform app.fail('MQ_WHATSAPP_UNAVAILABLE', 'WhatsApp updates are not available at this hospital.');
    end if;
    if a.status not in ('PAYMENT_PENDING', 'BOOKED', 'CONFIRMED', 'ARRIVED', 'WAITING', 'SKIPPED') then
      perform app.fail('MQ_WHATSAPP_UNAVAILABLE', 'WhatsApp updates are only available for upcoming visits.');
    end if;
  end if;

  update public.appointments
     set whatsapp_consent_at = case when v_on then coalesce(whatsapp_consent_at, now()) end,
         alert_language = v_lang
   where id = a.id
  returning * into a;
  if not v_on then
    update public.notifications set status = 'FAILED', error = 'Patient opted out'
     where appointment_id = a.id and channel = 'WHATSAPP' and status = 'PENDING';
  end if;
  -- no phone number in the audit log
  perform app.audit(a.hospital_id,
    case when v_on then 'appointment.whatsapp_opt_in' else 'appointment.whatsapp_opt_out' end,
    'appointment', a.id::text, jsonb_build_object('language', v_lang, 'via', 'tracking_page'));
  return jsonb_build_object('enabled', a.whatsapp_consent_at is not null, 'language', a.alert_language);
end;
$$;

-- ---------------------------------------------------------------------------
-- WhatsApp webhook (service role): STOP replies and failed deliveries
-- ---------------------------------------------------------------------------
create or replace function public.svc_whatsapp_opt_out(p_phone text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := app.normalize_phone(p_phone);
  v_count integer;
begin
  perform app.require_service();
  if v_phone is null then
    return 0;
  end if;
  with withdrawn as (
    update public.appointments
       set whatsapp_consent_at = null
     where patient_phone = v_phone and whatsapp_consent_at is not null
    returning id, hospital_id
  ), dropped as (
    update public.notifications n
       set status = 'FAILED', error = 'Patient opted out'
      from withdrawn w
     where n.appointment_id = w.id and n.channel = 'WHATSAPP' and n.status = 'PENDING'
    returning 1
  ), audited as (
    insert into public.audit_logs (hospital_id, actor_user_id, actor_role, action, entity_type, entity_id, details)
    select w.hospital_id, null, 'patient', 'appointment.whatsapp_opt_out', 'appointment', w.id::text,
           jsonb_build_object('via', 'whatsapp_reply')
    from withdrawn w
    returning 1
  )
  select count(*)::integer into v_count from withdrawn;
  return v_count;
end;
$$;

create or replace function public.svc_record_message_status(
  p_provider_message_id text,
  p_status text,
  p_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_service();
  if p_status <> 'failed' then
    return 'IGNORED';
  end if;
  update public.notifications
     set status = 'FAILED', error = left(coalesce(p_error, 'Delivery failed'), 300)
   where provider_message_id = p_provider_message_id and channel in ('SMS', 'WHATSAPP');
  return case when found then 'RECORDED' else 'UNKNOWN' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tracking view: adds the WhatsApp option (available at this hospital / on for this booking)
-- ---------------------------------------------------------------------------
create or replace function app.booking_view(a public.appointments)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.queue_states%rowtype;
  d public.doctors%rowtype;
  h public.hospitals%rowtype;
  s public.shifts%rowtype;
  v_dep text;
  v_ahead integer;
  v_payment jsonb;
  v_refund jsonb;
  v_notes jsonb;
  v_block text;
begin
  select * into q from public.queue_states where id = a.queue_state_id;
  select * into d from public.doctors where id = a.doctor_id;
  select * into h from public.hospitals where id = a.hospital_id;
  select * into s from public.shifts where id = a.shift_id;
  select name into v_dep from public.departments where id = d.department_id;

  if a.token_no is not null and a.status in ('BOOKED', 'CONFIRMED', 'ARRIVED', 'WAITING') then
    select count(*)::integer into v_ahead
    from public.appointments x
    where x.queue_state_id = a.queue_state_id
      and x.token_no < a.token_no
      and x.status in ('BOOKED', 'CONFIRMED', 'ARRIVED', 'WAITING', 'CALLED', 'IN_CONSULTATION');
  end if;

  select jsonb_build_object('status', p.status, 'amount_paise', p.amount_paise, 'verified_at', p.verified_at)
    into v_payment
  from public.payments p where p.appointment_id = a.id;

  select jsonb_build_object('status', r.status, 'amount_paise', r.amount_paise, 'processed_at', r.processed_at)
    into v_refund
  from public.refunds r where r.appointment_id = a.id order by r.created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
                                               'data', n.data, 'created_at', n.created_at)
                  order by n.created_at desc), '[]'::jsonb)
    into v_notes
  from (
    select * from public.notifications nn
    where nn.appointment_id = a.id and nn.channel = 'IN_APP'
    order by nn.created_at desc
    limit 5
  ) n;

  v_block := app.patient_cancel_block(a);

  return jsonb_build_object(
    'booking_reference', a.booking_reference,
    'token_no', a.token_no,
    'status', a.status,
    'source', a.source,
    'session_date', a.session_date,
    'created_at', a.created_at,
    'patient_name_masked', app.mask_name(a.patient_name),
    'patient_phone_masked', app.mask_phone(a.patient_phone),
    'doctor', jsonb_build_object('id', d.id, 'full_name', d.full_name, 'specialty', d.specialty,
                                 'room_no', d.room_no, 'department', v_dep),
    'shift', jsonb_build_object('id', s.id, 'name', s.name, 'start_time', q.start_time, 'end_time', q.end_time),
    'hospital', jsonb_build_object('name', h.name, 'address_line', h.address_line, 'city', h.city,
                                   'state', h.state, 'postal_code', h.postal_code, 'phone', h.phone,
                                   'map_url', h.map_url, 'visit_instructions', h.visit_instructions),
    'fee_paise', a.fee_paise,
    'payment_mode', a.payment_mode,
    'payment', v_payment,
    'refund', v_refund,
    'hold_expires_at', a.hold_expires_at,
    'cancel_reason', a.cancel_reason,
    'queue', app.queue_public(q),
    'patients_ahead', v_ahead,
    'estimated_wait_minutes', case when v_ahead is not null then v_ahead * s.avg_consult_minutes end,
    'can_cancel', v_block is null,
    'cancel_block_reason', v_block,
    'notifications', v_notes,
    'whatsapp', jsonb_build_object('available', h.whatsapp_alerts_enabled,
                                   'enabled', a.whatsapp_consent_at is not null,
                                   'language', a.alert_language)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function
  public.svc_finish_outbound_notification(uuid, boolean, text, text),
  public.svc_whatsapp_opt_out(text),
  public.svc_record_message_status(text, text, text)
from public, anon, authenticated;
grant execute on function
  public.svc_claim_outbound_notifications(integer),
  public.svc_finish_outbound_notification(uuid, boolean, text, text),
  public.svc_whatsapp_opt_out(text),
  public.svc_record_message_status(text, text, text)
to service_role;

revoke execute on function public.set_whatsapp_alerts(text, text, boolean, text) from public;
grant execute on function public.set_whatsapp_alerts(text, text, boolean, text) to anon, authenticated;
