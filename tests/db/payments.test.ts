import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  anon,
  book,
  createFixture,
  Db,
  expectMqError,
  randomPhone,
  service,
  user,
  type Fixture,
} from './helpers'

const db = new Db(20)
let f: Fixture
afterAll(() => db.close())

beforeAll(async () => {
  f = await createFixture(db, {
    maxTokens: 50,
    hospital: {
      default_booking_fee_paise: 5000,
      online_payments_enabled: true,
      payment_hold_minutes: 15,
    },
  })
})

function hold(patient: string, overrides: Record<string, unknown> = {}) {
  return db.rpc(service, 'svc_hold_paid_booking', {
    p_user_id: patient,
    p_shift_id: f.shiftId,
    p_session_date: f.tomorrow,
    p_patient_name: 'Paying Patient',
    p_patient_phone: randomPhone(),
    p_patient_age: 35,
    p_idempotency_key: randomUUID(),
    p_gateway_mode: 'test',
    ...overrides,
  })
}

async function holdWithOrder(patient: string, overrides: Record<string, unknown> = {}) {
  const h = await hold(patient, overrides)
  const orderId = `order_${randomUUID().slice(0, 12)}`
  await db.rpc(service, 'svc_attach_order', {
    p_payment_id: h.payment_id,
    p_gateway_order_id: orderId,
  })
  return { ...h, orderId }
}

const confirm = (orderId: string, paymentId: string, amount = 5000, via = 'CHECKOUT_SIGNATURE') =>
  db.rpc(service, 'svc_confirm_payment', {
    p_gateway_order_id: orderId,
    p_gateway_payment_id: paymentId,
    p_amount_paise: amount,
    p_via: via,
  })

const webhook = (eventId: string, type: string, extra: Record<string, unknown>) =>
  db.rpc(service, 'svc_process_payment_event', {
    p_event_id: eventId,
    p_event_type: type,
    ...extra,
  })

describe('payment hold', () => {
  it('creates a PAYMENT_PENDING appointment without a token; amount comes from the database', async () => {
    const h = await hold(f.users.patientA)
    expect(h.outcome).toBe('HOLD_CREATED')
    expect(h.status).toBe('PAYMENT_PENDING')
    expect(h.token_no).toBeNull()
    expect(h.amount_paise).toBe(5000)
    expect(h.needs_order).toBe(true)
    expect(h.receipt).toBe(h.booking_reference)
  })

  it('a retried checkout with the same idempotency key reuses the hold and order', async () => {
    const key = randomUUID()
    const phone = randomPhone()
    const first = await hold(f.users.patientA, { p_idempotency_key: key, p_patient_phone: phone })
    await db.rpc(service, 'svc_attach_order', {
      p_payment_id: first.payment_id,
      p_gateway_order_id: 'order_retry_1',
    })
    const retry = await hold(f.users.patientA, { p_idempotency_key: key, p_patient_phone: phone })
    expect(retry.appointment_id).toBe(first.appointment_id)
    expect(retry.gateway_order_id).toBe('order_retry_1')
    expect(retry.needs_order).toBe(false)
    expect(retry.outcome).toBe('HOLD_EXISTS')
    // a different session cannot hijack the checkout
    await expectMqError(
      hold(f.users.patientB, { p_idempotency_key: key, p_patient_phone: phone }),
      'MQ_FORBIDDEN',
    )
  })

  it('cannot attach a second, different order', async () => {
    const h = await holdWithOrder(f.users.patientA)
    await expectMqError(
      db.rpc(service, 'svc_attach_order', {
        p_payment_id: h.payment_id,
        p_gateway_order_id: 'order_other',
      }),
      'MQ_ORDER_CONFLICT',
    )
  })
})

describe('payment confirmation', () => {
  it('a verified payment confirms the booking and allocates the token; repeats are no-ops', async () => {
    const fx = await createFixture(db, {
      hospital: { default_booking_fee_paise: 2000, online_payments_enabled: true },
    })
    const h = await db.rpc(service, 'svc_hold_paid_booking', {
      p_user_id: fx.users.patientA,
      p_shift_id: fx.shiftId,
      p_session_date: fx.today,
      p_patient_name: 'Paid Person',
      p_patient_phone: randomPhone(),
      p_patient_age: 20,
      p_idempotency_key: randomUUID(),
      p_gateway_mode: 'test',
    })
    await db.rpc(service, 'svc_attach_order', {
      p_payment_id: h.payment_id,
      p_gateway_order_id: 'order_ok_1',
    })
    const res = await confirm('order_ok_1', 'pay_ok_1', 2000)
    expect(res).toMatchObject({ outcome: 'CONFIRMED', token_no: 1, status: 'CONFIRMED' })
    const again = await confirm('order_ok_1', 'pay_ok_1', 2000, 'WEBHOOK')
    expect(again.outcome).toBe('ALREADY_CONFIRMED')
    const [{ n }] = await db.sql<{ n: number }>(
      `select count(*)::int as n from public.appointments where queue_state_id = $1`,
      [h.queue_state_id],
    )
    expect(n).toBe(1)
    const view = await db.rpc(anon, 'get_booking', {
      p_booking_reference: h.booking_reference,
      p_access_key: h.access_key,
    })
    expect(view.payment.status).toBe('CAPTURED')
    expect(view.notifications[0].kind).toBe('PAYMENT_CONFIRMED')
  })

  it('a wrong amount never confirms', async () => {
    const h = await holdWithOrder(f.users.patientA)
    await expectMqError(confirm(h.orderId, 'pay_wrong_amount', 100), 'MQ_AMOUNT_MISMATCH')
    const [row] = await db.sql<{ status: string }>(
      `select status from public.appointments where id = $1`,
      [h.appointment_id],
    )
    expect(row!.status).toBe('PAYMENT_PENDING')
  })

  it('a failed payment leaves the booking unconfirmed and holds no token', async () => {
    const h = await holdWithOrder(f.users.patientA)
    const r = await webhook(`evt_${randomUUID()}`, 'payment.failed', {
      p_gateway_order_id: h.orderId,
      p_error: 'Card declined',
    })
    expect(r.result).toBe('RECORDED')
    const [row] = await db.sql<{ status: string; token_no: number | null }>(
      `select status, token_no from public.appointments where id = $1`,
      [h.appointment_id],
    )
    expect(row).toEqual({ status: 'PAYMENT_PENDING', token_no: null })
    const [p] = await db.sql<{ status: string }>(
      `select status from public.payments where id = $1`,
      [h.payment_id],
    )
    expect(p!.status).toBe('FAILED')
  })

  it('a duplicated webhook delivery is processed once', async () => {
    const fx = await createFixture(db, {
      hospital: { default_booking_fee_paise: 3000, online_payments_enabled: true },
    })
    const h = await db.rpc(service, 'svc_hold_paid_booking', {
      p_user_id: fx.users.patientA,
      p_shift_id: fx.shiftId,
      p_session_date: fx.today,
      p_patient_name: 'Webhook Person',
      p_patient_phone: randomPhone(),
      p_patient_age: 50,
      p_idempotency_key: randomUUID(),
      p_gateway_mode: 'test',
    })
    await db.rpc(service, 'svc_attach_order', {
      p_payment_id: h.payment_id,
      p_gateway_order_id: 'order_wh_1',
    })
    const evt = {
      p_gateway_order_id: 'order_wh_1',
      p_gateway_payment_id: 'pay_wh_1',
      p_amount_paise: 3000,
    }
    const results = await Promise.all(
      Array.from({ length: 5 }, () => webhook('evt_dup_1', 'payment.captured', evt)),
    )
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1)
    expect(results.filter((r) => r.duplicate)).toHaveLength(4)
    // a different event for the same payment (order.paid) is idempotent too
    const second = await webhook('evt_dup_2', 'order.paid', evt)
    expect(second.result).toBe('ALREADY_CONFIRMED')
    const [{ n, tokens }] = await db.sql<{ n: number; tokens: number[] }>(
      `select count(*)::int as n, array_agg(token_no) as tokens from public.appointments where queue_state_id = $1`,
      [h.queue_state_id],
    )
    expect(n).toBe(1)
    expect(tokens).toEqual([1])
  })

  it('a webhook for an unknown order is recorded and ignored', async () => {
    const r = await webhook(`evt_${randomUUID()}`, 'payment.captured', {
      p_gateway_order_id: 'order_not_ours',
      p_gateway_payment_id: 'pay_x',
      p_amount_paise: 100,
    })
    expect(r.result).toBe('IGNORED_UNKNOWN_ORDER')
  })

  it('payment arriving after the patient cancelled is not restored; a refund is requested', async () => {
    const h = await holdWithOrder(f.users.patientA)
    await db.rpc(anon, 'cancel_booking', {
      p_booking_reference: h.booking_reference,
      p_access_key: h.access_key,
    })
    const res = await confirm(h.orderId, `pay_${randomUUID().slice(0, 8)}`)
    expect(res.outcome).toBe('REFUND_REQUIRED')
    expect(res.status).toBe('CANCELLED')
    expect(res.token_no).toBeNull()
    const [r] = await db.sql<{ status: string; amount_paise: number }>(
      `select status, amount_paise from public.refunds where appointment_id = $1`,
      [h.appointment_id],
    )
    expect(r).toEqual({ status: 'REQUESTED', amount_paise: 5000 })
  })

  it('payment after the hold expired and the session filled up: refund requested', async () => {
    const fx = await createFixture(db, {
      maxTokens: 1,
      hospital: { default_booking_fee_paise: 5000, online_payments_enabled: true },
    })
    const h = await db.rpc(service, 'svc_hold_paid_booking', {
      p_user_id: fx.users.patientA,
      p_shift_id: fx.shiftId,
      p_session_date: fx.today,
      p_patient_name: 'Slow Payer',
      p_patient_phone: randomPhone(),
      p_patient_age: 50,
      p_idempotency_key: randomUUID(),
      p_gateway_mode: 'test',
    })
    await db.rpc(service, 'svc_attach_order', {
      p_payment_id: h.payment_id,
      p_gateway_order_id: 'order_late_1',
    })
    // hold expires; someone else takes the only slot
    await db.sql(
      `update public.appointments set hold_expires_at = now() - interval '1 minute' where id = $1`,
      [h.appointment_id],
    )
    const other = await db.rpc(service, 'svc_hold_paid_booking', {
      p_user_id: fx.users.patientB,
      p_shift_id: fx.shiftId,
      p_session_date: fx.today,
      p_patient_name: 'Fast Payer',
      p_patient_phone: randomPhone(),
      p_patient_age: 50,
      p_idempotency_key: randomUUID(),
      p_gateway_mode: 'test',
    })
    expect(other.status).toBe('PAYMENT_PENDING')
    const late = await confirm('order_late_1', 'pay_late_1')
    expect(late.outcome).toBe('REFUND_REQUIRED')
    expect(late.status).toBe('CANCELLED')
  })

  it('payment after the hold expired but with capacity left still confirms', async () => {
    const h = await holdWithOrder(f.users.patientA)
    await db.sql(
      `update public.appointments set hold_expires_at = now() - interval '1 minute' where id = $1`,
      [h.appointment_id],
    )
    const res = await confirm(h.orderId, `pay_${randomUUID().slice(0, 8)}`)
    expect(res.outcome).toBe('CONFIRMED')
    expect(res.token_no).toBeGreaterThan(0)
  })
})

describe('cancellation rules', () => {
  it('a patient cancels with the reference + key; capacity is released and audited', async () => {
    const fx = await createFixture(db)
    const b = await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.tomorrow })
    await expectMqError(
      db.rpc(anon, 'cancel_booking', {
        p_booking_reference: b.booking_reference,
        p_access_key: 'wrong',
      }),
      'MQ_NOT_FOUND',
    )
    const res = await db.rpc(anon, 'cancel_booking', {
      p_booking_reference: b.booking_reference,
      p_access_key: b.access_key,
      p_reason: 'Feeling better',
    })
    expect(res).toEqual({
      booking_reference: b.booking_reference,
      status: 'CANCELLED',
      refund_requested: false,
    })
    const [q] = await db.sql<{ issued_count: number }>(
      `select issued_count from public.queue_states where id = $1`,
      [b.queue_state_id],
    )
    expect(q!.issued_count).toBe(0)
    await expectMqError(
      db.rpc(anon, 'cancel_booking', {
        p_booking_reference: b.booking_reference,
        p_access_key: b.access_key,
      }),
      'MQ_CANNOT_CANCEL',
    )
    const [log] = await db.sql<{ details: { reason: string } }>(
      `select details from public.audit_logs where entity_id = $1 and action = 'appointment.cancelled'`,
      [b.appointment_id],
    )
    expect(log!.details.reason).toBe('Feeling better')
  })

  it('the owner can cancel without the key; others cannot', async () => {
    const fx = await createFixture(db)
    const b = await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.tomorrow })
    await expectMqError(
      db.rpc(user(fx.users.patientB), 'cancel_booking', {
        p_booking_reference: b.booking_reference,
      }),
      'MQ_NOT_FOUND',
    )
    const res = await db.rpc(user(fx.users.patientA), 'cancel_booking', {
      p_booking_reference: b.booking_reference,
    })
    expect(res.status).toBe('CANCELLED')
  })

  it('completed or checked-in appointments cannot be cancelled online', async () => {
    const fx = await createFixture(db)
    const b = await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today })
    await db.rpc(user(fx.users.receptionist), 'queue_update_status', {
      p_appointment_id: b.appointment_id,
      p_action: 'ARRIVE',
    })
    const err = await expectMqError(
      db.rpc(anon, 'cancel_booking', {
        p_booking_reference: b.booking_reference,
        p_access_key: b.access_key,
      }),
      'MQ_CANNOT_CANCEL',
    )
    expect(err.hint).toMatch(/reception/)
  })

  it('online cancellation closes at the configured cutoff before the OPD starts', async () => {
    const fx = await createFixture(db, { hospital: { cancel_cutoff_minutes: 60 } })
    // today's all-day session started at 00:00, so the cutoff has passed
    const b = await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today })
    const view = await db.rpc(anon, 'get_booking', {
      p_booking_reference: b.booking_reference,
      p_access_key: b.access_key,
    })
    expect(view.can_cancel).toBe(false)
    await expectMqError(
      db.rpc(anon, 'cancel_booking', {
        p_booking_reference: b.booking_reference,
        p_access_key: b.access_key,
      }),
      'MQ_CANNOT_CANCEL',
    )
  })

  it('a paid cancellation records a refund request but promises nothing', async () => {
    const h = await holdWithOrder(f.users.patientA)
    await confirm(h.orderId, `pay_${randomUUID().slice(0, 8)}`)
    const res = await db.rpc(anon, 'cancel_booking', {
      p_booking_reference: h.booking_reference,
      p_access_key: h.access_key,
    })
    expect(res.refund_requested).toBe(true)
    const view = await db.rpc(anon, 'get_booking', {
      p_booking_reference: h.booking_reference,
      p_access_key: h.access_key,
    })
    expect(view.refund.status).toBe('REQUESTED')
    expect(view.notifications[0].body).toMatch(/once the payment provider confirms/)
  })
})

describe('refund lifecycle', () => {
  it('admin initiates, gateway reports pending, webhook marks processed (once)', async () => {
    const h = await holdWithOrder(f.users.patientA)
    await confirm(h.orderId, `pay_${randomUUID().slice(0, 8)}`)
    await db.rpc(anon, 'cancel_booking', {
      p_booking_reference: h.booking_reference,
      p_access_key: h.access_key,
    })
    const [{ id: refundId }] = await db.sql<{ id: string }>(
      `select id from public.refunds where appointment_id = $1`,
      [h.appointment_id],
    )

    await expectMqError(
      db.rpc(service, 'svc_begin_refund', {
        p_refund_id: refundId,
        p_actor_user_id: f.users.receptionist,
      }),
      'MQ_FORBIDDEN',
    )
    const begin = await db.rpc(service, 'svc_begin_refund', {
      p_refund_id: refundId,
      p_actor_user_id: f.users.admin,
    })
    expect(begin.amount_paise).toBe(5000)
    expect(begin.idempotency_key).toBeTruthy()
    await expectMqError(
      db.rpc(service, 'svc_begin_refund', {
        p_refund_id: refundId,
        p_actor_user_id: f.users.admin,
      }),
      'MQ_INVALID_TRANSITION',
    )

    const pending = await db.rpc(service, 'svc_finish_refund_request', {
      p_refund_id: refundId,
      p_gateway_refund_id: 'rfnd_1',
      p_gateway_status: 'pending',
    })
    expect(pending.status).toBe('PROCESSING')

    const evt = { p_gateway_refund_id: 'rfnd_1' }
    expect((await webhook('evt_rf_1', 'refund.processed', evt)).result).toBe('PROCESSED')
    expect((await webhook('evt_rf_1', 'refund.processed', evt)).duplicate).toBe(true)
    expect((await webhook('evt_rf_2', 'refund.processed', evt)).result).toBe('ALREADY_PROCESSED')

    const [p] = await db.sql<{ status: string }>(
      `select status from public.payments where id = $1`,
      [h.payment_id],
    )
    expect(p!.status).toBe('REFUNDED')
  })

  it('a refund webhook arriving before the refund id is stored is retried, not lost', async () => {
    await expect(
      webhook('evt_rf_early', 'refund.processed', { p_gateway_refund_id: 'rfnd_unknown' }),
    ).rejects.toThrow('MQ_REFUND_NOT_LINKED_YET')
    // the event row rolled back, so Razorpay's retry will be processed
    const rows = await db.sql(
      `select 1 from public.payment_events where gateway_event_id = 'evt_rf_early'`,
    )
    expect(rows).toEqual([])
  })
})

describe('housekeeping', () => {
  it('expires unpaid holds after the grace period and frees capacity', async () => {
    const h = await holdWithOrder(f.users.patientB)
    await db.sql(
      `update public.appointments set hold_expires_at = now() - interval '2 hours' where id = $1`,
      [h.appointment_id],
    )
    const res = await db.rpc(service, 'svc_housekeeping')
    expect(res.expired_holds).toBeGreaterThanOrEqual(1)
    const [row] = await db.sql<{ status: string; cancel_reason: string }>(
      `select status, cancel_reason from public.appointments where id = $1`,
      [h.appointment_id],
    )
    expect(row).toEqual({ status: 'CANCELLED', cancel_reason: 'Payment window expired' })
  })
})

describe('concurrent checkout retries', () => {
  it('three simultaneous create-order calls with one key share a single hold', async () => {
    const key = randomUUID()
    const phone = randomPhone()
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        hold(f.users.patientA, { p_idempotency_key: key, p_patient_phone: phone }),
      ),
    )
    expect(new Set(results.map((r) => r.appointment_id)).size).toBe(1)
    expect(results.filter((r) => r.outcome === 'HOLD_CREATED')).toHaveLength(1)
    expect(results.filter((r) => r.outcome === 'ORDER_IN_PROGRESS')).toHaveLength(2)
  })
})
