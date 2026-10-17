-- MediQueue: report exports for administrators (the Reports page turns pages of rows into CSV).
--   appointments   one row per booking (session date range); patient name, phone and age only
--                  when the administrator asks for them
--   daily_summary  one row per OPD session: tokens, outcomes, waiting time, fees and refunds
--   payments       one row per online payment (created in the date range)
--   refunds        one row per refund request (requested in the date range)
--   audit          the audit log (export before running app.purge_audit_logs)
-- Every export is itself audited ("report.exported", recorded with the first page). Times are in
-- the hospital's timezone; amounts in rupees.

create or replace function app.local_ts(p_ts timestamptz, p_tz text)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_ts at time zone p_tz, 'YYYY-MM-DD HH24:MI');
$$;

create or replace function app.minutes_between(p_from timestamptz, p_to timestamptz)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_from is not null and p_to is not null and p_to >= p_from
              then round(extract(epoch from (p_to - p_from)) / 60)::integer end;
$$;

create or replace function public.admin_export(
  p_hospital_id uuid,
  p_kind text,
  p_from date,
  p_to date,
  p_include_patient boolean default false,
  p_offset integer default 0,
  p_limit integer default 2000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.hospitals%rowtype;
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_pii boolean := coalesce(p_include_patient, false) and lower(btrim(coalesce(p_kind, ''))) = 'appointments';
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit integer := least(greatest(coalesce(p_limit, 2000), 1), 5000);
  v_start timestamptz;
  v_end timestamptz;
  v_rows jsonb;
  v_more boolean := false;
begin
  if p_hospital_id is null or not app.is_admin(p_hospital_id) then
    perform app.fail('MQ_FORBIDDEN', 'Administrator access required.');
  end if;
  if v_kind not in ('appointments', 'daily_summary', 'payments', 'refunds', 'audit') then
    perform app.fail('MQ_INVALID_REQUEST', 'Unknown report.');
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    perform app.fail('MQ_INVALID_RANGE', 'Choose a start date on or before the end date.');
  end if;
  if p_to - p_from > 366 then
    perform app.fail('MQ_INVALID_RANGE', 'Export at most one year at a time.');
  end if;

  select * into h from public.hospitals where id = p_hospital_id;
  v_start := p_from::timestamp at time zone h.timezone;
  v_end := (p_to + 1)::timestamp at time zone h.timezone;

  if v_offset = 0 then
    perform app.audit(p_hospital_id, 'report.exported', 'report', v_kind,
      jsonb_build_object('from', p_from, 'to', p_to, 'include_patient_details', v_pii));
  end if;

  -- Each branch numbers its rows in report order, takes one row more than the page to know
  -- whether another page follows, and aggregates in that order.
  case v_kind
  when 'appointments' then
    select coalesce(jsonb_agg(to_jsonb(x) - 'seq' order by x.seq), '[]'::jsonb) into v_rows
    from (
      select row_number() over (order by a.session_date, q.start_time, d.full_name, a.token_no nulls last,
                                         a.created_at, a.id) as seq,
             a.session_date,
             s.name as session,
             d.full_name as doctor,
             dep.name as department,
             a.token_no,
             a.booking_reference,
             a.source,
             a.status,
             a.payment_mode,
             round(a.fee_paise / 100.0, 2) as fee_rupees,
             p.status as payment_status,
             rf.status as refund_status,
             app.local_ts(a.created_at, h.timezone) as booked_at,
             app.local_ts(a.arrived_at, h.timezone) as arrived_at,
             app.local_ts(a.called_at, h.timezone) as called_at,
             app.local_ts(a.completed_at, h.timezone) as completed_at,
             app.local_ts(a.cancelled_at, h.timezone) as cancelled_at,
             a.cancel_reason,
             app.minutes_between(a.arrived_at, a.called_at) as wait_minutes,
             app.minutes_between(a.consultation_started_at, a.completed_at) as consult_minutes,
             case when v_pii then a.patient_name end as patient_name,
             case when v_pii then a.patient_phone end as patient_phone,
             case when v_pii then a.patient_age end as patient_age
      from public.appointments a
      join public.queue_states q on q.id = a.queue_state_id
      join public.shifts s on s.id = a.shift_id
      join public.doctors d on d.id = a.doctor_id
      left join public.departments dep on dep.id = d.department_id
      left join public.payments p on p.appointment_id = a.id
      left join lateral (
        select r.status from public.refunds r where r.appointment_id = a.id order by r.created_at desc limit 1
      ) rf on true
      where a.hospital_id = p_hospital_id and a.session_date between p_from and p_to
      order by seq
      offset v_offset limit v_limit + 1
    ) x;

  when 'daily_summary' then
    select coalesce(jsonb_agg(to_jsonb(x) - 'seq' order by x.seq), '[]'::jsonb) into v_rows
    from (
      select row_number() over (order by q.session_date, q.start_time, d.full_name, q.id) as seq,
             q.session_date,
             d.full_name as doctor,
             dep.name as department,
             s.name as session,
             left(q.start_time::text, 5) as start_time,
             left(q.end_time::text, 5) as end_time,
             q.status as session_status,
             q.capacity,
             c.tokens_issued,
             c.online,
             c.walk_in,
             c.completed,
             c.cancelled,
             c.no_show,
             c.avg_wait_minutes,
             c.avg_consult_minutes,
             round(coalesce(c.paid_paise, 0) / 100.0, 2) as online_fees_rupees,
             round(coalesce(c.refunded_paise, 0) / 100.0, 2) as refunded_rupees,
             q.delay_minutes
      from public.queue_states q
      join public.shifts s on s.id = q.shift_id
      join public.doctors d on d.id = q.doctor_id
      left join public.departments dep on dep.id = d.department_id
      cross join lateral (
        select
          count(*) filter (where a.token_no is not null and a.status not in ('CANCELLED', 'PAYMENT_PENDING'))::integer as tokens_issued,
          count(*) filter (where a.source = 'ONLINE' and a.token_no is not null and a.status not in ('CANCELLED', 'PAYMENT_PENDING'))::integer as online,
          count(*) filter (where a.source = 'WALK_IN' and a.status <> 'CANCELLED')::integer as walk_in,
          count(*) filter (where a.status = 'COMPLETED')::integer as completed,
          count(*) filter (where a.status = 'CANCELLED' and a.token_no is not null)::integer as cancelled,
          count(*) filter (where a.status = 'NO_SHOW')::integer as no_show,
          round(avg(app.minutes_between(a.arrived_at, a.called_at)))::integer as avg_wait_minutes,
          round(avg(app.minutes_between(a.consultation_started_at, a.completed_at)))::integer as avg_consult_minutes,
          (select sum(p.amount_paise) from public.payments p
            join public.appointments pa on pa.id = p.appointment_id
            where pa.queue_state_id = q.id and p.status in ('CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED')) as paid_paise,
          (select sum(r.amount_paise) from public.refunds r
            join public.appointments ra on ra.id = r.appointment_id
            where ra.queue_state_id = q.id and r.status = 'PROCESSED') as refunded_paise
        from public.appointments a
        where a.queue_state_id = q.id
      ) c
      where q.hospital_id = p_hospital_id and q.session_date between p_from and p_to
      order by seq
      offset v_offset limit v_limit + 1
    ) x;

  when 'payments' then
    select coalesce(jsonb_agg(to_jsonb(x) - 'seq' order by x.seq), '[]'::jsonb) into v_rows
    from (
      select row_number() over (order by p.created_at, p.id) as seq,
             app.local_ts(p.created_at, h.timezone) as created_at,
             a.booking_reference,
             a.session_date,
             d.full_name as doctor,
             round(p.amount_paise / 100.0, 2) as amount_rupees,
             p.status,
             p.gateway_mode as mode,
             p.verified_via,
             app.local_ts(p.verified_at, h.timezone) as verified_at,
             p.gateway_order_id,
             p.gateway_payment_id,
             rf.status as refund_status
      from public.payments p
      join public.appointments a on a.id = p.appointment_id
      join public.doctors d on d.id = a.doctor_id
      left join lateral (
        select r.status from public.refunds r where r.payment_id = p.id order by r.created_at desc limit 1
      ) rf on true
      where p.hospital_id = p_hospital_id and p.created_at >= v_start and p.created_at < v_end
      order by seq
      offset v_offset limit v_limit + 1
    ) x;

  when 'refunds' then
    select coalesce(jsonb_agg(to_jsonb(x) - 'seq' order by x.seq), '[]'::jsonb) into v_rows
    from (
      select row_number() over (order by r.requested_at, r.id) as seq,
             app.local_ts(r.requested_at, h.timezone) as requested_at,
             a.booking_reference,
             a.session_date,
             round(r.amount_paise / 100.0, 2) as amount_rupees,
             r.status,
             r.initiated_via,
             r.reason,
             r.gateway_refund_id,
             app.local_ts(r.processed_at, h.timezone) as processed_at,
             r.failure_reason
      from public.refunds r
      join public.appointments a on a.id = r.appointment_id
      where r.hospital_id = p_hospital_id and r.requested_at >= v_start and r.requested_at < v_end
      order by seq
      offset v_offset limit v_limit + 1
    ) x;

  when 'audit' then
    select coalesce(jsonb_agg(to_jsonb(x) - 'seq' order by x.seq), '[]'::jsonb) into v_rows
    from (
      select row_number() over (order by l.id) as seq,
             l.id,
             app.local_ts(l.created_at, h.timezone) as created_at,
             l.actor_role,
             pr.email as actor_email,
             l.action,
             l.entity_type,
             l.entity_id,
             l.details::text as details
      from public.audit_logs l
      left join public.profiles pr on pr.id = l.actor_user_id
      where l.hospital_id = p_hospital_id and l.created_at >= v_start and l.created_at < v_end
      order by seq
      offset v_offset limit v_limit + 1
    ) x;
  end case;

  if jsonb_array_length(v_rows) > v_limit then
    v_rows := v_rows - v_limit;
    v_more := true;
  end if;
  return jsonb_build_object('rows', v_rows, 'has_more', v_more, 'timezone', h.timezone);
end;
$$;

revoke execute on function app.local_ts(timestamptz, text), app.minutes_between(timestamptz, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.admin_export(uuid, text, date, date, boolean, integer, integer)
  from public, anon;
grant execute on function public.admin_export(uuid, text, date, date, boolean, integer, integer)
  to authenticated;
