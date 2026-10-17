-- MediQueue: server-side helpers for the admin-create-staff Edge Function.
-- Creating an Auth user needs the secret key, so the Edge Function does that part; these
-- functions perform the authorization check and the role grant inside the database, with the
-- requesting administrator recorded as the actor.

create or replace function public.svc_is_admin(p_user_id uuid, p_hospital_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_service();
  return exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_user_id and ur.hospital_id = p_hospital_id and ur.role = 'admin'
  );
end;
$$;

create or replace function public.svc_find_user_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_service();
  select u.id into v_id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
  return v_id;
end;
$$;

create or replace function public.svc_grant_staff_role(
  p_actor_user_id uuid,
  p_user_id uuid,
  p_hospital_id uuid,
  p_role public.app_role,
  p_doctor_id uuid,
  p_full_name text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id uuid;
begin
  perform app.require_service();
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_actor_user_id and ur.hospital_id = p_hospital_id and ur.role = 'admin'
  ) then
    perform app.fail('MQ_FORBIDDEN', 'Administrator access required.');
  end if;

  insert into public.profiles (id, full_name, email)
  values (p_user_id, nullif(btrim(p_full_name), ''), lower(btrim(p_email)))
  on conflict (id) do update
    set full_name = coalesce(excluded.full_name, public.profiles.full_name),
        email = excluded.email;

  insert into public.user_roles (user_id, hospital_id, role, doctor_id)
  values (p_user_id, p_hospital_id, p_role, p_doctor_id)
  on conflict on constraint user_roles_unique do nothing
  returning id into v_role_id;

  insert into public.audit_logs (hospital_id, actor_user_id, actor_role, action, entity_type, entity_id, details)
  values (p_hospital_id, p_actor_user_id, 'admin', 'staff.role_granted', 'user_roles', coalesce(v_role_id::text, ''),
          jsonb_build_object('user_id', p_user_id, 'role', p_role, 'doctor_id', p_doctor_id,
                             'already_had_role', v_role_id is null));

  return jsonb_build_object('user_id', p_user_id, 'role_id', v_role_id, 'already_had_role', v_role_id is null);
end;
$$;

revoke execute on function public.svc_is_admin(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.svc_find_user_by_email(text) from public, anon, authenticated;
revoke execute on function public.svc_grant_staff_role(uuid, uuid, uuid, public.app_role, uuid, text, text) from public, anon, authenticated;
grant execute on function public.svc_is_admin(uuid, uuid) to service_role;
grant execute on function public.svc_find_user_by_email(text) to service_role;
grant execute on function public.svc_grant_staff_role(uuid, uuid, uuid, public.app_role, uuid, text, text) to service_role;
