-- MediQueue: payment holds, verification, webhooks and refunds (Razorpay).
--
-- Trust model
--   * The browser never confirms a payment. Only Edge Functions holding the Razorpay
--     secret (signature verification + a server-side fetch of the payment) or the signed
--     webhook can call svc_confirm_payment.
--   * svc_* functions are executable by service_role only, and re-check that themselves.
--   * Amounts always come from the database (shift/hospital fee), never from the client.
--   * Lock order matches the rest of the system: queue_states -> appointments -> payments.

create or replace function app.require_service()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not app.is_service() then
    perform app.fail('MQ_FORBIDDEN', 'Server-only operation.');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Create (or replay) a payment hold for a checkout attempt
-- ---------------------------------------------------------------------------
-- Returns the existing hold for a checkout attempt (or NULL when there is none). Used for
-- sequential retries and for concurrent duplicates that queued behind the first attempt.
create or replace function app.replay_payment_hold(p_idempotency_key uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments%rowtype;
  a public.appointments%rowtype;
  v_key text;
  v_needs_order boolean := false;
begin
  select * into p from public.payments where idempotency_key = p_idempotency_key;
  if not found then
    return null;
  end if;
  -- lock order: session -> appointment -> payment
  select * into a from public.appointments where id = p.appointment_id;
  perform 1 from public.queue_states where id = a.queue_state_id for update;
  select * into a from public.appointments where id = p.appointment_id for update;
  select * into p from public.payments where id = p.id for update;

  if a.patient_user_id is distinct from p_user_id then
    perform app.fail('MQ_FORBIDDEN', 'This checkout belongs to another session.');
  end if;
  if p.status in ('CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED') then
    v_key := app.new_access_key();
    update public.appointments set access_key_hash = app.hash_key(v_key) where id = a.id returning * into a;
    return app.booking_payload(a, v_key, true) || jsonb_build_object(
      'outcome', 'ALREADY_PAID', 'payment_id', p.id, 'gateway_order_id', p.gateway_order_id,
      'amount_paise', p.amount_paise, 'currency', p.currency, 'needs_order', false);
  end if;
  if a.status <> 'PAYMENT_PENDING' or a.hold_expires_at <= now() then
    perform app.fail('MQ_HOLD_EXPIRED', 'The payment window for this booking has expired. Please book again.');
  end if;
  -- a previous attempt may have died between claiming and creating the gateway order
  if p.gateway_order_id is null and p.order_claimed_at < now() - interval '30 seconds' then
    update public.payments set order_claimed_at = now() where id = p.id;
    v_needs_order := true;
  end if;
  v_key := app.new_access_key();
  update public.appointments set access_key_hash = app.hash_key(v_key) where id = a.id returning * into a;
  return app.booking_payload(a, v_key, true) || jsonb_build_object(
    'outcome', case when p.gateway_order_id is null and not v_needs_order then 'ORDER_IN_PROGRESS' else 'HOLD_EXISTS' end,
    'payment_id', p.id, 'gateway_order_id', p.gateway_order_id, 'receipt', p.receipt,
    'amount_paise', p.amount_paise, 'currency', p.currency, 'needs_order', v_needs_order);
end;
$$;

create or replace function public.svc_hold_paid_booking(
  p_user_id uuid,
  p_shift_id uuid,
  p_session_date date,
  p_patient_name text,
  p_patient_phone text,
  p_patient_age integer,
  p_idempotency_key uuid,
  p_gateway_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments%rowtype;
  a public.appointments%rowtype;
  v_booking jsonb;
  v_replay jsonb;
begin
  perform app.require_service();
  if p_user_id is null or p_idempotency_key is null or p_gateway_mode not in ('test', 'live') then
    perform app.fail('MQ_INVALID_REQUEST', 'Invalid payment request.');
  end if;

  -- Replay of the same checkout attempt (double click, network retry, page refresh)
  v_replay := app.replay_payment_hold(p_idempotency_key, p_user_id);
  if v_replay is not null then
    return v_replay;
  end if;

  -- New hold: same validation, locking and duplicate rules as a free booking
  v_booking := app.create_appointment(
    p_shift_id, p_session_date, p_patient_name, p_patient_phone, p_patient_age,
    'ONLINE', p_user_id, null, p_idempotency_key, true, false
  );
  if coalesce((v_booking ->> 'replayed')::boolean, false) then
    -- A concurrent request with the same key created the hold while we waited for the session
    -- lock; its payment row committed together with the appointment, so return that hold.
    v_replay := app.replay_payment_hold(p_idempotency_key, p_user_id);
    if v_replay is null then
      perform app.fail('MQ_INVALID_REQUEST', 'This checkout id was already used for another booking.');
    end if;
    return v_replay;
  end if;

  select * into a from public.appointments where id = (v_booking ->> 'appointment_id')::uuid;
  insert into public.payments (hospital_id, appointment_id, gateway_mode, idempotency_key, receipt, amount_paise)
  values (a.hospital_id, a.id, p_gateway_mode, p_idempotency_key, a.booking_reference, a.fee_paise)
  returning * into p;

  perform app.audit(a.hospital_id, 'payment.created', 'payment', p.id::text,
    jsonb_build_object('appointment_id', a.id, 'amount_paise', p.amount_paise, 'mode', p.gateway_mode,
                       'patient_user_id', p_user_id));

  return v_booking || jsonb_build_object(
    'outcome', 'HOLD_CREATED', 'payment_id', p.id, 'gateway_order_id', null, 'receipt', p.receipt,
    'amount_paise', p.amount_paise, 'currency', p.currency, 'needs_order', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Attach the gateway order id created by the Edge Function
-- ---------------------------------------------------------------------------
create or replace function public.svc_attach_order(p_payment_id uuid, p_gateway_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments%rowtype;
begin
  perform app.require_service();
  if nullif(btrim(coalesce(p_gateway_order_id, '')), '') is null then
    perform app.fail('MQ_INVALID_REQUEST', 'Missing gateway order id.');
  end if;
  update public.payments
     set gateway_order_id = p_gateway_order_id
   where id = p_payment_id and (gateway_order_id is null or gateway_order_id = p_gateway_order_id)
  returning * into p;
  if not found then
    perform app.fail('MQ_ORDER_CONFLICT', 'A different order is already linked to this payment.');
  end if;
  perform app.audit(p.hospital_id, 'payment.order_created', 'payment', p.id::text,
    jsonb_build_object('gateway_order_id', p_gateway_order_id));
  return jsonb_build_object('payment_id', p.id, 'gateway_order_id', p.gateway_order_id,
                            'amount_paise', p.amount_paise, 'currency', p.currency);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Confirm a verified payment (idempotent; safe for checkout + webhook races)
-- ---------------------------------------------------------------------------
create or replace function app.confirm_payment(
  p_gateway_order_id text,
  p_gateway_payment_id text,
  p_amount_paise integer,
  p_via text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments%rowtype;
  a public.appointments%rowtype;
  q public.queue_states%rowtype;
  v_ok boolean;
  v_token integer;
  v_refund uuid;
  v_outcome text;
  v_doctor text;
begin
  if p_via not in ('CHECKOUT_SIGNATURE', 'WEBHOOK') then
    perform app.fail('MQ_INVALID_REQUEST', 'Unknown verification source.');
  end if;
  select * into p from public.payments where gateway_order_id = p_gateway_order_id;
  if not found then
    perform app.fail('MQ_PAYMENT_NOT_FOUND', 'No booking is linked to this payment order.');
  end if;

  -- lock order: session -> appointment -> payment
  select * into a from public.appointments where id = p.appointment_id;
  select * into q from public.queue_states where id = a.queue_state_id for update;
  select * into a from public.appointments where id = p.appointment_id for update;
  select * into p from public.payments where id = p.id for update;

  if p_amount_paise is distinct from p.amount_paise then
    perform app.audit(p.hospital_id, 'payment.amount_mismatch', 'payment', p.id::text,
      jsonb_build_object('expected', p.amount_paise, 'received', p_amount_paise, 'via', p_via));
    perform app.fail('MQ_AMOUNT_MISMATCH', 'The paid amount does not match the booking fee.');
  end if;

  if p.status in ('CAPTURED', 'REFUNDED', 'PARTIALLY_REFUNDED') then
    if p.gateway_payment_id = p_gateway_payment_id then
      return jsonb_build_object('outcome', 'ALREADY_CONFIRMED', 'appointment_id', a.id,
        'booking_reference', a.booking_reference, 'token_no', a.token_no, 'status', a.status);
    end if;
    -- a second successful payment on the same order: keep for manual review and refund
    perform app.audit(p.hospital_id, 'payment.duplicate_capture', 'payment', p.id::text,
      jsonb_build_object('existing_payment_id', p.gateway_payment_id, 'new_payment_id', p_gateway_payment_id));
    return jsonb_build_object('outcome', 'DUPLICATE_PAYMENT_REVIEW', 'appointment_id', a.id,
      'booking_reference', a.booking_reference, 'token_no', a.token_no, 'status', a.status);
  end if;

  update public.payments
     set status = 'CAPTURED', gateway_payment_id = p_gateway_payment_id, verified_via = p_via,
         verified_at = now(), failure_reason = null
   where id = p.id
  returning * into p;

  select d.full_name into v_doctor from public.doctors d where d.id = a.doctor_id;

  if a.status = 'PAYMENT_PENDING' then
    if q.status in ('CLOSED', 'CANCELLED') or a.session_date < app.hospital_today(a.hospital_id) then
      v_ok := false;
    elsif a.hold_expires_at > now() then
      v_ok := true; -- capacity was reserved by the hold
    else
      v_ok := app.active_token_count(q.id, a.id) < q.online_capacity;
    end if;

    if v_ok then
      v_token := q.last_token_no + 1;
      update public.queue_states set last_token_no = v_token where id = q.id;
      update public.appointments
         set status = 'CONFIRMED', token_no = v_token, hold_expires_at = null, version = version + 1
       where id = a.id
      returning * into a;
      v_outcome := 'CONFIRMED';
      perform app.notify_appointment(a, 'PAYMENT_CONFIRMED', format('Payment received. Token %s confirmed', a.token_no),
        format('Token %s with %s on %s.', a.token_no, v_doctor, to_char(a.session_date, 'DD Mon YYYY')));
    else
      update public.appointments
         set status = 'CANCELLED', cancel_reason = 'Slot no longer available when payment completed',
             cancelled_at = now(), version = version + 1
       where id = a.id
      returning * into a;
      v_refund := app.request_refund_if_paid(a, 'Payment completed after the slot was released', null);
      v_outcome := 'REFUND_REQUIRED';
      perform app.notify_appointment(a, 'PAYMENT_UNMATCHED', 'Payment received, booking not confirmed',
        'Your payment arrived after the slot was released. A refund request has been recorded; its status will update once the payment provider confirms it.');
    end if;
  elsif a.status = 'CANCELLED' then
    -- cancelled while the payment was in flight: never silently restore the token
    v_refund := app.request_refund_if_paid(a, 'Payment received for a cancelled booking', null);
    v_outcome := 'REFUND_REQUIRED';
  else
    v_outcome := 'CONFIRMED';
  end if;

  perform app.refresh_queue_state(q.id);
  perform app.audit(a.hospital_id, 'payment.captured', 'payment', p.id::text,
    jsonb_build_object('via', p_via, 'outcome', v_outcome, 'appointment_id', a.id,
                       'gateway_payment_id', p_gateway_payment_id, 'token_no', a.token_no,
                       'refund_requested', v_refund is not null));
  return jsonb_build_object('outcome', v_outcome, 'appointment_id', a.id, 'booking_reference', a.booking_reference,
                            'token_no', a.token_no, 'status', a.status, 'refund_id', v_refund);
end;
$$;

create or replace function public.svc_confirm_payment(
  p_gateway_order_id text,
  p_gateway_payment_id text,
  p_amount_paise integer,
  p_via text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_service();
  return app.confirm_payment(p_gateway_order_id, p_gateway_payment_id, p_amount_paise, p_via);
end;
$$;

create or replace function app.mark_payment_failed(p_gateway_order_id text, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments%rowtype;
begin
  update public.payments
     set status = 'FAILED', failure_reason = left(coalesce(p_reason, 'Payment failed'), 500)
   where gateway_order_id = p_gateway_order_id and status in ('CREATED', 'AUTHORIZED', 'FAILED')
  returning * into p;
  if not found then
    return 'IGNORED';
  end if;
  -- The hold stays until it expires so the patient can retry on the same order.
  perform app.audit(p.hospital_id, 'payment.failed', 'payment', p.id::text,
    jsonb_build_object('reason', left(p_reason, 200)));
  return 'RECORDED';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Webhook processing: dedupe and apply in one transaction. Business rejections are
--    recorded (HTTP 200, no retry); unexpected errors roll back so Razorpay retries.
-- ---------------------------------------------------------------------------
create or replace function app.complete_refund(p_gateway_refund_id text, p_status public.refund_status, p_error text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.refunds%rowtype;
  a public.appointments%rowtype;
begin
  select * into r from public.refunds where gateway_refund_id = p_gateway_refund_id for update;
  if not found then
    -- our row may not have the gateway id yet; fail with a retryable error
    raise exception using errcode = 'MQ001', message = 'MQ_REFUND_NOT_LINKED_YET';
  end if;
  if r.status = 'PROCESSED' then
    return 'ALREADY_PROCESSED';
  end if;
  update public.refunds
     set status = p_status,
         processed_at = case when p_status = 'PROCESSED' then now() else processed_at end,
         failure_reason = case when p_status = 'FAILED' then left(p_error, 500) else null end
   where id = r.id
  returning * into r;
  if p_status = 'PROCESSED' then
    update public.payments set status = 'REFUNDED' where id = r.payment_id;
  end if;
  select * into a from public.appointments where id = r.appointment_id;
  perform app.audit(r.hospital_id, 'refund.' || lower(p_status::text), 'refund', r.id::text,
    jsonb_build_object('gateway_refund_id', p_gateway_refund_id, 'error', left(p_error, 200)));
  if p_status = 'PROCESSED' then
    perform app.notify_appointment(a, 'REFUND_PROCESSED', 'Refund processed',
      format('Your refund of Rs %s has been processed by the payment provider. Your bank may take 5-7 working days to credit it.',
             to_char(r.amount_paise / 100.0, 'FM999999990.00')));
  end if;
  return p_status::text;
end;
$$;

create or replace function public.svc_process_payment_event(
  p_event_id text,
  p_event_type text,
  p_gateway_order_id text default null,
  p_gateway_payment_id text default null,
  p_gateway_refund_id text default null,
  p_amount_paise integer default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_result text;
  v_out jsonb;
  v_msg text;
begin
  perform app.require_service();
  if nullif(btrim(coalesce(p_event_id, '')), '') is null then
    perform app.fail('MQ_INVALID_REQUEST', 'Missing event id.');
  end if;

  insert into public.payment_events (gateway_event_id, event_type, gateway_order_id, gateway_payment_id,
                                     gateway_refund_id, amount_paise)
  values (p_event_id, p_event_type, p_gateway_order_id, p_gateway_payment_id, p_gateway_refund_id, p_amount_paise)
  on conflict (gateway_event_id) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('duplicate', true);
  end if;

  begin
    case p_event_type
      when 'payment.captured', 'order.paid' then
        if p_gateway_order_id is null or p_gateway_payment_id is null then
          v_result := 'IGNORED_MISSING_IDS';
        elsif not exists (select 1 from public.payments p where p.gateway_order_id = p_gateway_order_id) then
          v_result := 'IGNORED_UNKNOWN_ORDER';
        else
          v_out := app.confirm_payment(p_gateway_order_id, p_gateway_payment_id, p_amount_paise, 'WEBHOOK');
          v_result := v_out ->> 'outcome';
        end if;
      when 'payment.authorized' then
        update public.payments set status = 'AUTHORIZED'
         where gateway_order_id = p_gateway_order_id and status in ('CREATED', 'FAILED');
        v_result := 'RECORDED';
      when 'payment.failed' then
        v_result := app.mark_payment_failed(p_gateway_order_id, p_error);
      when 'refund.processed' then
        v_result := app.complete_refund(p_gateway_refund_id, 'PROCESSED', null);
      when 'refund.failed' then
        v_result := app.complete_refund(p_gateway_refund_id, 'FAILED', p_error);
      else
        v_result := 'IGNORED_EVENT_TYPE';
    end case;
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_msg = message_text;
    v_result := 'REJECTED:' || v_msg;
  end;

  update public.payment_events set processing_result = left(v_result, 200) where id = v_id;
  return jsonb_build_object('duplicate', false, 'result', v_result) || coalesce(v_out, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Refunds: requested by policy/admin, executed by an admin through the Edge Function
-- ---------------------------------------------------------------------------
create or replace function public.request_refund(p_appointment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.appointments%rowtype;
  v_refund uuid;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if not found or not app.is_admin(a.hospital_id) then
    perform app.fail('MQ_FORBIDDEN', 'Administrator access required.');
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    perform app.fail('MQ_REASON_REQUIRED', 'Enter a refund reason.');
  end if;
  perform 1 from public.queue_states where id = a.queue_state_id for update;
  select * into a from public.appointments where id = p_appointment_id for update;
  v_refund := app.request_refund_if_paid(a, btrim(p_reason), auth.uid());
  if v_refund is null then
    perform app.fail('MQ_REFUND_NOT_POSSIBLE', 'There is no captured payment without an open refund for this booking.');
  end if;
  return jsonb_build_object('refund_id', v_refund, 'status', 'REQUESTED');
end;
$$;

create or replace function public.reject_refund(p_refund_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.refunds%rowtype;
begin
  select * into r from public.refunds where id = p_refund_id for update;
  if not found or not app.is_admin(r.hospital_id) then
    perform app.fail('MQ_FORBIDDEN', 'Administrator access required.');
  end if;
  if r.status not in ('REQUESTED', 'FAILED') then
    perform app.fail('MQ_INVALID_TRANSITION', 'Only requested or failed refunds can be rejected.');
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    perform app.fail('MQ_REASON_REQUIRED', 'Enter the reason for rejecting this refund.');
  end if;
  update public.refunds set status = 'REJECTED', failure_reason = left(btrim(p_reason), 500) where id = r.id;
  perform app.audit(r.hospital_id, 'refund.rejected', 'refund', r.id::text, jsonb_build_object('reason', left(p_reason, 200)));
  return jsonb_build_object('refund_id', r.id, 'status', 'REJECTED');
end;
$$;

-- Called by the payments-refund Edge Function on behalf of an admin (p_actor_user_id comes
-- from the verified JWT inside the function).
create or replace function public.svc_begin_refund(p_refund_id uuid, p_actor_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.refunds%rowtype;
  p public.payments%rowtype;
begin
  perform app.require_service();
  select * into r from public.refunds where id = p_refund_id for update;
  if not found then
    perform app.fail('MQ_NOT_FOUND', 'Refund not found.');
  end if;
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = p_actor_user_id and ur.hospital_id = r.hospital_id and ur.role = 'admin'
  ) then
    perform app.fail('MQ_FORBIDDEN', 'Administrator access required.');
  end if;
  if r.status not in ('REQUESTED', 'FAILED') then
    perform app.fail('MQ_INVALID_TRANSITION', format('This refund is already %s.', r.status));
  end if;
  select * into p from public.payments where id = r.payment_id;
  update public.refunds set status = 'PROCESSING', requested_by = coalesce(requested_by, p_actor_user_id)
   where id = r.id;
  insert into public.audit_logs (hospital_id, actor_user_id, actor_role, action, entity_type, entity_id, details)
  values (r.hospital_id, p_actor_user_id, 'admin', 'refund.initiated', 'refund', r.id::text,
          jsonb_build_object('amount_paise', r.amount_paise, 'payment_id', p.id));
  return jsonb_build_object('refund_id', r.id, 'gateway_payment_id', p.gateway_payment_id,
                            'amount_paise', r.amount_paise, 'idempotency_key', r.idempotency_key,
                            'gateway_mode', p.gateway_mode);
end;
$$;

create or replace function public.svc_finish_refund_request(
  p_refund_id uuid,
  p_gateway_refund_id text,
  p_gateway_status text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.refunds%rowtype;
  v_status public.refund_status;
begin
  perform app.require_service();
  select * into r from public.refunds where id = p_refund_id for update;
  if not found then
    perform app.fail('MQ_NOT_FOUND', 'Refund not found.');
  end if;
  if r.status = 'PROCESSED' then
    return jsonb_build_object('refund_id', r.id, 'status', r.status);
  end if;
  v_status := case
    when p_gateway_refund_id is null then 'FAILED'
    when p_gateway_status = 'processed' then 'PROCESSED'
    when p_gateway_status = 'failed' then 'FAILED'
    else 'PROCESSING'
  end;
  update public.refunds
     set gateway_refund_id = coalesce(p_gateway_refund_id, gateway_refund_id)
   where id = r.id;
  if v_status = 'PROCESSED' or (v_status = 'FAILED' and p_gateway_refund_id is not null) then
    perform app.complete_refund(p_gateway_refund_id, v_status, p_error);
  elsif v_status = 'FAILED' then
    update public.refunds set status = 'FAILED', failure_reason = left(coalesce(p_error, 'Refund request failed'), 500)
     where id = r.id;
    perform app.audit(r.hospital_id, 'refund.failed', 'refund', r.id::text, jsonb_build_object('error', left(p_error, 200)));
  end if;
  select * into r from public.refunds where id = p_refund_id;
  return jsonb_build_object('refund_id', r.id, 'status', r.status, 'gateway_refund_id', r.gateway_refund_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Housekeeping (run from pg_cron if available, or from an Edge Function)
-- ---------------------------------------------------------------------------
create or replace function app.expire_payment_holds(p_grace interval default interval '30 minutes')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_q uuid;
  a public.appointments%rowtype;
  v_count integer := 0;
begin
  for v_id, v_q in
    select x.id, x.queue_state_id from public.appointments x
    where x.status = 'PAYMENT_PENDING' and x.hold_expires_at < now() - p_grace
    order by x.queue_state_id
  loop
    perform 1 from public.queue_states where id = v_q for update;
    select * into a from public.appointments where id = v_id for update;
    if a.status = 'PAYMENT_PENDING'
       and not exists (select 1 from public.payments p where p.appointment_id = a.id and p.status in ('AUTHORIZED', 'CAPTURED')) then
      update public.appointments
         set status = 'CANCELLED', cancel_reason = 'Payment window expired', cancelled_at = now(), version = version + 1
       where id = a.id;
      perform app.refresh_queue_state(v_q);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create or replace function app.cleanup_rate_limits()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from app.rate_limits where window_start < now() - interval '1 day';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- In-app notifications are only useful while a visit is current; keep 30 days.
create or replace function app.purge_old_notifications(p_keep_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.notifications where created_at < now() - make_interval(days => greatest(p_keep_days, 7));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Audit retention. Run ONLY after exporting the rows being removed (see docs/operations.md);
-- the free database is 500 MB and audit rows are the largest long-term table.
create or replace function app.purge_audit_logs(p_before date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_before > current_date - 90 then
    perform app.fail('MQ_INVALID_RANGE', 'Audit entries younger than 90 days cannot be purged.');
  end if;
  perform set_config('mediqueue.audit_retention', 'on', true);
  delete from public.audit_logs where created_at < p_before;
  get diagnostics v_count = row_count;
  perform set_config('mediqueue.audit_retention', 'off', true);
  insert into public.audit_logs (hospital_id, actor_user_id, actor_role, action, entity_type, entity_id, details)
  values (null, auth.uid(), app.actor_role(), 'audit.purged', 'audit_logs', null,
          jsonb_build_object('before', p_before, 'rows', v_count));
  return v_count;
end;
$$;

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
    'notifications_purged', app.purge_old_notifications()
  );
end;
$$;
