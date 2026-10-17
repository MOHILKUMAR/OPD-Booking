-- MediQueue: authorization helpers, Row Level Security policies and table privileges.
-- Rule: the browser holds only the publishable key. Every privilege below assumes the caller
-- is hostile; RLS + SECURITY DEFINER functions with explicit role checks are the boundary.

-- ---------------------------------------------------------------------------
-- Error helper: business errors carry a stable machine code in MESSAGE and a
-- patient-safe explanation in HINT. PostgREST returns both to the client.
-- ---------------------------------------------------------------------------
create or replace function app.fail(p_code text, p_hint text, p_detail text default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, hint = p_hint, detail = coalesce(p_detail, '');
end;
$$;

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------
create or replace function app.jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'role', '');
$$;

create or replace function app.is_service()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.jwt_role() = 'service_role';
$$;

create or replace function app.has_role(p_role public.app_role, p_hospital_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = p_role
      and (p_hospital_id is null or ur.hospital_id = p_hospital_id)
  );
$$;

create or replace function app.is_admin(p_hospital_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_role('admin', p_hospital_id);
$$;

create or replace function app.is_staff(p_hospital_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.hospital_id = p_hospital_id
  );
$$;

-- Admin of the doctor's hospital, the doctor themself, or a receptionist assigned to the
-- doctor (or to all doctors).
create or replace function app.can_access_doctor(p_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.doctors d on d.id = p_doctor_id and d.hospital_id = ur.hospital_id
    where ur.user_id = auth.uid()
      and (
        ur.role = 'admin'
        or (ur.role = 'doctor' and ur.doctor_id = p_doctor_id)
        or (ur.role = 'receptionist' and (ur.doctor_id is null or ur.doctor_id = p_doctor_id))
      )
  );
$$;

-- Describes the caller for audit entries. Never trusted for authorization.
create or replace function app.actor_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.is_service() then 'service'
    when auth.uid() is null then 'system'
    when exists (select 1 from public.user_roles ur where ur.user_id = auth.uid()) then (
      select string_agg(distinct ur.role::text, ',') from public.user_roles ur where ur.user_id = auth.uid()
    )
    when coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then 'patient_guest'
    else 'patient'
  end;
$$;

-- Permission matrix for queue and session actions. Returns the role that authorizes the
-- action, or raises MQ_FORBIDDEN. Mirrors docs/04-permissions.md.
create or replace function app.require_doctor_permission(p_doctor_id uuid, p_action text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_roles text[];
  v_self_manage boolean;
begin
  select array_agg(distinct ur.role::text), bool_or(d.can_self_manage_session)
    into v_roles, v_self_manage
  from public.user_roles ur
  join public.doctors d on d.id = p_doctor_id and d.hospital_id = ur.hospital_id
  where ur.user_id = auth.uid()
    and (
      ur.role = 'admin'
      or (ur.role = 'doctor' and ur.doctor_id = p_doctor_id)
      or (ur.role = 'receptionist' and (ur.doctor_id is null or ur.doctor_id = p_doctor_id))
    );

  if v_roles is not null then
    if 'admin' = any (v_roles) then
      return 'admin';
    end if;
    if 'receptionist' = any (v_roles) and p_action = any (array[
      'ARRIVE', 'CALL', 'CALL_NEXT', 'SKIP', 'RECALL', 'NO_SHOW', 'CANCEL', 'WALK_IN', 'SET_DELAY'
    ]) then
      return 'receptionist';
    end if;
    if 'doctor' = any (v_roles) and p_action = any (array[
      'CALL', 'CALL_NEXT', 'START', 'COMPLETE', 'SKIP', 'RECALL'
    ]) then
      return 'doctor';
    end if;
    if 'doctor' = any (v_roles) and v_self_manage and p_action = any (array[
      'OPEN', 'PAUSE', 'RESUME', 'CLOSE', 'SET_DELAY'
    ]) then
      return 'doctor';
    end if;
  end if;

  perform app.fail('MQ_FORBIDDEN', 'You do not have permission to perform this action.', p_action);
  return null;
end;
$$;

-- Best-effort client IP from proxy headers. cf-connecting-ip is set by Cloudflare in front of
-- Supabase and cannot be forged by the client; other headers are only a fallback.
create or replace function app.client_ip()
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_headers json;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    return null;
  end;
  if v_headers is null then
    return null;
  end if;
  return nullif(btrim(coalesce(v_headers ->> 'cf-connecting-ip', v_headers ->> 'x-real-ip', '')), '');
end;
$$;

-- Operational limits, changeable without a migration (SQL editor, service role only).
-- Hospitals where many patients share one public IP (hospital Wi-Fi, kiosks) may need a higher
-- per-IP limit; load tests on a staging project can raise them temporarily.
create table app.config (
  key text primary key,
  value integer not null check (value > 0),
  description text not null
);
insert into app.config (key, value, description) values
  ('rate.book_per_user_hour', 10, 'Successful online bookings per patient session per hour'),
  ('rate.book_per_ip_hour', 60, 'Successful online bookings per client IP per hour'),
  ('rate.lookup_per_ip_10min', 120, 'Booking lookups per client IP per 10 minutes'),
  ('rate.lookup_per_ref_10min', 60, 'Lookups of one booking reference per 10 minutes'),
  ('rate.cancel_per_ip_10min', 30, 'Cancellations per client IP per 10 minutes');
alter table app.config enable row level security;
revoke all on app.config from anon, authenticated;

create or replace function app.config_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.value from app.config c where c.key = p_key), p_default);
$$;

-- Fixed-window rate limiter. The increment rolls back with the caller's transaction, so only
-- calls that complete count towards the limit.
create or replace function app.hit_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into app.rate_limits as rl (bucket, window_start, hits)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = rl.hits + 1
  returning rl.hits into v_hits;

  if v_hits > p_limit then
    perform app.fail('MQ_RATE_LIMITED', 'Too many attempts. Please wait a few minutes and try again.');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prevent locking the hospital out: the last admin role cannot be removed.
-- ---------------------------------------------------------------------------
create or replace function app.protect_last_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin' and not exists (
    select 1 from public.user_roles ur
    where ur.hospital_id = old.hospital_id and ur.role = 'admin' and ur.id <> old.id
  ) then
    raise exception using errcode = 'P0001', message = 'MQ_LAST_ADMIN',
      hint = 'At least one administrator must remain.';
  end if;
  return old;
end;
$$;
create trigger user_roles_protect_last_admin before delete on public.user_roles
  for each row execute function app.protect_last_admin();

create or replace function app.stamp_user_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  if new.doctor_id is not null and not exists (
    select 1 from public.doctors d where d.id = new.doctor_id and d.hospital_id = new.hospital_id
  ) then
    raise exception using errcode = 'P0001', message = 'MQ_INVALID_DOCTOR',
      hint = 'The doctor does not belong to this hospital.';
  end if;
  return new;
end;
$$;
create trigger user_roles_stamp before insert on public.user_roles
  for each row execute function app.stamp_user_role();

-- ---------------------------------------------------------------------------
-- Table privileges. Supabase grants ALL on new tables to anon/authenticated by default;
-- reset that and grant only what each role needs. RLS then filters rows.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on app.rate_limits from anon, authenticated;

grant usage on schema app to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- public catalogue (non-sensitive)
grant select on public.hospitals, public.departments, public.doctors, public.shifts,
  public.doctor_schedules, public.shift_exceptions, public.queue_states,
  public.hospital_announcements to anon, authenticated;

-- signed-in reads (rows filtered by RLS)
grant select on public.appointments, public.payments, public.refunds, public.notifications,
  public.audit_logs, public.profiles, public.user_roles to authenticated;

-- admin configuration writes (RLS restricts to admins)
grant update on public.hospitals to authenticated;
grant insert, update, delete on public.departments, public.doctors, public.shifts,
  public.doctor_schedules, public.shift_exceptions, public.hospital_announcements to authenticated;
grant insert, delete on public.user_roles to authenticated;
grant insert, update on public.profiles to authenticated;

grant all on all tables in schema public to service_role;
grant all on app.rate_limits to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------------

-- hospitals
create policy hospitals_public_read on public.hospitals
  for select to anon, authenticated using (is_active or app.is_staff(id));
create policy hospitals_admin_update on public.hospitals
  for update to authenticated using (app.is_admin(id)) with check (app.is_admin(id));

-- departments
create policy departments_public_read on public.departments
  for select to anon, authenticated using (is_active or app.is_staff(hospital_id));
create policy departments_admin_insert on public.departments
  for insert to authenticated with check (app.is_admin(hospital_id));
create policy departments_admin_update on public.departments
  for update to authenticated using (app.is_admin(hospital_id)) with check (app.is_admin(hospital_id));
create policy departments_admin_delete on public.departments
  for delete to authenticated using (app.is_admin(hospital_id));

-- doctors
create policy doctors_public_read on public.doctors
  for select to anon, authenticated using (is_active or app.is_staff(hospital_id));
create policy doctors_admin_insert on public.doctors
  for insert to authenticated with check (app.is_admin(hospital_id));
create policy doctors_admin_update on public.doctors
  for update to authenticated using (app.is_admin(hospital_id)) with check (app.is_admin(hospital_id));
create policy doctors_admin_delete on public.doctors
  for delete to authenticated using (app.is_admin(hospital_id));

-- shifts
create policy shifts_public_read on public.shifts
  for select to anon, authenticated using (is_active or app.is_staff(hospital_id));
create policy shifts_admin_insert on public.shifts
  for insert to authenticated with check (
    app.is_admin(hospital_id)
    and exists (select 1 from public.doctors d where d.id = doctor_id and d.hospital_id = shifts.hospital_id)
  );
create policy shifts_admin_update on public.shifts
  for update to authenticated using (app.is_admin(hospital_id)) with check (app.is_admin(hospital_id));
create policy shifts_admin_delete on public.shifts
  for delete to authenticated using (app.is_admin(hospital_id));

-- doctor_schedules
create policy schedules_public_read on public.doctor_schedules
  for select to anon, authenticated using (is_active or app.is_staff(hospital_id));
create policy schedules_admin_insert on public.doctor_schedules
  for insert to authenticated with check (
    app.is_admin(hospital_id)
    and exists (select 1 from public.doctors d where d.id = doctor_id and d.hospital_id = doctor_schedules.hospital_id)
  );
create policy schedules_admin_update on public.doctor_schedules
  for update to authenticated using (app.is_admin(hospital_id)) with check (app.is_admin(hospital_id));
create policy schedules_admin_delete on public.doctor_schedules
  for delete to authenticated using (app.is_admin(hospital_id));

-- shift_exceptions (reasons are public by design: they explain closures)
create policy exceptions_public_read on public.shift_exceptions
  for select to anon, authenticated using (true);
create policy exceptions_admin_insert on public.shift_exceptions
  for insert to authenticated with check (
    app.is_admin(hospital_id)
    and (doctor_id is null or exists (
      select 1 from public.doctors d where d.id = doctor_id and d.hospital_id = shift_exceptions.hospital_id
    ))
  );
create policy exceptions_admin_update on public.shift_exceptions
  for update to authenticated using (app.is_admin(hospital_id)) with check (app.is_admin(hospital_id));
create policy exceptions_admin_delete on public.shift_exceptions
  for delete to authenticated using (app.is_admin(hospital_id));

-- queue_states: public read, writes only through functions
create policy queue_states_public_read on public.queue_states
  for select to anon, authenticated using (true);

-- appointments: staff for their doctors, patients for their own rows. No direct writes.
create policy appointments_staff_read on public.appointments
  for select to authenticated using (app.can_access_doctor(doctor_id));
create policy appointments_owner_read on public.appointments
  for select to authenticated using (patient_user_id = auth.uid());

-- payments / refunds: administrators only (patients see status through get_booking)
create policy payments_admin_read on public.payments
  for select to authenticated using (app.is_admin(hospital_id));
create policy refunds_admin_read on public.refunds
  for select to authenticated using (app.is_admin(hospital_id));
-- payment_events: no client policies at all (service role only)

-- notifications: recipient only
create policy notifications_recipient_read on public.notifications
  for select to authenticated using (recipient_user_id = auth.uid());

-- announcements: published + unexpired are public; admins see drafts
create policy announcements_public_read on public.hospital_announcements
  for select to anon, authenticated using (
    (is_published and (expires_at is null or expires_at > now())) or app.is_admin(hospital_id)
  );
create policy announcements_admin_insert on public.hospital_announcements
  for insert to authenticated with check (app.is_admin(hospital_id));
create policy announcements_admin_update on public.hospital_announcements
  for update to authenticated using (app.is_admin(hospital_id)) with check (app.is_admin(hospital_id));
create policy announcements_admin_delete on public.hospital_announcements
  for delete to authenticated using (app.is_admin(hospital_id));

-- audit_logs: admins read; nobody writes directly (functions/triggers insert as definer)
create policy audit_logs_admin_read on public.audit_logs
  for select to authenticated using (app.is_admin(hospital_id));

-- profiles: own row; admins can read profiles of their staff
create policy profiles_own_read on public.profiles
  for select to authenticated using (
    id = auth.uid()
    or exists (
      select 1 from public.user_roles ur where ur.user_id = profiles.id and app.is_admin(ur.hospital_id)
    )
  );
create policy profiles_own_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy profiles_own_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- user_roles: users see their own roles; admins manage roles in their hospital
create policy user_roles_read on public.user_roles
  for select to authenticated using (user_id = auth.uid() or app.is_admin(hospital_id));
create policy user_roles_admin_insert on public.user_roles
  for insert to authenticated with check (app.is_admin(hospital_id));
create policy user_roles_admin_delete on public.user_roles
  for delete to authenticated using (app.is_admin(hospital_id));
