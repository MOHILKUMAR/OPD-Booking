-- MediQueue: function privileges and Realtime publication.
-- Postgres (and Supabase's default privileges) grant EXECUTE on new functions to PUBLIC /
-- anon / authenticated. Reset that, then grant each API function to the roles that need it.
-- Every granted function still performs its own authorization checks.

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema app from public, anon, authenticated;

-- Helpers evaluated inside RLS policies run with the caller's privileges.
grant execute on function
  app.has_role(public.app_role, uuid),
  app.is_admin(uuid),
  app.is_staff(uuid),
  app.can_access_doctor(uuid)
to anon, authenticated;

-- Public (no sign-in needed). No patient data is reachable through these.
grant execute on function
  public.get_sessions(uuid, date, date, uuid[]),
  public.search_doctors(uuid, text, uuid, text, boolean, date, integer, integer),
  public.get_display_board(uuid, uuid),
  public.get_booking(text, text),
  public.cancel_booking(text, text, text),
  public.is_transition_allowed(public.appointment_status, public.appointment_status)
to anon, authenticated;

-- Signed-in callers (patients incl. anonymous sessions, and staff). Role checks are inside.
grant execute on function
  public.book_token(uuid, date, text, text, integer, uuid),
  public.get_my_appointments(integer, integer),
  public.rotate_access_key(text),
  public.mark_notifications_read(uuid[]),
  public.create_walkin_token(uuid, text, text, integer, boolean, uuid),
  public.queue_update_status(uuid, text, text, integer),
  public.queue_call_next(uuid),
  public.session_control(uuid, date, text, text, integer, boolean),
  public.queue_stats(uuid),
  public.admin_dashboard(uuid, date, date),
  public.request_refund(uuid, text),
  public.reject_refund(uuid, text)
to authenticated;

-- Server-side only (Edge Functions with the secret key).
grant execute on all functions in schema public to service_role;

-- Functions created later by the migration owner start without public EXECUTE.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: only PII-free tables are published. Staff screens use queue_states.version
-- changes as a signal to refetch appointment lists through RLS-protected queries.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.queue_states;
    alter publication supabase_realtime add table public.hospital_announcements;
  end if;
end;
$$;
