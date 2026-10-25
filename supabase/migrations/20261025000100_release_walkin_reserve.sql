-- MediQueue: release the walk-in reserve once the OPD starts.
-- Each shift keeps `walkin_reserved` tokens for patients who come to the desk, so online booking
-- normally stops at max_tokens - walkin_reserved. With hospitals.release_walkin_reserve_on_start
-- (on by default), as soon as staff start the session (OPEN, or PAUSED after starting) every token
-- still free can be booked online too, so the session can fill up completely. The usual rules
-- still apply: online booking closes `booking_cutoff_minutes` before the session ends, and
-- reception can always issue walk-in tokens up to the full capacity.

alter table public.hospitals
  add column release_walkin_reserve_on_start boolean not null default true;

-- Same as before, plus the release: one place decides a session's online capacity, so the
-- booking check, get_sessions ("tokens left"), lock_queue_state and payment confirmation all
-- follow it.
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

  -- The doctor has started this session: unused walk-in tokens open to online booking.
  if exists (
    select 1
    from public.queue_states qs
    join public.hospitals h on h.id = qs.hospital_id
    where qs.shift_id = s.id and qs.session_date = p_date
      and qs.status in ('OPEN', 'PAUSED')
      and h.release_walkin_reserve_on_start
  ) then
    r.online_capacity := r.capacity;
  end if;

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

-- Keeps the stored limit in step the moment staff start the session (payment confirmation
-- reads queue_states.online_capacity directly).
create or replace function app.release_walkin_reserve()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select h.release_walkin_reserve_on_start from public.hospitals h where h.id = new.hospital_id) then
    new.online_capacity := new.capacity;
  end if;
  return new;
end;
$$;

create trigger queue_states_release_walkin before update on public.queue_states
  for each row
  when (new.status in ('OPEN', 'PAUSED') and new.online_capacity < new.capacity)
  execute function app.release_walkin_reserve();

revoke execute on function app.release_walkin_reserve() from public, anon, authenticated;
