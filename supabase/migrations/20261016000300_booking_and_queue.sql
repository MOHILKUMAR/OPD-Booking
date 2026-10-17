-- MediQueue: scheduling, atomic token allocation, tracking, cancellation and queue control.
--
-- Concurrency model
--   Every operation that changes a session's tokens first locks that session's queue_states
--   row (SELECT ... FOR UPDATE), then the appointment row. One lock order everywhere means
--   no deadlocks, and token numbers are assigned while the lock is held, so two concurrent
--   bookings can never receive the same number. The unique constraint
--   appointments_token_uq (queue_state_id, token_no) is a second, independent guarantee.

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create or replace function app.hospital_now(p_hospital_id uuid)
returns timestamp
language sql
stable
security definer
set search_path = ''
as $$
  select now() at time zone h.timezone from public.hospitals h where h.id = p_hospital_id;
$$;

create or replace function app.hospital_today(p_hospital_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select app.hospital_now(p_hospital_id)::date;
$$;

-- Accepts "98765 43210", "+91-98765-43210", "098765 43210". Returns 10 digits or NULL.
create or replace function app.normalize_phone(p_phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
begin
  if length(v) = 12 and left(v, 2) = '91' then
    v := substr(v, 3);
  elsif length(v) = 11 and left(v, 1) = '0' then
    v := substr(v, 2);
  end if;
  if v !~ '^[6-9][0-9]{9}$' then
    return null;
  end if;
  return v;
end;
$$;

create or replace function app.normalize_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
$$;

create or replace function app.hash_key(p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(btrim(p_key), 'UTF8')), 'hex');
$$;

-- 128-bit secret from the server's CSPRNG (gen_random_uuid uses pg_strong_random).
create or replace function app.new_access_key()
returns text
language sql
volatile
set search_path = ''
as $$
  select left(encode(sha256(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid())), 'hex'), 32);
$$;

-- "MQ-" + 8 characters from an alphabet without 0/O/1/I (32^8 ≈ 1.1e12 values).
create or replace function app.new_booking_reference()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := uuid_send(gen_random_uuid());
  v_out text := 'MQ-';
  i integer;
begin
  -- skip bytes 6 and 8, which carry the UUID version/variant bits
  foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_out;
end;
$$;

create or replace function app.mask_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select string_agg(left(w, 1) || repeat('*', greatest(length(w) - 1, 2)), ' ')
  from unnest(string_to_array(app.normalize_name(p_name), ' ')) as w;
$$;

create or replace function app.mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select repeat('X', 6) || right(p_phone, 4);
$$;

-- ---------------------------------------------------------------------------
-- Audit and notifications
-- ---------------------------------------------------------------------------
create or replace function app.audit(
  p_hospital_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (hospital_id, actor_user_id, actor_role, action, entity_type, entity_id, details)
  values (p_hospital_id, auth.uid(), app.actor_role(), p_action, p_entity_type, p_entity_id,
          coalesce(p_details, '{}'::jsonb));
end;
$$;

-- Generic audit for configuration tables (contain no patient data).
create or replace function app.audit_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_changed jsonb;
  v_hospital uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, n.value) into v_changed
    from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from (to_jsonb(old) -> n.key) and n.key <> 'updated_at';
    if v_changed is null then
      return new;
    end if;
  end if;
  v_hospital := case when tg_table_name = 'hospitals' then (v_row ->> 'id')::uuid
                     else (v_row ->> 'hospital_id')::uuid end;
  insert into public.audit_logs (hospital_id, actor_user_id, actor_role, action, entity_type, entity_id, details)
  values (
    v_hospital, auth.uid(), app.actor_role(),
    tg_table_name || '.' || lower(tg_op), tg_table_name, v_row ->> 'id',
    case when tg_op = 'UPDATE' then jsonb_build_object('changed', v_changed)
         else jsonb_build_object('row', v_row) end
  );
  return coalesce(new, old);
end;
$$;

create trigger hospitals_audit after update on public.hospitals
  for each row execute function app.audit_config_change();
create trigger departments_audit after insert or update or delete on public.departments
  for each row execute function app.audit_config_change();
create trigger doctors_audit after insert or update or delete on public.doctors
  for each row execute function app.audit_config_change();
create trigger shifts_audit after insert or update or delete on public.shifts
  for each row execute function app.audit_config_change();
create trigger doctor_schedules_audit after insert or update or delete on public.doctor_schedules
  for each row execute function app.audit_config_change();
create trigger shift_exceptions_audit after insert or update or delete on public.shift_exceptions
  for each row execute function app.audit_config_change();
create trigger user_roles_audit after insert or delete on public.user_roles
  for each row execute function app.audit_config_change();
create trigger announcements_audit after insert or update or delete on public.hospital_announcements
  for each row execute function app.audit_config_change();

create or replace function app.notify_appointment(
  p_appt public.appointments,
  p_kind text,
  p_title text,
  p_body text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (hospital_id, recipient_user_id, appointment_id, kind, title, body)
  values (p_appt.hospital_id, p_appt.patient_user_id, p_appt.id, p_kind, p_title, p_body);
end;
$$;

-- ---------------------------------------------------------------------------
-- Session resolution: what a (shift, date) looks like after schedules and exceptions
-- ---------------------------------------------------------------------------
create type app.session_info as (
  shift_id uuid,
  doctor_id uuid,
  hospital_id uuid,
  session_date date,
  start_time time,
  end_time time,
  capacity integer,
  online_capacity integer,
  closed_reason text,
  closure_note text
);

create or replace function app.resolve_session(p_shift_id uuid, p_date date)
returns app.session_info
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.shifts%rowtype;
  r app.session_info;
  v_doctor_active boolean;
  v_modified boolean := false;
  v_scheduled boolean;
  v_start time;
  v_end time;
  v_cap integer;
  v_kind public.exception_kind;
  v_reason text;
begin
  select * into s from public.shifts where id = p_shift_id;
  if not found or p_date is null then
    return null;
  end if;
  select d.is_active into v_doctor_active from public.doctors d where d.id = s.doctor_id;

  r.shift_id := s.id;
  r.doctor_id := s.doctor_id;
  r.hospital_id := s.hospital_id;
  r.session_date := p_date;
  r.start_time := s.start_time;
  r.end_time := s.end_time;
  r.capacity := s.max_tokens;

  select e.start_time, e.end_time, e.reason into v_start, v_end, v_reason
  from public.shift_exceptions e
  where e.shift_id = s.id and e.exception_date = p_date and e.kind = 'MODIFIED_HOURS';
  if found then
    v_modified := true;
    r.start_time := v_start;
    r.end_time := v_end;
    r.closure_note := v_reason;
  end if;

  select e.max_tokens into v_cap
  from public.shift_exceptions e
  where e.shift_id = s.id and e.exception_date = p_date and e.kind = 'CAPACITY_CHANGE';
  if found then
    r.capacity := v_cap;
  end if;
  r.online_capacity := greatest(r.capacity - s.walkin_reserved, 0);

  -- A MODIFIED_HOURS exception on a non-scheduled day creates an extra session.
  v_scheduled := v_modified or exists (
    select 1 from public.doctor_schedules ds
    where ds.shift_id = s.id
      and ds.is_active
      and ds.weekday = extract(dow from p_date)::integer
      and ds.effective_from <= p_date
      and (ds.effective_to is null or ds.effective_to >= p_date)
  );

  -- hospital-wide closures win over doctor-level, which win over shift-level
  select e.kind, e.reason into v_kind, v_reason
  from public.shift_exceptions e
  where e.hospital_id = s.hospital_id
    and e.exception_date = p_date
    and e.kind in ('HOLIDAY', 'CLOSED')
    and (e.doctor_id is null or (e.doctor_id = s.doctor_id and (e.shift_id is null or e.shift_id = s.id)))
  order by (e.doctor_id is not null), (e.shift_id is not null)
  limit 1;

  if not s.is_active then
    r.closed_reason := 'SHIFT_INACTIVE';
  elsif not coalesce(v_doctor_active, false) then
    r.closed_reason := 'DOCTOR_INACTIVE';
  elsif v_kind is not null then
    r.closed_reason := v_kind::text;
    r.closure_note := v_reason;
  elsif not v_scheduled then
    r.closed_reason := 'NOT_SCHEDULED';
  end if;
  return r;
end;
$$;

-- Patient-facing explanation for a block reason code.
create or replace function app.reason_text(p_code text, p_note text default null, p_window_days integer default 1)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_code
    when 'NOT_SCHEDULED' then 'The doctor has no OPD in this shift on the selected date.'
    when 'SHIFT_INACTIVE' then 'This OPD shift is no longer offered.'
    when 'DOCTOR_INACTIVE' then 'This doctor is not currently available.'
    when 'HOSPITAL_INACTIVE' then 'Online booking is not available at the moment.'
    when 'HOLIDAY' then 'Hospital holiday' || coalesce(': ' || p_note, '.')
    when 'CLOSED' then 'OPD closed' || coalesce(': ' || p_note, '.')
    when 'PAST_SESSION' then 'This OPD session is in the past.'
    when 'SESSION_CLOSED' then 'This OPD session has ended.'
    when 'SESSION_CANCELLED' then 'This OPD session has been cancelled.'
    when 'DOCTOR_NOT_ACCEPTING' then 'The doctor is not accepting online bookings right now.'
    when 'OUTSIDE_BOOKING_WINDOW' then
      case when p_window_days = 0 then 'Online booking is open for today only.'
           else format('Online booking is open for today and the next %s day(s).', p_window_days) end
    when 'BOOKING_PAUSED' then 'Online booking is paused for this session. Please contact the reception.'
    when 'BOOKING_CLOSED_FOR_TODAY' then 'Online booking for today''s session has closed. Please visit the reception desk.'
    when 'FULL' then 'All tokens for this session have been booked.'
    when 'WALKIN_TODAY_ONLY' then 'Walk-in tokens can only be issued for today''s session.'
    else 'This session is not available for booking.'
  end;
$$;

-- Tokens that occupy capacity: everything except cancellations and expired payment holds.
create or replace function app.active_token_count(p_queue_state_id uuid, p_exclude uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.appointments a
  where a.queue_state_id = p_queue_state_id
    and a.status <> 'CANCELLED'
    and not (a.status = 'PAYMENT_PENDING' and a.hold_expires_at <= now())
    and (p_exclude is null or a.id <> p_exclude);
$$;

-- NULL when booking is allowed, otherwise a reason code.
create or replace function app.booking_block_reason(
  p_info app.session_info,
  p_status public.session_status,
  p_booking_open boolean,
  p_active integer,
  p_source public.booking_source
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h public.hospitals%rowtype;
  v_cutoff integer;
  v_accepting boolean;
  v_local timestamp;
  v_today date;
begin
  if p_info is null then
    return 'NOT_SCHEDULED';
  end if;
  if p_info.closed_reason is not null then
    return p_info.closed_reason;
  end if;
  select * into h from public.hospitals where id = p_info.hospital_id;
  if not h.is_active then
    return 'HOSPITAL_INACTIVE';
  end if;
  select s.booking_cutoff_minutes into v_cutoff from public.shifts s where s.id = p_info.shift_id;
  select d.accepting_bookings into v_accepting from public.doctors d where d.id = p_info.doctor_id;

  v_local := now() at time zone h.timezone;
  v_today := v_local::date;

  if p_info.session_date < v_today then
    return 'PAST_SESSION';
  end if;
  if p_status in ('CLOSED', 'CANCELLED') then
    return 'SESSION_' || p_status::text;
  end if;

  if p_source = 'ONLINE' then
    if not v_accepting then
      return 'DOCTOR_NOT_ACCEPTING';
    end if;
    if p_info.session_date > v_today + h.booking_window_days then
      return 'OUTSIDE_BOOKING_WINDOW';
    end if;
    if not coalesce(p_booking_open, true) then
      return 'BOOKING_PAUSED';
    end if;
    -- compare seconds since midnight to avoid time wrap-around
    if p_info.session_date = v_today
       and extract(epoch from v_local::time) >= extract(epoch from p_info.end_time) - v_cutoff * 60 then
      return 'BOOKING_CLOSED_FOR_TODAY';
    end if;
    if p_active >= p_info.online_capacity then
      return 'FULL';
    end if;
  else
    if p_info.session_date <> v_today then
      return 'WALKIN_TODAY_ONLY';
    end if;
    if p_active >= p_info.capacity then
      return 'FULL';
    end if;
  end if;
  return null;
end;
$$;

-- Creates the session row if needed and locks it. All token changes for a session are
-- serialized behind this lock.
create or replace function app.lock_queue_state(p_info app.session_info)
returns public.queue_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.queue_states%rowtype;
begin
  insert into public.queue_states (
    hospital_id, doctor_id, shift_id, session_date, start_time, end_time, capacity, online_capacity
  ) values (
    p_info.hospital_id, p_info.doctor_id, p_info.shift_id, p_info.session_date,
    p_info.start_time, p_info.end_time, p_info.capacity, p_info.online_capacity
  )
  on conflict (shift_id, session_date) do nothing;

  select * into q from public.queue_states
  where shift_id = p_info.shift_id and session_date = p_info.session_date
  for update;

  -- keep times and capacity in sync with admin edits while the session is not finished
  if q.status in ('SCHEDULED', 'OPEN', 'PAUSED')
     and (q.capacity, q.online_capacity, q.start_time, q.end_time)
         is distinct from (p_info.capacity, p_info.online_capacity, p_info.start_time, p_info.end_time) then
    update public.queue_states
       set capacity = p_info.capacity, online_capacity = p_info.online_capacity,
           start_time = p_info.start_time, end_time = p_info.end_time
     where id = q.id
    returning * into q;
  end if;
  return q;
end;
$$;

-- Recomputes derived counters from appointments (no drift) and bumps the version, which
-- is what Realtime subscribers and pollers watch.
create or replace function app.refresh_queue_state(p_queue_state_id uuid)
returns public.queue_states
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.queue_states%rowtype;
begin
  update public.queue_states qs
     set issued_count = c.active,
         waiting_count = c.waiting,
         completed_count = c.completed,
         next_token_no = c.next_token,
         version = qs.version + 1
    from (
      select
        count(*) filter (
          where a.status <> 'CANCELLED' and not (a.status = 'PAYMENT_PENDING' and a.hold_expires_at <= now())
        )::integer as active,
        count(*) filter (where a.status in ('ARRIVED', 'WAITING'))::integer as waiting,
        count(*) filter (where a.status = 'COMPLETED')::integer as completed,
        min(a.token_no) filter (where a.status in ('ARRIVED', 'WAITING')) as next_token
      from public.appointments a
      where a.queue_state_id = p_queue_state_id
    ) c
   where qs.id = p_queue_state_id
  returning qs.* into q;
  return q;
end;
$$;

-- Public, PII-free projection of a session.
create or replace function app.queue_public(q public.queue_states)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'queue_state_id', q.id,
    'doctor_id', q.doctor_id,
    'shift_id', q.shift_id,
    'session_date', q.session_date,
    'status', q.status,
    'booking_open', q.booking_open,
    'start_time', q.start_time,
    'end_time', q.end_time,
    'capacity', q.capacity,
    'online_capacity', q.online_capacity,
    'issued_count', q.issued_count,
    'waiting_count', q.waiting_count,
    'completed_count', q.completed_count,
    'current_token_no', q.current_token_no,
    'next_token_no', q.next_token_no,
    'delay_minutes', q.delay_minutes,
    'public_note', q.public_note,
    'version', q.version,
    'updated_at', q.updated_at
  );
$$;

-- ---------------------------------------------------------------------------
-- Public read API: sessions, doctor search, display board
-- ---------------------------------------------------------------------------
create or replace function public.get_sessions(
  p_hospital_id uuid,
  p_from date default null,
  p_to date default null,
  p_doctor_ids uuid[] default null
)
returns table (
  shift_id uuid,
  doctor_id uuid,
  session_date date,
  shift_name text,
  start_time time,
  end_time time,
  queue_state_id uuid,
  session_status public.session_status,
  capacity integer,
  online_capacity integer,
  issued_count integer,
  remaining_online integer,
  bookable boolean,
  unavailable_reason text,
  unavailable_message text,
  current_token_no integer,
  next_token_no integer,
  waiting_count integer,
  delay_minutes integer,
  public_note text,
  booking_fee_paise integer,
  payment_required boolean,
  avg_consult_minutes integer,
  version bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  h public.hospitals%rowtype;
  v_from date;
  v_to date;
  v_day date;
  s record;
  v_info app.session_info;
  q public.queue_states%rowtype;
  v_active integer;
  v_reason text;
  v_fee integer;
begin
  select * into h from public.hospitals hh where hh.id = p_hospital_id and hh.is_active;
  if not found then
    return;
  end if;
  v_from := coalesce(p_from, app.hospital_today(h.id));
  v_to := coalesce(p_to, v_from);
  if v_to < v_from or v_to - v_from > 14 then
    perform app.fail('MQ_INVALID_RANGE', 'Choose a date range of at most 15 days.');
  end if;
  if coalesce(array_length(p_doctor_ids, 1), 0) > 100 then
    perform app.fail('MQ_INVALID_RANGE', 'Too many doctors requested at once.');
  end if;

  for s in
    select sh.id, sh.doctor_id, sh.name, sh.booking_fee_paise, sh.avg_consult_minutes
    from public.shifts sh
    join public.doctors d on d.id = sh.doctor_id
    where sh.hospital_id = h.id
      and sh.is_active
      and d.is_active
      and (p_doctor_ids is null or sh.doctor_id = any (p_doctor_ids))
    order by d.sort_order, d.full_name, sh.start_time
  loop
    v_day := v_from;
    while v_day <= v_to loop
      v_info := app.resolve_session(s.id, v_day);
      select * into q from public.queue_states qq where qq.shift_id = s.id and qq.session_date = v_day;
      if not found then
        q := null;
      end if;

      if v_info.closed_reason = 'NOT_SCHEDULED' and q.id is null then
        v_day := v_day + 1;
        continue;
      end if;

      v_active := case when q.id is null then 0 else app.active_token_count(q.id) end;
      v_reason := app.booking_block_reason(v_info, q.status, q.booking_open, v_active, 'ONLINE');
      v_fee := coalesce(s.booking_fee_paise, h.default_booking_fee_paise);

      shift_id := s.id;
      doctor_id := s.doctor_id;
      session_date := v_day;
      shift_name := s.name;
      start_time := coalesce(q.start_time, v_info.start_time);
      end_time := coalesce(q.end_time, v_info.end_time);
      queue_state_id := q.id;
      session_status := coalesce(q.status, 'SCHEDULED'::public.session_status);
      capacity := v_info.capacity;
      online_capacity := v_info.online_capacity;
      issued_count := v_active;
      remaining_online := greatest(v_info.online_capacity - v_active, 0);
      bookable := v_reason is null;
      unavailable_reason := v_reason;
      unavailable_message := case when v_reason is null then null
                                  else app.reason_text(v_reason, v_info.closure_note, h.booking_window_days) end;
      current_token_no := q.current_token_no;
      next_token_no := q.next_token_no;
      waiting_count := coalesce(q.waiting_count, 0);
      delay_minutes := coalesce(q.delay_minutes, 0);
      public_note := coalesce(q.public_note, v_info.closure_note);
      booking_fee_paise := v_fee;
      payment_required := h.online_payments_enabled and v_fee > 0;
      avg_consult_minutes := s.avg_consult_minutes;
      version := coalesce(q.version, 0);
      return next;

      v_day := v_day + 1;
    end loop;
  end loop;
end;
$$;

-- Server-side filtered, paginated doctor directory with that day's sessions embedded.
create or replace function public.search_doctors(
  p_hospital_id uuid,
  p_search text default null,
  p_department_id uuid default null,
  p_specialty text default null,
  p_available_only boolean default false,
  p_date date default null,
  p_limit integer default 12,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, app.hospital_today(p_hospital_id));
  v_limit integer := least(greatest(coalesce(p_limit, 12), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_ids uuid[];
  v_available uuid[];
  v_total integer;
  v_items jsonb;
begin
  if v_search is not null and length(v_search) > 60 then
    perform app.fail('MQ_INVALID_SEARCH', 'Search text is too long.');
  end if;
  v_search := replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_');

  select array_agg(d.id order by d.sort_order, d.full_name) into v_ids
  from public.doctors d
  join public.departments dep on dep.id = d.department_id
  where d.hospital_id = p_hospital_id
    and d.is_active
    and (p_department_id is null or d.department_id = p_department_id)
    and (p_specialty is null or lower(d.specialty) = lower(p_specialty))
    and (v_search is null
         or d.full_name ilike '%' || v_search || '%'
         or d.specialty ilike '%' || v_search || '%'
         or dep.name ilike '%' || v_search || '%');

  if p_available_only and v_ids is not null then
    select array_agg(distinct gs.doctor_id) into v_available
    from public.get_sessions(p_hospital_id, v_date, v_date, v_ids) gs
    where gs.bookable;
    select array_agg(x order by ord) into v_ids
    from unnest(v_ids) with ordinality as t(x, ord)
    where x = any (coalesce(v_available, '{}'::uuid[]));
  end if;

  v_total := coalesce(array_length(v_ids, 1), 0);
  v_ids := v_ids[v_offset + 1 : v_offset + v_limit];

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', d.id,
             'full_name', d.full_name,
             'specialty', d.specialty,
             'qualifications', d.qualifications,
             'photo_url', d.photo_url,
             'room_no', d.room_no,
             'consultation_fee_paise', d.consultation_fee_paise,
             'accepting_bookings', d.accepting_bookings,
             'department', jsonb_build_object('id', dep.id, 'name', dep.name),
             'sessions', coalesce((
               select jsonb_agg(to_jsonb(gs) order by gs.start_time)
               from public.get_sessions(p_hospital_id, v_date, v_date, array[d.id]) gs
             ), '[]'::jsonb)
           ) order by t.ord), '[]'::jsonb)
    into v_items
  from unnest(v_ids) with ordinality as t(id, ord)
  join public.doctors d on d.id = t.id
  join public.departments dep on dep.id = d.department_id;

  return jsonb_build_object('total', v_total, 'date', v_date, 'items', v_items);
end;
$$;

-- Waiting-room TV feed. Only doctor/department, token numbers, status and announcements.
create or replace function public.get_display_board(p_hospital_id uuid, p_department_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.hospital_today(p_hospital_id);
  v_doctors uuid[];
  v_sessions jsonb;
  v_announcements jsonb;
begin
  if v_today is null then
    return null;
  end if;
  select array_agg(d.id) into v_doctors
  from public.doctors d
  where d.hospital_id = p_hospital_id and d.is_active
    and (p_department_id is null or d.department_id = p_department_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'doctor_name', d.full_name,
           'department', dep.name,
           'room_no', d.room_no,
           'shift_name', gs.shift_name,
           'start_time', gs.start_time,
           'end_time', gs.end_time,
           'status', gs.session_status,
           'current_token_no', gs.current_token_no,
           'next_token_no', gs.next_token_no,
           'waiting_count', gs.waiting_count,
           'delay_minutes', gs.delay_minutes,
           'public_note', gs.public_note,
           'version', gs.version
         ) order by dep.name, d.full_name, gs.start_time), '[]'::jsonb)
    into v_sessions
  from public.get_sessions(p_hospital_id, v_today, v_today, v_doctors) gs
  join public.doctors d on d.id = gs.doctor_id
  join public.departments dep on dep.id = d.department_id
  where gs.unavailable_reason is distinct from 'NOT_SCHEDULED';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body, 'published_at', a.published_at
         ) order by a.published_at desc), '[]'::jsonb)
    into v_announcements
  from (
    select * from public.hospital_announcements ha
    where ha.hospital_id = p_hospital_id and ha.is_published and ha.show_on_display
      and (ha.expires_at is null or ha.expires_at > now())
    order by ha.published_at desc
    limit 5
  ) a;

  return jsonb_build_object(
    'date', v_today,
    'generated_at', now(),
    'sessions', v_sessions,
    'announcements', v_announcements
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking views
-- ---------------------------------------------------------------------------
create or replace function app.booking_payload(a public.appointments, p_access_key text, p_replayed boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'appointment_id', a.id,
    'booking_reference', a.booking_reference,
    'access_key', p_access_key,
    'token_no', a.token_no,
    'status', a.status,
    'source', a.source,
    'session_date', a.session_date,
    'patient_name', a.patient_name,
    'doctor_name', d.full_name,
    'department', dep.name,
    'room_no', d.room_no,
    'shift_name', s.name,
    'start_time', q.start_time,
    'end_time', q.end_time,
    'fee_paise', a.fee_paise,
    'payment_mode', a.payment_mode,
    'hold_expires_at', a.hold_expires_at,
    'queue_state_id', a.queue_state_id,
    'replayed', p_replayed
  )
  from public.doctors d, public.departments dep, public.shifts s, public.queue_states q
  where d.id = a.doctor_id and dep.id = d.department_id and s.id = a.shift_id and q.id = a.queue_state_id;
$$;

-- NULL when the patient may cancel online, otherwise a patient-safe explanation.
create or replace function app.patient_cancel_block(a public.appointments)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.queue_states%rowtype;
  h public.hospitals%rowtype;
begin
  select * into q from public.queue_states where id = a.queue_state_id;
  select * into h from public.hospitals where id = a.hospital_id;
  if a.status not in ('BOOKED', 'CONFIRMED', 'PAYMENT_PENDING') then
    return case a.status
      when 'CANCELLED' then 'This booking is already cancelled.'
      when 'COMPLETED' then 'This consultation is already completed.'
      else 'This token can no longer be cancelled online. Please contact the reception desk.'
    end;
  end if;
  if q.status in ('CLOSED', 'CANCELLED') then
    return 'This OPD session has ended.';
  end if;
  if a.status <> 'PAYMENT_PENDING'
     and (now() at time zone h.timezone)
         > (a.session_date + q.start_time) - make_interval(mins => h.cancel_cutoff_minutes) then
    return format('Online cancellation closes %s minutes before the OPD starts. Please contact the reception desk.',
                  h.cancel_cutoff_minutes);
  end if;
  return null;
end;
$$;

-- Everything a booking holder may see. Patient name and phone are masked because tracking
-- links get forwarded.
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

  select coalesce(jsonb_agg(jsonb_build_object('kind', n.kind, 'title', n.title, 'body', n.body, 'created_at', n.created_at)
                  order by n.created_at desc), '[]'::jsonb)
    into v_notes
  from (select * from public.notifications nn where nn.appointment_id = a.id order by nn.created_at desc limit 5) n;

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
-- Core allocation. Called by book_token, create_walkin_token and the payment service.
-- ---------------------------------------------------------------------------
create or replace function app.create_appointment(
  p_shift_id uuid,
  p_session_date date,
  p_patient_name text,
  p_patient_phone text,
  p_patient_age integer,
  p_source public.booking_source,
  p_patient_user_id uuid,
  p_created_by uuid,
  p_client_request_id uuid,
  p_payment_hold boolean,
  p_mark_arrived boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.hospitals%rowtype;
  s public.shifts%rowtype;
  d public.doctors%rowtype;
  q public.queue_states%rowtype;
  a public.appointments%rowtype;
  v_info app.session_info;
  v_requester uuid := coalesce(p_patient_user_id, p_created_by);
  v_name text := app.normalize_name(p_patient_name);
  v_phone text := app.normalize_phone(p_patient_phone);
  v_identity text;
  v_fee integer;
  v_mode public.payment_mode;
  v_status public.appointment_status;
  v_token integer;
  v_reason text;
  v_key text;
  v_constraint text;
  v_attempt integer := 0;
  v_ip text := app.client_ip();
begin
  -- 1. Idempotent replay (fast path, before any locking)
  if p_client_request_id is not null and v_requester is not null then
    select * into a from public.appointments x
    where coalesce(x.patient_user_id, x.created_by) = v_requester and x.client_request_id = p_client_request_id;
    if found then
      v_key := app.new_access_key();
      update public.appointments set access_key_hash = app.hash_key(v_key) where id = a.id returning * into a;
      return app.booking_payload(a, v_key, true);
    end if;
  end if;

  -- 2. Input validation (the browser validates too, but is never trusted)
  if length(v_name) < 2 or length(v_name) > 80 or v_name ~ '[0-9<>{}\[\]\\/@#$%^*=+|~"`;:]' or v_name ~ '[[:cntrl:]]' then
    perform app.fail('MQ_INVALID_NAME', 'Enter the patient''s name using letters (2 to 80 characters).');
  end if;
  if v_phone is null then
    perform app.fail('MQ_INVALID_PHONE', 'Enter a valid 10-digit Indian mobile number.');
  end if;
  if p_patient_age is not null and (p_patient_age < 0 or p_patient_age > 120) then
    perform app.fail('MQ_INVALID_AGE', 'Enter an age between 0 and 120.');
  end if;
  if p_session_date is null then
    perform app.fail('MQ_INVALID_DATE', 'Choose a booking date.');
  end if;

  -- 3. Doctor and shift exist
  select * into s from public.shifts where id = p_shift_id;
  if not found then
    perform app.fail('MQ_SHIFT_NOT_FOUND', 'This OPD shift does not exist.');
  end if;
  select * into d from public.doctors where id = s.doctor_id;
  select * into h from public.hospitals where id = s.hospital_id;
  if p_source = 'ONLINE' and h.require_patient_age and p_patient_age is null then
    perform app.fail('MQ_AGE_REQUIRED', 'Patient age is required.');
  end if;

  -- 4. Session valid, open, not past, within the booking window
  v_info := app.resolve_session(p_shift_id, p_session_date);
  v_reason := app.booking_block_reason(v_info, null, null, 0, p_source);
  if v_reason is not null then
    perform app.fail('MQ_SESSION_UNAVAILABLE',
                     app.reason_text(v_reason, v_info.closure_note, h.booking_window_days), v_reason);
  end if;

  -- 5. Price and payment mode are decided here, never by the client
  v_fee := coalesce(s.booking_fee_paise, h.default_booking_fee_paise);
  if v_fee = 0 then
    v_mode := 'FREE';
  elsif p_source = 'ONLINE' and h.online_payments_enabled then
    v_mode := 'ONLINE';
  else
    v_mode := 'PAY_AT_HOSPITAL';
  end if;
  if v_mode = 'ONLINE' and not p_payment_hold then
    perform app.fail('MQ_PAYMENT_REQUIRED', 'Online payment is required to book this session.');
  end if;
  if p_payment_hold and v_mode <> 'ONLINE' then
    perform app.fail('MQ_PAYMENT_NOT_REQUIRED', 'This session does not take online payment.');
  end if;

  v_identity := case h.duplicate_policy
                  when 'PHONE_AND_NAME' then v_phone || '|' || lower(v_name)
                  else v_phone
                end;

  -- 6. Abuse limits for public bookings (only successful bookings count)
  if p_source = 'ONLINE' then
    if p_patient_user_id is not null then
      perform app.hit_rate_limit('book:user:' || p_patient_user_id::text, app.config_int('rate.book_per_user_hour', 10), 3600);
    end if;
    if v_ip is not null then
      perform app.hit_rate_limit('book:ip:' || v_ip, app.config_int('rate.book_per_ip_hour', 60), 3600);
    end if;
    if (select count(*) from public.appointments x
        where x.hospital_id = h.id and x.patient_phone = v_phone and x.session_date = p_session_date
          and x.source = 'ONLINE' and x.status <> 'CANCELLED') >= h.max_bookings_per_phone_per_day then
      perform app.fail('MQ_PHONE_DAILY_LIMIT',
        format('This mobile number already has %s bookings on this date.', h.max_bookings_per_phone_per_day));
    end if;
  end if;

  -- 7. Serialize everything that follows for this session
  q := app.lock_queue_state(v_info);

  -- replay check again under the lock (handles a concurrent double submit)
  if p_client_request_id is not null and v_requester is not null then
    select * into a from public.appointments x
    where coalesce(x.patient_user_id, x.created_by) = v_requester and x.client_request_id = p_client_request_id;
    if found then
      v_key := app.new_access_key();
      update public.appointments set access_key_hash = app.hash_key(v_key) where id = a.id returning * into a;
      return app.booking_payload(a, v_key, true);
    end if;
  end if;

  -- an expired, unpaid hold by the same patient must not block a fresh booking
  update public.appointments x
     set status = 'CANCELLED', cancel_reason = 'Payment window expired', cancelled_at = now(),
         version = x.version + 1
   where x.queue_state_id = q.id
     and x.booking_identity_key = v_identity
     and x.status = 'PAYMENT_PENDING'
     and x.hold_expires_at <= now()
     and not exists (
       select 1 from public.payments p
       where p.appointment_id = x.id and p.status in ('AUTHORIZED', 'CAPTURED')
     );

  -- 8. Duplicate-booking policy
  if exists (
    select 1 from public.appointments x
    where x.queue_state_id = q.id
      and x.booking_identity_key = v_identity
      and x.status in ('BOOKED', 'PAYMENT_PENDING', 'CONFIRMED', 'ARRIVED', 'WAITING', 'CALLED',
                       'IN_CONSULTATION', 'SKIPPED')
  ) then
    perform app.fail('MQ_DUPLICATE_BOOKING',
      'This mobile number already has an active token for this doctor and shift. Use Track Token to view it.');
  end if;

  -- 9. Session state and capacity, re-checked under the lock
  v_reason := app.booking_block_reason(v_info, q.status, q.booking_open, app.active_token_count(q.id), p_source);
  if v_reason is not null then
    perform app.fail('MQ_SESSION_UNAVAILABLE',
                     app.reason_text(v_reason, v_info.closure_note, h.booking_window_days), v_reason);
  end if;

  -- 10. Token number: allocated only inside the lock; payment holds get theirs on confirmation
  if p_payment_hold then
    v_status := 'PAYMENT_PENDING';
    v_token := null;
  else
    v_token := q.last_token_no + 1;
    update public.queue_states set last_token_no = v_token where id = q.id;
    v_status := case when p_source = 'WALK_IN' and p_mark_arrived then 'ARRIVED'::public.appointment_status
                     else 'CONFIRMED'::public.appointment_status end;
  end if;

  v_key := app.new_access_key();
  loop
    begin
      insert into public.appointments (
        hospital_id, queue_state_id, doctor_id, shift_id, session_date, token_no,
        booking_reference, access_key_hash, patient_user_id, patient_name, patient_phone, patient_age,
        booking_identity_key, source, status, payment_mode, fee_paise, hold_expires_at,
        client_request_id, created_by, arrived_at
      ) values (
        h.id, q.id, s.doctor_id, s.id, p_session_date, v_token,
        app.new_booking_reference(), app.hash_key(v_key), p_patient_user_id, v_name, v_phone, p_patient_age,
        v_identity, p_source, v_status, v_mode, v_fee,
        case when p_payment_hold then now() + make_interval(mins => h.payment_hold_minutes) end,
        p_client_request_id, p_created_by,
        case when v_status = 'ARRIVED' then now() end
      )
      returning * into a;
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'appointments_booking_reference_key' and v_attempt < 5 then
        v_attempt := v_attempt + 1; -- reference collision: retry with a new one
      elsif v_constraint = 'appointments_active_identity_uq' then
        perform app.fail('MQ_DUPLICATE_BOOKING',
          'This mobile number already has an active token for this doctor and shift. Use Track Token to view it.');
      else
        raise;
      end if;
    end;
  end loop;

  q := app.refresh_queue_state(q.id);

  perform app.audit(h.id,
    case when p_source = 'WALK_IN' then 'appointment.walkin_created'
         when p_payment_hold then 'appointment.payment_hold_created'
         else 'appointment.booked' end,
    'appointment', a.id::text,
    jsonb_build_object('reference', a.booking_reference, 'token_no', a.token_no, 'status', a.status,
                       'queue_state_id', q.id, 'source', a.source, 'payment_mode', a.payment_mode,
                       'fee_paise', a.fee_paise, 'patient_user_id', p_patient_user_id));

  if not p_payment_hold then
    perform app.notify_appointment(a, 'BOOKED', format('Token %s confirmed', a.token_no),
      format('Token %s with %s on %s (%s).', a.token_no, d.full_name, to_char(a.session_date, 'DD Mon YYYY'), s.name));
  end if;

  return app.booking_payload(a, v_key, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Patient API
-- ---------------------------------------------------------------------------

-- Free or pay-at-hospital booking. Requires a Supabase session (anonymous sign-in is
-- enough) so bookings are tied to a device/account and can be rate limited.
create or replace function public.book_token(
  p_shift_id uuid,
  p_session_date date,
  p_patient_name text,
  p_patient_phone text,
  p_patient_age integer default null,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    perform app.fail('MQ_AUTH_REQUIRED', 'Your session has expired. Refresh the page and try again.');
  end if;
  return app.create_appointment(
    p_shift_id, p_session_date, p_patient_name, p_patient_phone, p_patient_age,
    'ONLINE', auth.uid(), null, p_client_request_id, false, false
  );
end;
$$;

-- Track a booking with its reference and secret key (or as its owner). Returns NULL rather
-- than an error for unknown/unauthorized lookups so failed guesses still count toward the
-- rate limit and existence is not revealed.
create or replace function public.get_booking(p_booking_reference text, p_access_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.appointments%rowtype;
  v_ref text := upper(btrim(coalesce(p_booking_reference, '')));
  v_ip text := app.client_ip();
begin
  if v_ip is not null then
    perform app.hit_rate_limit('lookup:ip:' || v_ip, app.config_int('rate.lookup_per_ip_10min', 120), 600);
  end if;
  perform app.hit_rate_limit('lookup:ref:' || left(v_ref, 20), app.config_int('rate.lookup_per_ref_10min', 60), 600);

  select * into a from public.appointments where booking_reference = v_ref;
  if not found then
    return null;
  end if;
  if not (
    (auth.uid() is not null and a.patient_user_id = auth.uid())
    or (nullif(btrim(coalesce(p_access_key, '')), '') is not null and a.access_key_hash = app.hash_key(p_access_key))
  ) then
    return null;
  end if;
  return app.booking_view(a);
end;
$$;

create or replace function public.get_my_appointments(p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(app.booking_view(a) order by a.session_date desc, a.created_at desc)
    from (
      select * from public.appointments x
      where x.patient_user_id = auth.uid()
      order by x.session_date desc, x.created_at desc
      limit least(greatest(coalesce(p_limit, 20), 1), 50)
      offset greatest(coalesce(p_offset, 0), 0)
    ) a
  ), '[]'::jsonb);
end;
$$;

-- Owner can issue a fresh tracking link (invalidates the previous one).
create or replace function public.rotate_access_key(p_booking_reference text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := app.new_access_key();
  v_id uuid;
begin
  update public.appointments
     set access_key_hash = app.hash_key(v_key)
   where booking_reference = upper(btrim(p_booking_reference))
     and patient_user_id = auth.uid()
     and auth.uid() is not null
  returning id into v_id;
  if v_id is null then
    perform app.fail('MQ_NOT_FOUND', 'Booking not found.');
  end if;
  return jsonb_build_object('booking_reference', upper(btrim(p_booking_reference)), 'access_key', v_key);
end;
$$;

-- Creates a refund request (not a refund) when the appointment has a captured payment.
create or replace function app.request_refund_if_paid(a public.appointments, p_reason text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments%rowtype;
  v_id uuid;
begin
  select * into p from public.payments where appointment_id = a.id and status = 'CAPTURED' for update;
  if not found then
    return null;
  end if;
  insert into public.refunds (hospital_id, payment_id, appointment_id, amount_paise, status, reason, requested_by)
  values (a.hospital_id, p.id, a.id, p.amount_paise, 'REQUESTED', left(p_reason, 300), p_actor)
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    perform app.audit(a.hospital_id, 'refund.requested', 'refund', v_id::text,
      jsonb_build_object('appointment_id', a.id, 'payment_id', p.id, 'amount_paise', p.amount_paise));
  end if;
  return v_id;
end;
$$;

create or replace function public.cancel_booking(
  p_booking_reference text,
  p_access_key text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.appointments%rowtype;
  q public.queue_states%rowtype;
  v_ref text := upper(btrim(coalesce(p_booking_reference, '')));
  v_block text;
  v_refund uuid;
  v_ip text := app.client_ip();
begin
  if v_ip is not null then
    perform app.hit_rate_limit('cancel:ip:' || v_ip, app.config_int('rate.cancel_per_ip_10min', 30), 600);
  end if;
  select * into a from public.appointments where booking_reference = v_ref;
  if not found or not (
    (auth.uid() is not null and a.patient_user_id = auth.uid())
    or (nullif(btrim(coalesce(p_access_key, '')), '') is not null and a.access_key_hash = app.hash_key(p_access_key))
  ) then
    perform app.fail('MQ_NOT_FOUND', 'Booking not found. Check the booking reference and link.');
  end if;

  -- lock order: session, then appointment
  select * into q from public.queue_states where id = a.queue_state_id for update;
  select * into a from public.appointments where id = a.id for update;

  v_block := app.patient_cancel_block(a);
  if v_block is not null then
    perform app.fail('MQ_CANNOT_CANCEL', v_block);
  end if;

  update public.appointments
     set status = 'CANCELLED',
         cancel_reason = coalesce(left(nullif(btrim(p_reason), ''), 300), 'Cancelled by patient'),
         cancelled_by = auth.uid(),
         cancelled_at = now(),
         version = version + 1
   where id = a.id
  returning * into a;

  v_refund := app.request_refund_if_paid(a, 'Patient cancellation', auth.uid());
  perform app.refresh_queue_state(q.id);
  perform app.audit(a.hospital_id, 'appointment.cancelled', 'appointment', a.id::text,
    jsonb_build_object('by', 'patient', 'reference', a.booking_reference, 'token_no', a.token_no,
                       'reason', a.cancel_reason, 'refund_requested', v_refund is not null));
  perform app.notify_appointment(a, 'CANCELLED', 'Booking cancelled',
    case when v_refund is not null
      then 'Your booking was cancelled. A refund request has been recorded; its status will update once the payment provider confirms it.'
      else 'Your booking was cancelled.' end);

  return jsonb_build_object('booking_reference', a.booking_reference, 'status', a.status,
                            'refund_requested', v_refund is not null);
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications
     set read_at = now()
   where id = any (p_ids) and recipient_user_id = auth.uid() and auth.uid() is not null and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Staff API: walk-ins, queue actions, session control
-- ---------------------------------------------------------------------------
create or replace function public.create_walkin_token(
  p_shift_id uuid,
  p_patient_name text,
  p_patient_phone text,
  p_patient_age integer default null,
  p_mark_arrived boolean default true,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts%rowtype;
begin
  select * into s from public.shifts where id = p_shift_id;
  if not found then
    perform app.fail('MQ_SHIFT_NOT_FOUND', 'This OPD shift does not exist.');
  end if;
  perform app.require_doctor_permission(s.doctor_id, 'WALK_IN');
  return app.create_appointment(
    p_shift_id, app.hospital_today(s.hospital_id), p_patient_name, p_patient_phone, p_patient_age,
    'WALK_IN', null, auth.uid(), p_client_request_id, false, coalesce(p_mark_arrived, true)
  );
end;
$$;

-- Allowed status transitions (mirrored in src/lib/queue-transitions.ts and tested to match).
create or replace function public.is_transition_allowed(
  p_from public.appointment_status,
  p_to public.appointment_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'BOOKED' then p_to in ('CONFIRMED', 'CANCELLED')
    when 'PAYMENT_PENDING' then p_to in ('CONFIRMED', 'CANCELLED')
    when 'CONFIRMED' then p_to in ('ARRIVED', 'CANCELLED', 'NO_SHOW')
    when 'ARRIVED' then p_to in ('WAITING', 'CALLED', 'SKIPPED', 'CANCELLED')
    when 'WAITING' then p_to in ('CALLED', 'SKIPPED', 'CANCELLED')
    when 'CALLED' then p_to in ('IN_CONSULTATION', 'SKIPPED')
    when 'IN_CONSULTATION' then p_to in ('COMPLETED')
    when 'SKIPPED' then p_to in ('WAITING', 'NO_SHOW', 'CANCELLED')
    else false -- COMPLETED, CANCELLED and NO_SHOW are terminal
  end;
$$;

-- Applies one validated transition. Caller must hold the session lock.
create or replace function app.apply_transition(
  a public.appointments,
  p_target public.appointment_status,
  p_reason text,
  p_action text,
  p_role text
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.appointment_status := a.status;
  v_doctor text;
  v_room text;
  v_refund uuid;
begin
  if not public.is_transition_allowed(a.status, p_target) then
    perform app.fail('MQ_INVALID_TRANSITION',
      format('A %s token cannot be changed to %s.', a.status, p_target));
  end if;

  update public.appointments
     set status = p_target,
         version = version + 1,
         arrived_at = case when p_target = 'ARRIVED' then now() else arrived_at end,
         called_at = case when p_target = 'CALLED' then now() else called_at end,
         consultation_started_at = case when p_target = 'IN_CONSULTATION' then now() else consultation_started_at end,
         completed_at = case when p_target = 'COMPLETED' then now() else completed_at end,
         skipped_at = case when p_target = 'SKIPPED' then now() else skipped_at end,
         skip_count = skip_count + case when p_target = 'SKIPPED' then 1 else 0 end,
         cancel_reason = case when p_target = 'CANCELLED' then left(p_reason, 300) else cancel_reason end,
         cancelled_by = case when p_target = 'CANCELLED' then auth.uid() else cancelled_by end,
         cancelled_at = case when p_target = 'CANCELLED' then now() else cancelled_at end
   where id = a.id
  returning * into a;

  if p_target = 'CALLED' then
    update public.queue_states set current_token_no = a.token_no where id = a.queue_state_id;
  end if;
  if p_target = 'CANCELLED' then
    v_refund := app.request_refund_if_paid(a, 'Cancelled by hospital: ' || coalesce(p_reason, ''), auth.uid());
  end if;

  perform app.audit(a.hospital_id, 'queue.' || lower(p_action), 'appointment', a.id::text,
    jsonb_build_object('from', v_from, 'to', p_target, 'token_no', a.token_no, 'role', p_role,
                       'queue_state_id', a.queue_state_id, 'reason', p_reason,
                       'refund_requested', v_refund is not null));

  select d.full_name, d.room_no into v_doctor, v_room from public.doctors d where d.id = a.doctor_id;
  if p_target = 'CALLED' then
    perform app.notify_appointment(a, 'CALLED', format('Token %s: it is your turn', a.token_no),
      format('Please proceed to %s%s.', v_doctor, coalesce(' (Room ' || v_room || ')', '')));
  elsif p_target = 'SKIPPED' then
    perform app.notify_appointment(a, 'SKIPPED', format('Token %s was skipped', a.token_no),
      'You were not present when called. Please contact the reception desk to be recalled.');
  elsif p_target = 'CANCELLED' then
    perform app.notify_appointment(a, 'CANCELLED', 'Booking cancelled by the hospital',
      coalesce(p_reason, 'Please contact the reception desk.'));
  end if;
  return a;
end;
$$;

create or replace function public.queue_update_status(
  p_appointment_id uuid,
  p_action text,
  p_reason text default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.appointments%rowtype;
  q public.queue_states%rowtype;
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_target public.appointment_status;
  v_role text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_target := case v_action
    when 'ARRIVE' then 'ARRIVED'
    when 'CALL' then 'CALLED'
    when 'START' then 'IN_CONSULTATION'
    when 'COMPLETE' then 'COMPLETED'
    when 'SKIP' then 'SKIPPED'
    when 'RECALL' then 'WAITING'
    when 'NO_SHOW' then 'NO_SHOW'
    when 'CANCEL' then 'CANCELLED'
  end;
  if v_target is null then
    perform app.fail('MQ_INVALID_ACTION', 'Unknown queue action.');
  end if;

  select * into a from public.appointments where id = p_appointment_id;
  if not found then
    perform app.fail('MQ_NOT_FOUND', 'Token not found.');
  end if;
  v_role := app.require_doctor_permission(a.doctor_id, v_action);

  -- lock order: session, then appointment
  select * into q from public.queue_states where id = a.queue_state_id for update;
  select * into a from public.appointments where id = p_appointment_id for update;

  if p_expected_version is not null and a.version <> p_expected_version then
    perform app.fail('MQ_STALE', 'This token was just updated by someone else. The queue has been refreshed.');
  end if;
  if v_target = 'CANCELLED' and v_reason is null then
    perform app.fail('MQ_REASON_REQUIRED', 'Enter a reason for cancelling this token.');
  end if;
  if v_target in ('ARRIVED', 'WAITING', 'CALLED', 'IN_CONSULTATION', 'COMPLETED', 'SKIPPED')
     and a.session_date <> app.hospital_today(a.hospital_id) then
    perform app.fail('MQ_NOT_TODAY', 'Queue actions are only available for today''s sessions.');
  end if;
  if q.status in ('CLOSED', 'CANCELLED') and v_target not in ('NO_SHOW', 'CANCELLED') then
    perform app.fail('MQ_SESSION_ENDED', 'This OPD session has ended.');
  end if;
  if v_target in ('CALLED', 'IN_CONSULTATION', 'COMPLETED') and q.status <> 'OPEN' then
    perform app.fail('MQ_SESSION_NOT_OPEN', 'Start (or resume) the OPD session first.');
  end if;
  if v_target = 'CALLED' and exists (
    select 1 from public.appointments x where x.queue_state_id = q.id and x.status = 'CALLED' and x.id <> a.id
  ) then
    perform app.fail('MQ_ALREADY_CALLED', 'Another patient is already called. Start their consultation or skip them first.');
  end if;
  if v_target = 'IN_CONSULTATION' and exists (
    select 1 from public.appointments x where x.queue_state_id = q.id and x.status = 'IN_CONSULTATION' and x.id <> a.id
  ) then
    perform app.fail('MQ_CONSULTATION_IN_PROGRESS', 'Complete the current consultation first.');
  end if;

  a := app.apply_transition(a, v_target, v_reason, v_action, v_role);
  q := app.refresh_queue_state(q.id);
  return jsonb_build_object('appointment_id', a.id, 'status', a.status, 'version', a.version,
                            'token_no', a.token_no, 'queue', app.queue_public(q));
end;
$$;

-- Calls the lowest checked-in token. Concurrent "call next" clicks from two desks are
-- serialized by the session lock; the second one sees the first patient already CALLED.
create or replace function public.queue_call_next(p_queue_state_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q public.queue_states%rowtype;
  a public.appointments%rowtype;
  v_role text;
begin
  select * into q from public.queue_states where id = p_queue_state_id;
  if not found then
    perform app.fail('MQ_NOT_FOUND', 'Session not found.');
  end if;
  v_role := app.require_doctor_permission(q.doctor_id, 'CALL_NEXT');

  select * into q from public.queue_states where id = p_queue_state_id for update;
  if q.session_date <> app.hospital_today(q.hospital_id) then
    perform app.fail('MQ_NOT_TODAY', 'Queue actions are only available for today''s sessions.');
  end if;
  if q.status <> 'OPEN' then
    perform app.fail('MQ_SESSION_NOT_OPEN', 'Start (or resume) the OPD session first.');
  end if;
  if exists (select 1 from public.appointments x where x.queue_state_id = q.id and x.status = 'CALLED') then
    perform app.fail('MQ_ALREADY_CALLED', 'Another patient is already called. Start their consultation or skip them first.');
  end if;

  select * into a from public.appointments x
  where x.queue_state_id = q.id and x.status in ('ARRIVED', 'WAITING')
  order by x.token_no
  limit 1
  for update;
  if not found then
    perform app.fail('MQ_QUEUE_EMPTY', 'No checked-in patients are waiting.');
  end if;

  a := app.apply_transition(a, 'CALLED', null, 'CALL_NEXT', v_role);
  q := app.refresh_queue_state(q.id);
  return jsonb_build_object('appointment_id', a.id, 'status', a.status, 'version', a.version,
                            'token_no', a.token_no, 'queue', app.queue_public(q));
end;
$$;

create or replace function public.session_control(
  p_shift_id uuid,
  p_session_date date,
  p_action text,
  p_note text default null,
  p_delay_minutes integer default null,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.shifts%rowtype;
  q public.queue_states%rowtype;
  a public.appointments%rowtype;
  v_info app.session_info;
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_role text;
  v_today date;
  v_from public.session_status;
  v_count integer := 0;
begin
  if v_action not in ('OPEN', 'PAUSE', 'RESUME', 'CLOSE', 'CANCEL', 'BOOKING_OPEN', 'BOOKING_CLOSE', 'SET_DELAY') then
    perform app.fail('MQ_INVALID_ACTION', 'Unknown session action.');
  end if;
  select * into s from public.shifts where id = p_shift_id;
  if not found then
    perform app.fail('MQ_SHIFT_NOT_FOUND', 'This OPD shift does not exist.');
  end if;
  -- CANCEL / BOOKING_OPEN / BOOKING_CLOSE are not in any non-admin list, so they are admin-only.
  v_role := app.require_doctor_permission(s.doctor_id, v_action);
  v_today := app.hospital_today(s.hospital_id);

  if p_session_date is null or p_session_date < v_today then
    perform app.fail('MQ_PAST_SESSION', 'Past sessions cannot be changed.');
  end if;
  if v_action in ('OPEN', 'PAUSE', 'RESUME', 'CLOSE') and p_session_date <> v_today then
    perform app.fail('MQ_NOT_TODAY', 'Only today''s session can be started, paused or closed.');
  end if;

  select * into q from public.queue_states where shift_id = p_shift_id and session_date = p_session_date for update;
  if not found then
    v_info := app.resolve_session(p_shift_id, p_session_date);
    if v_info.closed_reason is not null then
      perform app.fail('MQ_SESSION_UNAVAILABLE', app.reason_text(v_info.closed_reason, v_info.closure_note), v_info.closed_reason);
    end if;
    q := app.lock_queue_state(v_info);
  end if;
  v_from := q.status;

  if q.status = 'CANCELLED' then
    perform app.fail('MQ_SESSION_ENDED', 'This session was cancelled.');
  end if;

  case v_action
    when 'OPEN' then
      if q.status = 'CLOSED' and v_role <> 'admin' then
        perform app.fail('MQ_FORBIDDEN', 'Only an administrator can reopen a closed session.');
      end if;
      if q.status = 'OPEN' then
        perform app.fail('MQ_INVALID_TRANSITION', 'The session is already open.');
      end if;
      update public.queue_states
         set status = 'OPEN', started_at = coalesce(started_at, now()), ended_at = null
       where id = q.id;
    when 'PAUSE' then
      if q.status <> 'OPEN' then
        perform app.fail('MQ_INVALID_TRANSITION', 'Only an open session can be paused.');
      end if;
      update public.queue_states set status = 'PAUSED' where id = q.id;
    when 'RESUME' then
      if q.status <> 'PAUSED' then
        perform app.fail('MQ_INVALID_TRANSITION', 'Only a paused session can be resumed.');
      end if;
      update public.queue_states set status = 'OPEN' where id = q.id;
    when 'CLOSE' then
      if q.status = 'CLOSED' then
        perform app.fail('MQ_INVALID_TRANSITION', 'The session is already closed.');
      end if;
      if not p_force and exists (
        select 1 from public.appointments x
        where x.queue_state_id = q.id and x.status in ('ARRIVED', 'WAITING', 'CALLED', 'IN_CONSULTATION')
      ) then
        perform app.fail('MQ_PATIENTS_WAITING',
          'Patients are still checked in or in consultation. Finish them first, or confirm closing anyway.');
      end if;
      -- Consultation in progress is completed; checked-in but unseen patients are cancelled
      -- by the hospital (refund requested if paid); patients who never arrived are no-shows.
      for a in select * from public.appointments x where x.queue_state_id = q.id and x.status = 'IN_CONSULTATION' for update loop
        perform app.apply_transition(a, 'COMPLETED', null, 'CLOSE_SESSION', v_role);
        v_count := v_count + 1;
      end loop;
      -- called but not yet seen: present, so cancelled by the hospital rather than a no-show
      for a in select * from public.appointments x where x.queue_state_id = q.id and x.status = 'CALLED' for update loop
        a := app.apply_transition(a, 'SKIPPED', null, 'CLOSE_SESSION', v_role);
        perform app.apply_transition(a, 'CANCELLED', coalesce(v_note, 'OPD closed before consultation'), 'CLOSE_SESSION', v_role);
        v_count := v_count + 1;
      end loop;
      for a in select * from public.appointments x
               where x.queue_state_id = q.id and x.status in ('ARRIVED', 'WAITING', 'SKIPPED') for update loop
        if a.status = 'SKIPPED' then
          perform app.apply_transition(a, 'NO_SHOW', null, 'CLOSE_SESSION', v_role);
        else
          perform app.apply_transition(a, 'CANCELLED', coalesce(v_note, 'OPD closed before consultation'), 'CLOSE_SESSION', v_role);
        end if;
        v_count := v_count + 1;
      end loop;
      for a in select * from public.appointments x where x.queue_state_id = q.id and x.status in ('CONFIRMED', 'BOOKED') for update loop
        if a.status = 'CONFIRMED' then
          perform app.apply_transition(a, 'NO_SHOW', null, 'CLOSE_SESSION', v_role);
        else
          perform app.apply_transition(a, 'CANCELLED', 'OPD closed', 'CLOSE_SESSION', v_role);
        end if;
        v_count := v_count + 1;
      end loop;
      update public.appointments x
         set status = 'CANCELLED', cancel_reason = 'OPD closed before payment completed', cancelled_at = now(),
             version = x.version + 1
       where x.queue_state_id = q.id and x.status = 'PAYMENT_PENDING';
      update public.queue_states
         set status = 'CLOSED', booking_open = false, ended_at = now()
       where id = q.id;
    when 'CANCEL' then
      if v_note is null then
        perform app.fail('MQ_REASON_REQUIRED', 'Enter the reason shown to patients.');
      end if;
      if exists (select 1 from public.appointments x where x.queue_state_id = q.id and x.status = 'IN_CONSULTATION') then
        perform app.fail('MQ_PATIENTS_WAITING', 'A consultation is in progress. Complete it before cancelling the session.');
      end if;
      for a in select * from public.appointments x
               where x.queue_state_id = q.id
                 and x.status in ('BOOKED', 'CONFIRMED', 'ARRIVED', 'WAITING', 'CALLED', 'SKIPPED')
               for update loop
        if a.status = 'CALLED' then
          a := app.apply_transition(a, 'SKIPPED', null, 'CANCEL_SESSION', v_role);
        end if;
        perform app.apply_transition(a, 'CANCELLED', 'OPD cancelled: ' || v_note, 'CANCEL_SESSION', v_role);
        v_count := v_count + 1;
      end loop;
      update public.appointments x
         set status = 'CANCELLED', cancel_reason = 'OPD cancelled: ' || v_note, cancelled_at = now(),
             version = x.version + 1
       where x.queue_state_id = q.id and x.status = 'PAYMENT_PENDING';
      update public.queue_states
         set status = 'CANCELLED', booking_open = false, ended_at = now(), public_note = left(v_note, 200)
       where id = q.id;
    when 'BOOKING_OPEN' then
      update public.queue_states set booking_open = true where id = q.id;
    when 'BOOKING_CLOSE' then
      update public.queue_states set booking_open = false where id = q.id;
    when 'SET_DELAY' then
      if p_delay_minutes is null or p_delay_minutes < 0 or p_delay_minutes > 600 then
        perform app.fail('MQ_INVALID_DELAY', 'Delay must be between 0 and 600 minutes.');
      end if;
      update public.queue_states
         set delay_minutes = p_delay_minutes, public_note = left(v_note, 200)
       where id = q.id;
  end case;

  q := app.refresh_queue_state(q.id);
  perform app.audit(q.hospital_id, 'session.' || lower(v_action), 'queue_state', q.id::text,
    jsonb_build_object('from', v_from, 'to', q.status, 'role', v_role, 'session_date', q.session_date,
                       'shift_id', q.shift_id, 'note', v_note, 'delay_minutes', p_delay_minutes,
                       'affected_tokens', v_count, 'forced', p_force));
  return app.queue_public(q);
end;
$$;

-- Operational statistics for one session (staff with access to the doctor).
create or replace function public.queue_stats(p_queue_state_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q public.queue_states%rowtype;
  v_counts jsonb;
  v_avg_consult numeric;
  v_avg_wait numeric;
begin
  select * into q from public.queue_states where id = p_queue_state_id;
  if not found or not app.can_access_doctor(q.doctor_id) then
    perform app.fail('MQ_FORBIDDEN', 'You do not have access to this queue.');
  end if;
  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_counts
  from (select a.status, count(*) as n from public.appointments a where a.queue_state_id = q.id group by a.status) c;
  select round(avg(extract(epoch from (a.completed_at - a.consultation_started_at)) / 60)::numeric, 1)
    into v_avg_consult
  from public.appointments a
  where a.queue_state_id = q.id and a.completed_at is not null and a.consultation_started_at is not null;
  select round(avg(extract(epoch from (a.called_at - a.arrived_at)) / 60)::numeric, 1)
    into v_avg_wait
  from public.appointments a
  where a.queue_state_id = q.id and a.called_at is not null and a.arrived_at is not null;
  return jsonb_build_object('queue', app.queue_public(q), 'by_status', v_counts,
                            'avg_consult_minutes', v_avg_consult, 'avg_wait_minutes', v_avg_wait);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin dashboard (real data only)
-- ---------------------------------------------------------------------------
create or replace function public.admin_dashboard(p_hospital_id uuid, p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h public.hospitals%rowtype;
  v_today date;
  v_from date;
  v_to date;
  v_result jsonb;
begin
  if not app.is_admin(p_hospital_id) then
    perform app.fail('MQ_FORBIDDEN', 'Administrator access required.');
  end if;
  select * into h from public.hospitals where id = p_hospital_id;
  v_today := app.hospital_today(p_hospital_id);
  v_to := coalesce(p_to, v_today);
  v_from := coalesce(p_from, v_to - 13);
  if v_to < v_from or v_to - v_from > 92 then
    perform app.fail('MQ_INVALID_RANGE', 'Choose a range of at most 93 days.');
  end if;

  select jsonb_build_object(
    'today', v_today,
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'today_counts', (
      select jsonb_build_object(
        'total', count(*) filter (where a.status <> 'PAYMENT_PENDING'),
        'confirmed', count(*) filter (where a.status = 'CONFIRMED'),
        'waiting', count(*) filter (where a.status in ('ARRIVED', 'WAITING')),
        'serving', count(*) filter (where a.status in ('CALLED', 'IN_CONSULTATION')),
        'completed', count(*) filter (where a.status = 'COMPLETED'),
        'cancelled', count(*) filter (where a.status = 'CANCELLED'),
        'no_show', count(*) filter (where a.status = 'NO_SHOW'),
        'skipped', count(*) filter (where a.status = 'SKIPPED'),
        'payment_pending', count(*) filter (where a.status = 'PAYMENT_PENDING'),
        'walk_in', count(*) filter (where a.source = 'WALK_IN' and a.status <> 'CANCELLED'),
        'online', count(*) filter (where a.source = 'ONLINE' and a.status not in ('CANCELLED', 'PAYMENT_PENDING'))
      )
      from public.appointments a where a.hospital_id = p_hospital_id and a.session_date = v_today
    ),
    'active_doctors', (select count(*) from public.doctors d where d.hospital_id = p_hospital_id and d.is_active),
    'sessions_in_progress', (
      select count(*) from public.queue_states q
      where q.hospital_id = p_hospital_id and q.session_date = v_today and q.status in ('OPEN', 'PAUSED')
    ),
    'conversion', (
      select jsonb_build_object(
        'online_created', count(*) filter (where a.source = 'ONLINE'),
        'online_confirmed', count(*) filter (where a.source = 'ONLINE' and a.token_no is not null),
        'payment_holds', count(*) filter (where a.payment_mode = 'ONLINE'),
        'payment_holds_confirmed', count(*) filter (where a.payment_mode = 'ONLINE' and a.token_no is not null),
        'cancelled', count(*) filter (where a.status = 'CANCELLED'),
        'completed', count(*) filter (where a.status = 'COMPLETED'),
        'no_show', count(*) filter (where a.status = 'NO_SHOW')
      )
      from public.appointments a
      where a.hospital_id = p_hospital_id and a.session_date between v_from and v_to
    ),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('date', g.day::date, 'bookings', coalesce(c.bookings, 0),
                                          'cancelled', coalesce(c.cancelled, 0),
                                          'completed', coalesce(c.completed, 0)) order by g.day)
      from generate_series(v_from, v_to, interval '1 day') as g(day)
      left join (
        select a.session_date, count(*) filter (where a.token_no is not null) as bookings,
               count(*) filter (where a.status = 'CANCELLED' and a.token_no is not null) as cancelled,
               count(*) filter (where a.status = 'COMPLETED') as completed
        from public.appointments a
        where a.hospital_id = p_hospital_id and a.session_date between v_from and v_to
        group by a.session_date
      ) c on c.session_date = g.day::date
    ), '[]'::jsonb),
    'by_department', coalesce((
      select jsonb_agg(jsonb_build_object('department', x.name, 'bookings', x.n) order by x.n desc)
      from (
        select dep.name, count(*) as n
        from public.appointments a
        join public.doctors d on d.id = a.doctor_id
        join public.departments dep on dep.id = d.department_id
        where a.hospital_id = p_hospital_id and a.session_date between v_from and v_to and a.token_no is not null
        group by dep.name
      ) x
    ), '[]'::jsonb),
    'by_doctor', coalesce((
      select jsonb_agg(jsonb_build_object('doctor', x.full_name, 'patients', x.n, 'completed', x.done) order by x.n desc)
      from (
        select d.full_name, count(*) as n, count(*) filter (where a.status = 'COMPLETED') as done
        from public.appointments a
        join public.doctors d on d.id = a.doctor_id
        where a.hospital_id = p_hospital_id and a.session_date between v_from and v_to and a.token_no is not null
        group by d.full_name
        order by n desc
        limit 15
      ) x
    ), '[]'::jsonb),
    'peak_hours', coalesce((
      select jsonb_agg(jsonb_build_object('hour', g.hr, 'bookings', coalesce(c.n, 0)) order by g.hr)
      from generate_series(0, 23) as g(hr)
      left join (
        select extract(hour from (a.created_at at time zone h.timezone))::integer as hr, count(*) as n
        from public.appointments a
        where a.hospital_id = p_hospital_id and a.session_date between v_from and v_to
        group by 1
      ) c on c.hr = g.hr
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
