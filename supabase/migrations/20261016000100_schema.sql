-- MediQueue: core schema
-- Tables, enums, constraints, indexes and integrity triggers.
-- All business writes to appointments / queue_states / payments go through
-- SECURITY DEFINER functions defined in later migrations; clients never write them directly.

create schema if not exists app;
comment on schema app is 'Internal MediQueue helpers. Not exposed through the Data API.';
revoke all on schema app from public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'receptionist', 'doctor');

create type public.appointment_status as enum (
  'BOOKED', 'PAYMENT_PENDING', 'CONFIRMED', 'ARRIVED', 'WAITING', 'CALLED',
  'IN_CONSULTATION', 'COMPLETED', 'SKIPPED', 'CANCELLED', 'NO_SHOW'
);

create type public.session_status as enum ('SCHEDULED', 'OPEN', 'PAUSED', 'CLOSED', 'CANCELLED');
create type public.booking_source as enum ('ONLINE', 'WALK_IN');
create type public.payment_mode as enum ('FREE', 'PAY_AT_HOSPITAL', 'ONLINE');
create type public.payment_status as enum (
  'CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'
);
create type public.refund_status as enum ('REQUESTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'REJECTED');
create type public.exception_kind as enum ('HOLIDAY', 'CLOSED', 'MODIFIED_HOURS', 'CAPACITY_CHANGE');
create type public.announcement_kind as enum (
  'GENERAL', 'DOCTOR_DELAY', 'OPD_CANCELLED', 'HOLIDAY', 'SCHEDULE_CHANGE'
);
create type public.notification_channel as enum ('IN_APP', 'SMS', 'WHATSAPP', 'EMAIL');
-- PHONE: one active token per phone per session.
-- PHONE_AND_NAME: one per phone+patient name (lets a parent book for two children).
create type public.duplicate_policy as enum ('PHONE', 'PHONE_AND_NAME');

-- ---------------------------------------------------------------------------
-- Generic triggers
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- hospitals
-- ---------------------------------------------------------------------------
create table public.hospitals (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  tagline text check (length(tagline) <= 160),
  address_line text not null check (length(address_line) between 3 and 200),
  city text not null check (length(city) between 2 and 80),
  state text not null check (length(state) between 2 and 80),
  postal_code text check (postal_code ~ '^[0-9]{6}$'),
  phone text check (length(phone) <= 30),
  emergency_phone text check (length(emergency_phone) <= 30),
  email text check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  map_url text check (map_url ~* '^https://'),
  logo_url text check (logo_url ~* '^(https://|/)'),
  timezone text not null default 'Asia/Kolkata',
  -- e.g. [{"label":"Mon - Sat","hours":"08:00 - 20:00"}]
  operating_hours jsonb not null default '[]'::jsonb check (jsonb_typeof(operating_hours) = 'array'),
  visit_instructions text check (length(visit_instructions) <= 1000),
  booking_window_days smallint not null default 1 check (booking_window_days between 0 and 14),
  cancel_cutoff_minutes integer not null default 60 check (cancel_cutoff_minutes between 0 and 1440),
  duplicate_policy public.duplicate_policy not null default 'PHONE',
  max_bookings_per_phone_per_day smallint not null default 3
    check (max_bookings_per_phone_per_day between 1 and 20),
  require_patient_age boolean not null default true,
  default_booking_fee_paise integer not null default 0
    check (default_booking_fee_paise between 0 and 10000000),
  online_payments_enabled boolean not null default false,
  payment_hold_minutes smallint not null default 15 check (payment_hold_minutes between 5 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function app.validate_hospital()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Raises invalid_parameter_value for an unknown time zone name.
  perform now() at time zone new.timezone;
  return new;
end;
$$;

create trigger hospitals_validate before insert or update on public.hospitals
  for each row execute function app.validate_hospital();
create trigger hospitals_touch before update on public.hospitals
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- profiles (staff and optional patient accounts; never required for booking)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text check (length(full_name) <= 120),
  email text check (length(email) <= 254),
  phone text check (phone ~ '^[6-9][0-9]{9}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  description text check (length(description) <= 500),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index departments_name_uq on public.departments (hospital_id, lower(name));
create trigger departments_touch before update on public.departments
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- doctors
-- Profile text is entered by the hospital; the app never generates qualifications.
-- ---------------------------------------------------------------------------
create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) between 3 and 120),
  specialty text not null check (length(btrim(specialty)) between 2 and 80),
  qualifications text check (length(qualifications) <= 200),
  bio text check (length(bio) <= 1000),
  photo_url text check (photo_url ~* '^(https://|/)'),
  room_no text check (length(room_no) <= 20),
  consultation_fee_paise integer not null default 0 check (consultation_fee_paise between 0 and 10000000),
  accepting_bookings boolean not null default true,
  can_self_manage_session boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index doctors_hospital_active_idx on public.doctors (hospital_id, is_active, sort_order);
create index doctors_department_idx on public.doctors (department_id);
create index doctors_specialty_idx on public.doctors (hospital_id, lower(specialty));
create trigger doctors_touch before update on public.doctors
  for each row execute function app.touch_updated_at();

-- department must belong to the same hospital
create or replace function app.validate_doctor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.departments d
    where d.id = new.department_id and d.hospital_id = new.hospital_id
  ) then
    raise exception using errcode = 'P0001', message = 'MQ_INVALID_DEPARTMENT',
      hint = 'The department does not belong to this hospital.';
  end if;
  return new;
end;
$$;
create trigger doctors_validate before insert or update of department_id, hospital_id on public.doctors
  for each row execute function app.validate_doctor();

-- ---------------------------------------------------------------------------
-- user_roles (staff authorization; patients have no row here)
-- ---------------------------------------------------------------------------
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  role public.app_role not null,
  -- doctor: the doctor record this login operates.
  -- receptionist: an assigned doctor; NULL means all doctors of the hospital.
  doctor_id uuid references public.doctors (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint user_roles_doctor_required check (role <> 'doctor' or doctor_id is not null),
  constraint user_roles_admin_unscoped check (role <> 'admin' or doctor_id is null),
  constraint user_roles_unique unique nulls not distinct (user_id, role, doctor_id)
);
create unique index user_roles_one_login_per_doctor on public.user_roles (doctor_id) where role = 'doctor';
create index user_roles_user_idx on public.user_roles (user_id);

-- ---------------------------------------------------------------------------
-- shifts: a doctor's recurring OPD block (e.g. "Morning OPD 09:00-13:00")
-- ---------------------------------------------------------------------------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 60),
  start_time time not null,
  end_time time not null,
  max_tokens integer not null check (max_tokens between 1 and 500),
  walkin_reserved integer not null default 0 check (walkin_reserved >= 0),
  -- online booking for the same day closes this many minutes before end_time
  booking_cutoff_minutes integer not null default 30 check (booking_cutoff_minutes between 0 and 720),
  avg_consult_minutes smallint not null default 10 check (avg_consult_minutes between 1 and 120),
  -- NULL = use hospitals.default_booking_fee_paise
  booking_fee_paise integer check (booking_fee_paise between 0 and 10000000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shifts_time_order check (end_time > start_time),
  constraint shifts_walkin_lt_max check (walkin_reserved < max_tokens),
  constraint shifts_id_doctor_uq unique (id, doctor_id)
);
create index shifts_doctor_idx on public.shifts (doctor_id) where is_active;
create trigger shifts_touch before update on public.shifts
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- doctor_schedules: which weekdays a shift runs, with an effective date range
-- ---------------------------------------------------------------------------
create table public.doctor_schedules (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  shift_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday (extract(dow))
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint doctor_schedules_shift_fk foreign key (shift_id, doctor_id)
    references public.shifts (id, doctor_id) on delete cascade,
  constraint doctor_schedules_range check (effective_to is null or effective_to >= effective_from),
  constraint doctor_schedules_unique unique (shift_id, weekday, effective_from)
);
create index doctor_schedules_doctor_idx on public.doctor_schedules (doctor_id, weekday) where is_active;
create index doctor_schedules_shift_idx on public.doctor_schedules (shift_id);
create trigger doctor_schedules_touch before update on public.doctor_schedules
  for each row execute function app.touch_updated_at();

-- Reject overlapping shifts for the same doctor on the same weekday.
create or replace function app.assert_no_schedule_overlap(p_schedule_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conflict record;
begin
  select o.id, os.name as other_shift, s.name as this_shift into v_conflict
  from public.doctor_schedules ds
  join public.shifts s on s.id = ds.shift_id
  join public.doctor_schedules o
    on o.doctor_id = ds.doctor_id
   and o.weekday = ds.weekday
   and o.id <> ds.id
   and o.is_active
   and daterange(o.effective_from, o.effective_to, '[]') && daterange(ds.effective_from, ds.effective_to, '[]')
  join public.shifts os on os.id = o.shift_id and os.is_active
  where ds.id = p_schedule_id
    and ds.is_active
    and s.is_active
    and os.start_time < s.end_time
    and s.start_time < os.end_time
  limit 1;

  if found then
    raise exception using errcode = 'P0001', message = 'MQ_SHIFT_OVERLAP',
      hint = format('"%s" overlaps "%s" on the same weekday.', v_conflict.this_shift, v_conflict.other_shift);
  end if;
end;
$$;

create or replace function app.check_schedule_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_no_schedule_overlap(new.id);
  return null;
end;
$$;

create constraint trigger doctor_schedules_no_overlap
  after insert or update on public.doctor_schedules
  deferrable initially immediate
  for each row execute function app.check_schedule_overlap();

create or replace function app.check_shift_time_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in select ds.id from public.doctor_schedules ds where ds.shift_id = new.id loop
    perform app.assert_no_schedule_overlap(v_id);
  end loop;
  return null;
end;
$$;

create constraint trigger shifts_no_overlap
  after update of start_time, end_time, is_active on public.shifts
  deferrable initially immediate
  for each row execute function app.check_shift_time_overlap();

-- ---------------------------------------------------------------------------
-- shift_exceptions: holidays, closures, modified hours, capacity changes
--   doctor_id NULL & shift_id NULL -> whole hospital
--   doctor_id set  & shift_id NULL -> all of that doctor's shifts
--   shift_id set                    -> that shift only
-- ---------------------------------------------------------------------------
create table public.shift_exceptions (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  doctor_id uuid references public.doctors (id) on delete cascade,
  shift_id uuid,
  exception_date date not null,
  kind public.exception_kind not null,
  start_time time,
  end_time time,
  max_tokens integer,
  reason text not null check (length(btrim(reason)) between 3 and 300), -- shown to patients
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_exceptions_shift_fk foreign key (shift_id, doctor_id)
    references public.shifts (id, doctor_id) on delete cascade,
  constraint shift_exceptions_shift_needs_doctor check (shift_id is null or doctor_id is not null),
  constraint shift_exceptions_shift_scoped check (
    kind not in ('MODIFIED_HOURS', 'CAPACITY_CHANGE') or shift_id is not null
  ),
  constraint shift_exceptions_hours check (
    kind <> 'MODIFIED_HOURS' or (start_time is not null and end_time is not null and end_time > start_time)
  ),
  constraint shift_exceptions_capacity check (
    kind <> 'CAPACITY_CHANGE' or max_tokens between 1 and 500
  ),
  constraint shift_exceptions_unique unique nulls not distinct (exception_date, doctor_id, shift_id, kind)
);
create index shift_exceptions_date_idx on public.shift_exceptions (hospital_id, exception_date);
create trigger shift_exceptions_touch before update on public.shift_exceptions
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- queue_states: one row per (shift, date) OPD session. Authoritative queue state.
-- Public-readable: contains no patient data.
-- ---------------------------------------------------------------------------
create table public.queue_states (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  doctor_id uuid not null,
  shift_id uuid not null,
  session_date date not null,
  status public.session_status not null default 'SCHEDULED',
  booking_open boolean not null default true,
  start_time time not null,
  end_time time not null,
  capacity integer not null check (capacity between 1 and 500),
  online_capacity integer not null check (online_capacity >= 0),
  last_token_no integer not null default 0 check (last_token_no >= 0),
  issued_count integer not null default 0 check (issued_count >= 0),
  waiting_count integer not null default 0 check (waiting_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  current_token_no integer,
  next_token_no integer,
  delay_minutes smallint not null default 0 check (delay_minutes between 0 and 600),
  public_note text check (length(public_note) <= 200),
  version bigint not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint queue_states_shift_fk foreign key (shift_id, doctor_id)
    references public.shifts (id, doctor_id) on delete restrict,
  constraint queue_states_session_uq unique (shift_id, session_date),
  constraint queue_states_online_le_capacity check (online_capacity <= capacity)
);
create index queue_states_date_idx on public.queue_states (hospital_id, session_date);
create index queue_states_doctor_date_idx on public.queue_states (doctor_id, session_date);
create trigger queue_states_touch before update on public.queue_states
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- appointments (tokens). Private: patient name and phone.
-- ---------------------------------------------------------------------------
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete restrict,
  queue_state_id uuid not null references public.queue_states (id) on delete restrict,
  doctor_id uuid not null references public.doctors (id) on delete restrict,
  shift_id uuid not null references public.shifts (id) on delete restrict,
  session_date date not null,
  token_no integer check (token_no > 0),
  booking_reference text not null unique check (booking_reference ~ '^MQ-[A-Z2-9]{8}$'),
  access_key_hash text not null check (access_key_hash ~ '^[0-9a-f]{64}$'),
  patient_user_id uuid references auth.users (id) on delete set null,
  patient_name text not null check (length(btrim(patient_name)) between 2 and 80),
  patient_phone text not null check (patient_phone ~ '^[6-9][0-9]{9}$'),
  patient_age smallint check (patient_age between 0 and 120),
  booking_identity_key text not null,
  source public.booking_source not null,
  status public.appointment_status not null,
  payment_mode public.payment_mode not null,
  fee_paise integer not null default 0 check (fee_paise >= 0),
  hold_expires_at timestamptz,
  client_request_id uuid,
  cancel_reason text check (length(cancel_reason) <= 300),
  cancelled_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  arrived_at timestamptz,
  called_at timestamptz,
  consultation_started_at timestamptz,
  completed_at timestamptz,
  skipped_at timestamptz,
  skip_count smallint not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_token_required check (
    token_no is not null or status in ('PAYMENT_PENDING', 'CANCELLED')
  ),
  constraint appointments_hold_expiry check (status <> 'PAYMENT_PENDING' or hold_expires_at is not null),
  constraint appointments_online_fee check (payment_mode <> 'ONLINE' or fee_paise > 0),
  -- Two bookings can never share a token number within one queue.
  constraint appointments_token_uq unique (queue_state_id, token_no)
);

-- One active token per booking identity per session (duplicate-booking policy).
create unique index appointments_active_identity_uq
  on public.appointments (queue_state_id, booking_identity_key)
  where status in ('BOOKED', 'PAYMENT_PENDING', 'CONFIRMED', 'ARRIVED', 'WAITING', 'CALLED',
                   'IN_CONSULTATION', 'SKIPPED');
-- Client retries of the same submission return the original booking. The requester is the
-- patient account for online bookings and the staff member for walk-ins.
create unique index appointments_client_request_uq
  on public.appointments ((coalesce(patient_user_id, created_by)), client_request_id)
  where client_request_id is not null;
create index appointments_queue_status_idx on public.appointments (queue_state_id, status, token_no);
create index appointments_patient_idx on public.appointments (patient_user_id, session_date desc)
  where patient_user_id is not null;
create index appointments_phone_date_idx on public.appointments (patient_phone, session_date);
create index appointments_hospital_date_idx on public.appointments (hospital_id, session_date);
create index appointments_hospital_created_idx on public.appointments (hospital_id, created_at);
create index appointments_doctor_date_idx on public.appointments (doctor_id, session_date);
create index appointments_hold_idx on public.appointments (hold_expires_at) where status = 'PAYMENT_PENDING';

create trigger appointments_touch before update on public.appointments
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- payments (one gateway order per online-paid appointment)
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete restrict,
  appointment_id uuid not null unique references public.appointments (id) on delete restrict,
  gateway text not null default 'razorpay' check (gateway in ('razorpay')),
  gateway_mode text not null check (gateway_mode in ('test', 'live')),
  idempotency_key uuid not null unique,
  receipt text not null unique check (length(receipt) <= 40),
  gateway_order_id text unique,
  gateway_payment_id text unique,
  amount_paise integer not null check (amount_paise > 0),
  currency text not null default 'INR' check (currency = 'INR'),
  status public.payment_status not null default 'CREATED',
  verified_via text check (verified_via in ('CHECKOUT_SIGNATURE', 'WEBHOOK')),
  verified_at timestamptz,
  failure_reason text check (length(failure_reason) <= 500),
  order_claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_captured_has_id check (
    status not in ('CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED') or gateway_payment_id is not null
  )
);
create index payments_hospital_created_idx on public.payments (hospital_id, created_at desc);
create index payments_status_idx on public.payments (status);
create trigger payments_touch before update on public.payments
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- payment_events: webhook deliveries, deduplicated by the gateway event id
-- Stores ids and amounts only (no payer contact details).
-- ---------------------------------------------------------------------------
create table public.payment_events (
  id bigint generated always as identity primary key,
  gateway text not null default 'razorpay',
  gateway_event_id text not null unique,
  event_type text not null,
  gateway_order_id text,
  gateway_payment_id text,
  gateway_refund_id text,
  amount_paise integer,
  received_at timestamptz not null default now(),
  processing_result text
);
create index payment_events_order_idx on public.payment_events (gateway_order_id);

-- ---------------------------------------------------------------------------
-- refunds
-- ---------------------------------------------------------------------------
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete restrict,
  payment_id uuid not null references public.payments (id) on delete restrict,
  appointment_id uuid not null references public.appointments (id) on delete restrict,
  amount_paise integer not null check (amount_paise > 0),
  status public.refund_status not null default 'REQUESTED',
  reason text not null check (length(btrim(reason)) between 3 and 300),
  gateway_refund_id text unique,
  idempotency_key uuid not null unique default gen_random_uuid(),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_reason text check (length(failure_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- at most one open or completed refund per payment (full refunds only in this release)
create unique index refunds_one_active_per_payment on public.refunds (payment_id)
  where status in ('REQUESTED', 'PROCESSING', 'PROCESSED');
create index refunds_status_idx on public.refunds (hospital_id, status);
create trigger refunds_touch before update on public.refunds
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- notifications (in-app now; channel column ready for SMS/WhatsApp/email later)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  recipient_user_id uuid references auth.users (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete cascade,
  channel public.notification_channel not null default 'IN_APP',
  kind text not null check (length(kind) <= 40),
  title text not null check (length(title) <= 120),
  body text not null check (length(body) <= 500),
  status text not null default 'SENT' check (status in ('PENDING', 'SENT', 'FAILED')),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_has_target check (recipient_user_id is not null or appointment_id is not null)
);
create index notifications_recipient_idx on public.notifications (recipient_user_id, created_at desc);
create index notifications_appointment_idx on public.notifications (appointment_id, created_at desc);
create index notifications_pending_idx on public.notifications (channel, status) where status = 'PENDING';

-- ---------------------------------------------------------------------------
-- hospital_announcements (public once published)
-- ---------------------------------------------------------------------------
create table public.hospital_announcements (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals (id) on delete cascade,
  kind public.announcement_kind not null default 'GENERAL',
  title text not null check (length(btrim(title)) between 3 and 120),
  body text not null check (length(btrim(body)) between 3 and 1000),
  doctor_id uuid references public.doctors (id) on delete set null,
  is_published boolean not null default false,
  show_on_display boolean not null default true,
  published_at timestamptz,
  expires_at timestamptz,
  author_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_expiry check (expires_at is null or published_at is null or expires_at > published_at)
);
create index announcements_public_idx on public.hospital_announcements (hospital_id, is_published, published_at desc);
create trigger announcements_touch before update on public.hospital_announcements
  for each row execute function app.touch_updated_at();

-- Author and publish time come from the server, never from the client.
create or replace function app.stamp_announcement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
  else
    new.author_id := old.author_id;
  end if;
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    new.published_at := now();
  elsif not new.is_published then
    new.published_at := null;
  else
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;
create trigger announcements_stamp before insert or update on public.hospital_announcements
  for each row execute function app.stamp_announcement();

-- ---------------------------------------------------------------------------
-- audit_logs (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  hospital_id uuid references public.hospitals (id) on delete set null,
  actor_user_id uuid, -- no FK: the log must outlive deleted users
  actor_role text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_hospital_created_idx on public.audit_logs (hospital_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

create or replace function app.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The only permitted removal is the retention job (app.purge_audit_logs), which deletes
  -- old rows after they have been exported. Updates are never allowed.
  if tg_op = 'DELETE' and current_setting('mediqueue.audit_retention', true) = 'on' then
    return old;
  end if;
  raise exception using errcode = 'P0001', message = 'MQ_AUDIT_IMMUTABLE',
    hint = 'Audit log entries cannot be changed or deleted.';
end;
$$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function app.audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- rate limiting buckets (internal)
-- ---------------------------------------------------------------------------
create table app.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

-- Enable RLS everywhere; policies are defined in the access-control migration.
alter table public.hospitals enable row level security;
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.doctors enable row level security;
alter table public.user_roles enable row level security;
alter table public.shifts enable row level security;
alter table public.doctor_schedules enable row level security;
alter table public.shift_exceptions enable row level security;
alter table public.queue_states enable row level security;
alter table public.appointments enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.refunds enable row level security;
alter table public.notifications enable row level security;
alter table public.hospital_announcements enable row level security;
alter table public.audit_logs enable row level security;
alter table app.rate_limits enable row level security;
