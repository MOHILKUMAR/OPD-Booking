-- MediQueue: patient alerts.
--   * "Your turn is near": once per booking, when the session is open and at most
--     hospitals.turn_alert_ahead patients are ahead (0 turns it off).
--   * Delay notice: each time staff raise a session's delay past another 15-minute step.
--   * Visit reminder: hospitals.visit_reminder_minutes before the OPD starts, for bookings made
--     before that point (0 turns it off). Created by the scheduled job (supabase/sql/scheduled-jobs.sql).
-- All of these are free in-app notifications: the tracking page lists them and shows them as
-- browser notifications while it is open. SMS/WhatsApp copies are queued only when a hospital
-- sets sms_alerts_enabled; the `automation` Edge Function sends them through a provider adapter,
-- and none is configured by default (a paid provider and DLT registration are needed in India).
-- Notifications keep the English text for old clients and logs, plus `data` so the app can
-- show them in the patient's language.

alter table public.hospitals
  add column turn_alert_ahead smallint not null default 3 check (turn_alert_ahead between 0 and 20),
  add column visit_reminder_minutes smallint not null default 120
    check (visit_reminder_minutes between 0 and 1440),
  add column sms_alerts_enabled boolean not null default false;

alter table public.notifications
  add column data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  add column claimed_at timestamptz,
  add column sent_at timestamptz,
  add column error text check (length(error) <= 300);

-- One alert of each of these kinds per booking and channel, however often the queue changes.
create unique index notifications_once_per_alert
  on public.notifications (appointment_id, kind, channel)
  where kind in ('TURN_NEAR', 'VISIT_REMINDER');

-- ---------------------------------------------------------------------------
-- Notification helpers
-- ---------------------------------------------------------------------------
-- Same as before plus `data` (template values for translated display). Existing callers keep
-- working: plpgsql resolves the function by name when it runs.
drop function app.notify_appointment(public.appointments, text, text, text);
create function app.notify_appointment(
  p_appt public.appointments,
  p_kind text,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (hospital_id, recipient_user_id, appointment_id, kind, title, body, data)
  values (p_appt.hospital_id, p_appt.patient_user_id, p_appt.id, p_kind, p_title, p_body,
          coalesce(p_data, '{}'::jsonb));
end;
$$;

-- In-app alert, plus a queued SMS copy when the hospital has turned SMS alerts on and the alert
-- has SMS text. Returns false when this alert was already sent for the booking.
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
begin
  insert into public.notifications (hospital_id, recipient_user_id, appointment_id, kind, title, body, data)
  values (p_appt.hospital_id, p_appt.patient_user_id, p_appt.id, p_kind, p_title, p_body,
          coalesce(p_data, '{}'::jsonb))
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  if p_sms_text is not null
     and (select h.sms_alerts_enabled from public.hospitals h where h.id = p_appt.hospital_id) then
    -- no recipient_user_id: outbound copies are never listed in the app
    insert into public.notifications (hospital_id, appointment_id, channel, kind, title, body, data, status)
    values (p_appt.hospital_id, p_appt.id, 'SMS', p_kind, p_title, left(p_sms_text, 500),
            coalesce(p_data, '{}'::jsonb), 'PENDING')
    on conflict do nothing;
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- "Your turn is near" and delay notices, driven by queue_states changes
-- ---------------------------------------------------------------------------
create or replace function app.notify_turn_near(p_queue_state_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.queue_states%rowtype;
  h public.hospitals%rowtype;
  d public.doctors%rowtype;
  a public.appointments%rowtype;
  r record;
  v_place text;
  v_count integer := 0;
begin
  select * into q from public.queue_states where id = p_queue_state_id;
  if not found or q.status <> 'OPEN' then
    return 0;
  end if;
  select * into h from public.hospitals where id = q.hospital_id;
  if h.turn_alert_ahead = 0 then
    return 0;
  end if;
  select * into d from public.doctors where id = q.doctor_id;
  v_place := d.full_name || coalesce(' (Room ' || d.room_no || ')', '');

  -- Patients ahead = same rule as the tracking page (app.booking_view).
  for r in
    select x.id, x.ahead
    from (
      select b.id, b.status,
             (count(*) filter (
                where b.status in ('BOOKED', 'CONFIRMED', 'ARRIVED', 'WAITING', 'CALLED', 'IN_CONSULTATION')
              ) over (order by b.token_no rows between unbounded preceding and 1 preceding))::integer as ahead
      from public.appointments b
      where b.queue_state_id = q.id and b.token_no is not null
    ) x
    where x.status in ('BOOKED', 'CONFIRMED', 'ARRIVED', 'WAITING')
      and x.ahead <= h.turn_alert_ahead
      and not exists (
        select 1 from public.notifications n
        where n.appointment_id = x.id and n.kind = 'TURN_NEAR' and n.channel = 'IN_APP'
      )
  loop
    select * into a from public.appointments where id = r.id;
    if app.send_alert(
      a, 'TURN_NEAR',
      format('Token %s: your turn is near', a.token_no),
      case r.ahead
        when 0 then format('You are next. Please wait near %s.', v_place)
        when 1 then format('1 patient is ahead of you. Please wait near %s.', v_place)
        else format('%s patients are ahead of you. Please wait near %s.', r.ahead, v_place)
      end,
      jsonb_build_object('token_no', a.token_no, 'ahead', r.ahead, 'doctor', d.full_name, 'room', d.room_no),
      format('%s: Token %s, your turn is near (%s ahead). Please wait near %s.',
             h.name, a.token_no, r.ahead, v_place)
    ) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function app.notify_delay(p_queue_state_id uuid, p_delay_minutes integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.queue_states%rowtype;
  d public.doctors%rowtype;
  a public.appointments%rowtype;
  v_count integer := 0;
begin
  select * into q from public.queue_states where id = p_queue_state_id;
  select * into d from public.doctors where id = q.doctor_id;
  for a in
    select * from public.appointments x
    where x.queue_state_id = q.id and x.status in ('BOOKED', 'CONFIRMED', 'ARRIVED', 'WAITING')
  loop
    perform app.notify_appointment(a, 'DELAY',
      format('%s is running about %s minutes late', d.full_name, p_delay_minutes),
      coalesce(q.public_note, 'Your token stays valid. The tracking page shows the live queue.'),
      jsonb_build_object('doctor', d.full_name, 'delay_minutes', p_delay_minutes, 'note', q.public_note));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Every queue change goes through an UPDATE of queue_states (app.refresh_queue_state,
-- current_token_no, session_control), so one trigger covers calls, completions, skips,
-- cancellations, new bookings and the session opening.
create or replace function app.queue_state_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'OPEN' then
    perform app.notify_turn_near(new.id);
  end if;
  -- each time the delay passes another 15-minute step (15, 30, 45 ...)
  if new.delay_minutes / 15 > old.delay_minutes / 15
     and new.status in ('SCHEDULED', 'OPEN', 'PAUSED') then
    perform app.notify_delay(new.id, new.delay_minutes);
  end if;
  return null;
end;
$$;

create trigger queue_states_alerts after update on public.queue_states
  for each row
  when (new.status = 'OPEN' or new.delay_minutes <> old.delay_minutes)
  execute function app.queue_state_alerts();

-- ---------------------------------------------------------------------------
-- Visit reminders (scheduled job)
-- ---------------------------------------------------------------------------
create or replace function app.queue_visit_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  a public.appointments%rowtype;
  v_count integer := 0;
begin
  for r in
    select x.id, h.name as hospital_name, d.full_name as doctor, d.room_no, q.start_time, q.session_date,
           h.timezone
    from public.queue_states q
    join public.hospitals h on h.id = q.hospital_id
    join public.doctors d on d.id = q.doctor_id
    join public.appointments x on x.queue_state_id = q.id
    cross join lateral (
      select ((q.session_date + q.start_time) at time zone h.timezone) as starts_at,
             make_interval(mins => h.visit_reminder_minutes) as lead
    ) t
    -- server dates are UTC; with a lead of up to a day an IST session can be two UTC dates ahead
    where q.session_date between current_date - 1 and current_date + 2
      and q.status in ('SCHEDULED', 'OPEN', 'PAUSED')
      and h.visit_reminder_minutes > 0
      and x.status in ('BOOKED', 'CONFIRMED')
      and now() >= t.starts_at - t.lead
      and now() < t.starts_at
      -- bookings made inside the reminder window just saw their confirmation
      and x.created_at < t.starts_at - t.lead
      and not exists (
        select 1 from public.notifications n
        where n.appointment_id = x.id and n.kind = 'VISIT_REMINDER' and n.channel = 'IN_APP'
      )
  loop
    select * into a from public.appointments where id = r.id;
    if app.send_alert(
      a, 'VISIT_REMINDER',
      format('Reminder: token %s at %s', a.token_no, to_char(date '2000-01-01' + r.start_time, 'FMHH12:MI AM')),
      format('Your OPD visit with %s%s starts at %s. Please arrive a little early and check in at reception.',
             r.doctor, coalesce(' (Room ' || r.room_no || ')', ''), to_char(date '2000-01-01' + r.start_time, 'FMHH12:MI AM')),
      jsonb_build_object('token_no', a.token_no, 'doctor', r.doctor, 'room', r.room_no,
                         'start_time', left(r.start_time::text, 5), 'session_date', r.session_date),
      format('%s: Reminder, token %s with %s at %s.',
             r.hospital_name, a.token_no, r.doctor, to_char(date '2000-01-01' + r.start_time, 'FMHH12:MI AM'))
    ) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Housekeeping now also creates visit reminders (pg_cron calls the same app.* functions).
create or replace function public.svc_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_service();
  return jsonb_build_object(
    'expired_holds', app.expire_payment_holds(),
    'rate_limit_rows', app.cleanup_rate_limits(),
    'notifications_purged', app.purge_old_notifications(),
    'visit_reminders', app.queue_visit_reminders()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Outbound SMS/WhatsApp queue (used by the `automation` Edge Function)
-- ---------------------------------------------------------------------------
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
  -- a reminder that could not go out within 6 hours is no longer useful
  update public.notifications
     set status = 'FAILED', error = coalesce(error, 'Not sent within 6 hours')
   where status = 'PENDING' and channel in ('SMS', 'WHATSAPP') and created_at < now() - interval '6 hours';

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
           'text', c.body, 'data', c.data)), '[]'::jsonb)
    into v_out
  from claimed c
  join public.appointments a on a.id = c.appointment_id;
  return v_out;
end;
$$;

create or replace function public.svc_finish_outbound_notification(p_id uuid, p_ok boolean, p_error text default null)
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
         error = case when p_ok then null else left(coalesce(p_error, 'Not sent'), 300) end
   where id = p_id and status = 'PENDING' and channel in ('SMS', 'WHATSAPP');
end;
$$;

-- ---------------------------------------------------------------------------
-- Tracking view: in-app notifications only, with id and data for translated display
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
    'notifications', v_notes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: internal helpers stay private; svc_* are for the secret key only.
-- ---------------------------------------------------------------------------
revoke execute on function
  app.notify_appointment(public.appointments, text, text, text, jsonb),
  app.send_alert(public.appointments, text, text, text, jsonb, text),
  app.notify_turn_near(uuid),
  app.notify_delay(uuid, integer),
  app.queue_state_alerts(),
  app.queue_visit_reminders()
from public, anon, authenticated;

revoke execute on function
  public.svc_claim_outbound_notifications(integer),
  public.svc_finish_outbound_notification(uuid, boolean, text)
from public, anon, authenticated;
grant execute on function
  public.svc_claim_outbound_notifications(integer),
  public.svc_finish_outbound_notification(uuid, boolean, text),
  public.svc_housekeeping()
to service_role;
