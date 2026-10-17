-- MediQueue: two-factor authentication for enrolled staff, enforced by the database.
-- The staff UI asks for the authenticator code (aal1 -> aal2) before it shows a staff page, but a
-- password-only (aal1) access token can still call PostgREST directly. From here on every staff
-- role check also requires an aal2 token when the caller has a verified MFA factor (Supabase's
-- "enforce MFA for enrolled users" pattern). Callers without a verified factor - patients,
-- anonymous sessions and staff who have not added an authenticator app - are unaffected.
-- Reading one's own user_roles / profiles rows does not go through these helpers, so the app can
-- still tell after the password step that the user is staff and must enter a code.

-- True when the caller's token is strong enough for staff access: aal2, or the account has no
-- verified factor. Never null (a null would read as "not forbidden" in `if not ... then`).
-- auth.mfa_factors belongs to Supabase Auth; it is read as the definer rather than relying on
-- grants to anon/authenticated.
create or replace function app.mfa_satisfied()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    );
$$;

-- Only called from the SECURITY DEFINER helpers below (which run as the owner).
revoke execute on function app.mfa_satisfied() from public, anon, authenticated;

-- The helpers keep their signatures, so existing grants, RLS policies and functions pick up the
-- check unchanged. app.is_admin() goes through app.has_role().
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
  ) and app.mfa_satisfied();
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
  ) and app.mfa_satisfied();
$$;

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
  ) and app.mfa_satisfied();
$$;

-- Same permission matrix as before; an enrolled caller without aal2 has no staff role here and
-- gets MQ_FORBIDDEN.
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

  if v_roles is not null and app.mfa_satisfied() then
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
