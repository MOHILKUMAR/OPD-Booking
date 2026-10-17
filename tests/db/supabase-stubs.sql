-- Minimal stand-ins for the pieces of a Supabase database that MediQueue's migrations
-- depend on, so the real migrations can run on a plain PostgreSQL 17 cluster in tests.
-- Mirrors Supabase behaviour:
--   * PostgREST connects as `authenticator` and switches to anon / authenticated / service_role
--   * the JWT claims are exposed as request.jwt.claims; auth.uid() reads `sub`; user tokens
--     carry `aal` ('aal1' after a password, 'aal2' after an MFA code; see tests/db/helpers.ts)
--   * Supabase Auth keeps MFA enrolments in auth.mfa_factors
--   * Realtime reads the `supabase_realtime` publication

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'authenticator';
grant anon, authenticated, service_role to authenticator;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);

-- Subset of Supabase Auth's table. No grants to anon/authenticated: the migrations must read it
-- as a SECURITY DEFINER owner.
create type auth.factor_type as enum ('totp', 'webauthn', 'phone');
create type auth.factor_status as enum ('unverified', 'verified');
create table auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type auth.factor_type not null default 'totp',
  status auth.factor_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index mfa_factors_user_id_idx on auth.mfa_factors (user_id);

-- Returns the claims as sent, e.g. {"sub": "...", "role": "authenticated", "aal": "aal1"}.
create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Supabase's default privileges on the public schema (the migrations must undo these).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create publication supabase_realtime;
