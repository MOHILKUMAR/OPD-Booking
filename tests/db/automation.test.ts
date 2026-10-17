import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  anon,
  book,
  createFixture,
  Db,
  expectMqError,
  expectPermissionDenied,
  openSession,
  randomPhone,
  service,
  user,
  type Fixture,
} from './helpers'

const db = new Db()
afterAll(() => db.close())

interface Claimed {
  refund_id: string
  gateway_payment_id: string
  amount_paise: number
  idempotency_key: string
}

/** A confirmed, paid booking for tomorrow, then cancelled by the patient (refund REQUESTED). */
async function paidThenCancelled(f: Fixture) {
  const h = await db.rpc(service, 'svc_hold_paid_booking', {
    p_user_id: f.users.patientA,
    p_shift_id: f.shiftId,
    p_session_date: f.tomorrow,
    p_patient_name: 'Paying Patient',
    p_patient_phone: randomPhone(),
    p_patient_age: 35,
    p_idempotency_key: randomUUID(),
    p_gateway_mode: 'test',
  })
  const orderId = `order_${randomUUID().slice(0, 12)}`
  const paymentId = `pay_${randomUUID().slice(0, 12)}`
  await db.rpc(service, 'svc_attach_order', {
    p_payment_id: h.payment_id,
    p_gateway_order_id: orderId,
  })
  await db.rpc(service, 'svc_confirm_payment', {
    p_gateway_order_id: orderId,
    p_gateway_payment_id: paymentId,
    p_amount_paise: h.amount_paise,
    p_via: 'CHECKOUT_SIGNATURE',
  })
  const cancelled = await db.rpc(anon, 'cancel_booking', {
    p_booking_reference: h.booking_reference,
    p_access_key: h.access_key,
    p_reason: 'Cannot come',
  })
  expect(cancelled.refund_requested).toBe(true)
  const [refund] = await db.sql<{ id: string; status: string }>(
    `select id, status from public.refunds where appointment_id = $1`,
    [h.appointment_id],
  )
  return { ...h, paymentId, refundId: refund!.id }
}

const claim = (mode = 'test') =>
  db.rpc<Claimed[]>(service, 'svc_claim_auto_refunds', { p_gateway_mode: mode, p_limit: 50 })

const refundRow = async (id: string) =>
  (
    await db.sql<{
      status: string
      initiated_via: string | null
      gateway_refund_id: string | null
    }>(`select status, initiated_via, gateway_refund_id from public.refunds where id = $1`, [id])
  )[0]!

const paidHospital = (extra: Record<string, unknown> = {}) =>
  createFixture(db, {
    hospital: {
      default_booking_fee_paise: 5000,
      online_payments_enabled: true,
      cancel_cutoff_minutes: 0,
      ...extra,
    },
  })

describe('automatic refunds', () => {
  let f: Fixture
  beforeAll(async () => {
    f = await paidHospital({ auto_refund_enabled: true })
  })

  it('claims a patient-cancellation refund once, for the gateway mode in use', async () => {
    const p = await paidThenCancelled(f)
    expect((await claim('live')).find((c) => c.refund_id === p.refundId)).toBeUndefined()
    const claimed = (await claim()).find((c) => c.refund_id === p.refundId)
    expect(claimed).toMatchObject({ gateway_payment_id: p.paymentId, amount_paise: 5000 })
    expect(claimed!.idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
    expect(await refundRow(p.refundId)).toMatchObject({
      status: 'PROCESSING',
      initiated_via: 'AUTO',
    })
    expect((await claim()).find((c) => c.refund_id === p.refundId)).toBeUndefined()

    const [audit] = await db.sql(
      `select actor_role, details from public.audit_logs where action = 'refund.initiated' and entity_id = $1`,
      [p.refundId],
    )
    expect(audit).toMatchObject({
      actor_role: 'system',
      details: { auto: true, amount_paise: 5000 },
    })

    // an administrator cannot start the same refund again
    await expectMqError(
      db.rpc(service, 'svc_begin_refund', {
        p_refund_id: p.refundId,
        p_actor_user_id: f.users.admin,
      }),
      'MQ_INVALID_TRANSITION',
    )
  })

  it('tells the patient when Razorpay accepts it and when it is processed', async () => {
    const p = await paidThenCancelled(f)
    await claim()
    await db.rpc(service, 'svc_finish_refund_request', {
      p_refund_id: p.refundId,
      p_gateway_refund_id: `rfnd_${randomUUID().slice(0, 10)}`,
      p_gateway_status: 'pending',
    })
    const view = await db.rpc(anon, 'get_booking', {
      p_booking_reference: p.booking_reference,
      p_access_key: p.access_key,
    })
    const initiated = view.notifications.find(
      (n: { kind: string }) => n.kind === 'REFUND_INITIATED',
    )
    expect(initiated).toMatchObject({ title: 'Refund initiated', data: { amount_paise: 5000 } })
    expect(view.refund.status).toBe('PROCESSING')

    const { gateway_refund_id } = await refundRow(p.refundId)
    await db.rpc(service, 'svc_process_payment_event', {
      p_event_id: `evt_${randomUUID()}`,
      p_event_type: 'refund.processed',
      p_gateway_refund_id: gateway_refund_id,
      p_gateway_payment_id: p.paymentId,
      p_amount_paise: 5000,
    })
    expect((await refundRow(p.refundId)).status).toBe('PROCESSED')
    const [payment] = await db.sql(
      `select status from public.payments where gateway_payment_id = $1`,
      [p.paymentId],
    )
    expect(payment).toEqual({ status: 'REFUNDED' })
  })

  it('a rejected gateway call leaves the refund FAILED for an administrator', async () => {
    const p = await paidThenCancelled(f)
    await claim()
    await db.rpc(service, 'svc_finish_refund_request', {
      p_refund_id: p.refundId,
      p_gateway_refund_id: null,
      p_gateway_status: null,
      p_error: 'The amount is invalid',
    })
    expect(await refundRow(p.refundId)).toMatchObject({ status: 'FAILED', initiated_via: 'AUTO' })
    // failed automatic attempts are not retried automatically
    expect((await claim()).find((c) => c.refund_id === p.refundId)).toBeUndefined()
    // ... but an administrator can retry (same idempotency key)
    const begun = await db.rpc(service, 'svc_begin_refund', {
      p_refund_id: p.refundId,
      p_actor_user_id: f.users.admin,
    })
    expect(begun.refund_id).toBe(p.refundId)
    expect((await refundRow(p.refundId)).initiated_via).toBe('ADMIN')
  })

  it('leaves refunds above the limit, and hospitals without the setting, to an administrator', async () => {
    const capped = await paidHospital({ auto_refund_enabled: true, auto_refund_max_paise: 3000 })
    const big = await paidThenCancelled(capped)
    const manual = await paidHospital()
    const off = await paidThenCancelled(manual)
    const ids = (await claim()).map((c) => c.refund_id)
    expect(ids).not.toContain(big.refundId)
    expect(ids).not.toContain(off.refundId)
    expect((await refundRow(big.refundId)).status).toBe('REQUESTED')
    expect((await refundRow(off.refundId)).status).toBe('REQUESTED')
  })

  it('only the service role can claim refunds', async () => {
    await expectPermissionDenied(
      db.query(user(f.users.admin), `select public.svc_claim_auto_refunds('test', 5)`),
    )
    await expectMqError(db.sql(`select public.svc_claim_auto_refunds('test', 5)`), 'MQ_FORBIDDEN')
    await expectPermissionDenied(db.query(user(f.users.admin), `select app.kick_automation()`))
  })
})

async function openSessionWithBooking(f: Fixture) {
  const b = await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today })
  await openSession(db, f)
  return b
}

describe('SMS/WhatsApp queue', () => {
  it('queues an SMS copy that only the service role can claim; it never shows in the app', async () => {
    const f = await createFixture(db, { hospital: { sms_alerts_enabled: true } })
    const first = await openSessionWithBooking(f)
    const [sms] = await db.sql<{ id: string; status: string; body: string }>(
      `select id, status, body from public.notifications
       where appointment_id = $1 and kind = 'TURN_NEAR' and channel = 'SMS'`,
      [first.appointment_id],
    )
    expect(sms!.status).toBe('PENDING')
    expect(sms!.body).toMatch(/^Test Hospital: Token 1, your turn is near/)
    const view = await db.rpc(anon, 'get_booking', {
      p_booking_reference: first.booking_reference,
      p_access_key: first.access_key,
    })
    expect(view.notifications.map((n: { kind: string }) => n.kind)).toEqual(['TURN_NEAR', 'BOOKED']) // in-app copy only

    // patients and staff cannot read or claim the outbound copy
    expect(
      await db.query(
        user(f.users.patientA, { isAnonymous: true }),
        `select id from public.notifications where id = $1`,
        [sms!.id],
      ),
    ).toEqual([])
    await expectPermissionDenied(
      db.query(user(f.users.admin), `select public.svc_claim_outbound_notifications(5)`),
    )

    const claimed = await db.rpc<{ id: string; phone: string; text: string }[]>(
      service,
      'svc_claim_outbound_notifications',
      { p_limit: 100 },
    )
    const mine = claimed.find((c) => c.id === sms!.id)
    expect(mine).toMatchObject({ kind: 'TURN_NEAR', channel: 'SMS', text: sms!.body })
    expect(mine!.phone).toMatch(/^[6-9]\d{9}$/)
    // claimed rows are not handed out twice while a send is in progress
    const again = await db.rpc<{ id: string }[]>(service, 'svc_claim_outbound_notifications', {
      p_limit: 100,
    })
    expect(again.find((c) => c.id === sms!.id)).toBeUndefined()

    await db.rpc(service, 'svc_finish_outbound_notification', {
      p_id: sms!.id,
      p_ok: false,
      p_error: 'No provider',
    })
    const [done] = await db.sql(`select status, error from public.notifications where id = $1`, [
      sms!.id,
    ])
    expect(done).toEqual({ status: 'FAILED', error: 'No provider' })
  })
})

describe('automation wake-up (pg_cron -> pg_net -> Edge Function)', () => {
  afterAll(async () => {
    await db.sql(`drop schema if exists net cascade; drop schema if exists vault cascade;`)
  })

  it('calls the Edge Function only when there is work and the Vault secrets exist', async () => {
    const f = await paidHospital({ auto_refund_enabled: true })
    await claim() // drain anything left by other tests in this file
    const kick = async () =>
      (await db.sql<{ r: string }>(`select app.kick_automation() as r`))[0]!.r
    expect(await kick()).toBe('IDLE')

    await paidThenCancelled(f)
    expect(await kick()).toBe('NOT_CONFIGURED') // no pg_net in this database

    // Stand-ins for Supabase's pg_net and Vault
    await db.sql(`
      create schema net;
      create table net.calls (url text, body jsonb, headers jsonb, timeout_milliseconds integer);
      create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer)
      returns bigint language sql as
        $$ insert into net.calls values (url, body, headers, timeout_milliseconds) returning 1::bigint $$;
      create schema vault;
      create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
    `)
    expect(await kick()).toBe('NOT_CONFIGURED') // secrets missing
    await db.sql(`insert into vault.decrypted_secrets values
      ('mediqueue_automation_url', 'https://example.supabase.co/functions/v1/automation'),
      ('mediqueue_automation_token', 'test-token-0123456789abcdef')`)
    expect(await kick()).toBe('TRIGGERED')
    const [call] = await db.sql<{ url: string; headers: Record<string, string> }>(
      `select url, headers from net.calls`,
    )
    expect(call!.url).toBe('https://example.supabase.co/functions/v1/automation')
    expect(call!.headers['x-automation-token']).toBe('test-token-0123456789abcdef')

    await claim()
    expect(await kick()).toBe('IDLE')
  })
})
