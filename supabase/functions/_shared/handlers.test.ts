// @vitest-environment node
import { createHmac, randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  accessTokenAal,
  automationHandler,
  createOrderHandler,
  createStaffHandler,
  housekeepingHandler,
  refundHandler,
  verifyPaymentHandler,
  webhookHandler,
  type Caller,
  type Deps,
} from './handlers.ts'
import { loadConfig } from './http.ts'
import { createMessageSender, type OutboundMessage } from './messaging.ts'
import { GatewayError, type RazorpayClient } from './razorpay.ts'

const ORIGIN = 'https://mediqueue.pages.dev'
const KEY_SECRET = 'rzp_secret_for_tests'
const WEBHOOK_SECRET = 'webhook_secret_for_tests'
const sign = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('hex')

function makeDeps(
  overrides: {
    env?: Record<string, string>
    rpc?: Record<string, (args: Record<string, unknown>) => unknown>
    user?: (Pick<Caller, 'id' | 'isAnonymous'> & Partial<Caller>) | null
  } = {},
) {
  const env: Record<string, string> = {
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
    PAYMENTS_ENABLED: 'true',
    RAZORPAY_MODE: 'test',
    RAZORPAY_KEY_ID: 'rzp_test_abc',
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    HOUSEKEEPING_TOKEN: 'a-very-long-housekeeping-token-123',
    ...overrides.env,
  }
  const rpcImpl = overrides.rpc ?? {}
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    const impl = rpcImpl[fn]
    if (!impl) throw new Error(`unexpected rpc ${fn}`)
    return impl(args ?? {})
  })
  const razorpay = {
    createOrder: vi.fn(async (i: { amount: number; currency: string }) => ({
      id: 'order_TEST123456',
      amount: i.amount,
      currency: i.currency,
      receipt: 'r',
      status: 'created',
    })),
    fetchPayment: vi.fn(async (id: string) => ({
      id,
      order_id: 'order_TEST123456',
      amount: 5000,
      currency: 'INR',
      status: 'captured' as const,
    })),
    capturePayment: vi.fn(async (id: string, amount: number, currency: string) => ({
      id,
      order_id: 'order_TEST123456',
      amount,
      currency,
      status: 'captured' as const,
    })),
    createRefund: vi.fn(async () => ({
      id: 'rfnd_TEST1',
      payment_id: 'pay_TEST123456',
      amount: 5000,
      status: 'pending' as const,
    })),
  } satisfies RazorpayClient
  const authAdmin = { createUser: vi.fn(async () => ({ id: 'new-user-id' })) }
  const user: Caller | null =
    overrides.user === null
      ? null
      : {
          id: 'user-1',
          isAnonymous: true,
          aal: 'aal1',
          hasVerifiedFactor: false,
          ...overrides.user,
        }
  const deps: Deps = {
    cfg: loadConfig((k) => env[k]),
    db: { rpc: rpc as Deps['db']['rpc'] },
    auth: { getUser: vi.fn(async (token: string) => (token === 'valid-token' ? user : null)) },
    razorpay,
    authAdmin,
    log: () => {},
  }
  return { deps, rpc, razorpay, authAdmin }
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://x.supabase.co/functions/v1/fn', {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      authorization: 'Bearer valid-token',
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const bookingBody = () => ({
  shift_id: randomUUID(),
  session_date: '2026-10-17',
  patient_name: 'Asha Rao',
  patient_phone: '+91 98765 43210',
  patient_age: 34,
  idempotency_key: randomUUID(),
})

const hold = (over: Record<string, unknown> = {}) => ({
  outcome: 'HOLD_CREATED',
  appointment_id: 'appt-1',
  booking_reference: 'MQ-ABCDEFGH',
  access_key: 'k'.repeat(32),
  payment_id: 'payment-1',
  gateway_order_id: null,
  receipt: 'MQ-ABCDEFGH',
  amount_paise: 5000,
  currency: 'INR',
  needs_order: true,
  hold_expires_at: '2026-10-17T10:00:00Z',
  status: 'PAYMENT_PENDING',
  ...over,
})

describe('config', () => {
  it('refuses live keys in test mode and vice versa', () => {
    expect(() =>
      loadConfig((k) => ({ RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_live_x' })[k]),
    ).toThrow(/does not match/)
    expect(() =>
      loadConfig((k) => ({ RAZORPAY_MODE: 'live', RAZORPAY_KEY_ID: 'rzp_test_x' })[k]),
    ).toThrow(/does not match/)
  })
})

describe('payments-create-order', () => {
  it('answers CORS preflight only for allowed origins', async () => {
    const { deps } = makeDeps()
    const ok = await createOrderHandler(deps)(
      new Request('https://x/fn', { method: 'OPTIONS', headers: { origin: ORIGIN } }),
    )
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const bad = await createOrderHandler(deps)(
      post(bookingBody(), { origin: 'https://evil.example' }),
    )
    expect(bad.status).toBe(403)
  })

  it('is disabled unless PAYMENTS_ENABLED=true', async () => {
    const { deps, rpc } = makeDeps({ env: { PAYMENTS_ENABLED: 'false' } })
    const res = await createOrderHandler(deps)(post(bookingBody()))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('PAYMENTS_DISABLED')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires a valid session and a valid body', async () => {
    const { deps } = makeDeps()
    expect(
      (await createOrderHandler(deps)(post(bookingBody(), { authorization: 'Bearer nope' })))
        .status,
    ).toBe(401)
    const res = await createOrderHandler(deps)(post({ ...bookingBody(), patient_phone: '123' }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/mobile/)
  })

  it('creates the order with the amount from the database, never from the request', async () => {
    const { deps, rpc, razorpay } = makeDeps({
      rpc: { svc_hold_paid_booking: () => hold(), svc_attach_order: () => ({}) },
    })
    const res = await createOrderHandler(deps)(post({ ...bookingBody(), amount_paise: 1 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      status: 'ORDER_CREATED',
      key_id: 'rzp_test_abc',
      order_id: 'order_TEST123456',
      amount_paise: 5000,
    })
    expect(body.booking.booking_reference).toBe('MQ-ABCDEFGH')
    expect(body.booking).not.toHaveProperty('payment_id')
    expect(razorpay.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 5000, receipt: 'MQ-ABCDEFGH' }),
    )
    const holdArgs = rpc.mock.calls.find((c) => c[0] === 'svc_hold_paid_booking')![1]!
    expect(holdArgs).toMatchObject({
      p_user_id: 'user-1',
      p_patient_phone: '9876543210',
      p_gateway_mode: 'test',
    })
    expect(holdArgs).not.toHaveProperty('p_amount_paise')
  })

  it('does not ask patients for an authenticator code', async () => {
    const { deps } = makeDeps({
      user: { id: 'user-1', isAnonymous: false, aal: 'aal1', hasVerifiedFactor: true },
      rpc: { svc_hold_paid_booking: () => hold(), svc_attach_order: () => ({}) },
    })
    expect((await createOrderHandler(deps)(post(bookingBody()))).status).toBe(200)
  })

  it('a retried checkout reuses the existing order (no second order at Razorpay)', async () => {
    const { deps, razorpay } = makeDeps({
      rpc: {
        svc_hold_paid_booking: () =>
          hold({ outcome: 'HOLD_EXISTS', needs_order: false, gateway_order_id: 'order_EXISTING1' }),
      },
    })
    const body = await (await createOrderHandler(deps)(post(bookingBody()))).json()
    expect(body.order_id).toBe('order_EXISTING1')
    expect(razorpay.createOrder).not.toHaveBeenCalled()
  })

  it('a concurrent duplicate gets 409 ORDER_IN_PROGRESS', async () => {
    const { deps } = makeDeps({
      rpc: {
        svc_hold_paid_booking: () => hold({ outcome: 'ORDER_IN_PROGRESS', needs_order: false }),
      },
    })
    const res = await createOrderHandler(deps)(post(bookingBody()))
    expect(res.status).toBe(409)
  })

  it('maps database business errors (e.g. full session) to 400 with the patient-safe hint', async () => {
    const { deps } = makeDeps({
      rpc: {
        svc_hold_paid_booking: () => {
          throw {
            message: 'MQ_SESSION_UNAVAILABLE',
            hint: 'All tokens for this session have been booked.',
          }
        },
      },
    })
    const res = await createOrderHandler(deps)(post(bookingBody()))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      code: 'MQ_SESSION_UNAVAILABLE',
      message: 'All tokens for this session have been booked.',
    })
  })

  it('never leaks internal errors', async () => {
    const { deps } = makeDeps({
      rpc: {
        svc_hold_paid_booking: () => {
          throw new Error('connection refused to 10.0.0.5')
        },
      },
    })
    const res = await createOrderHandler(deps)(post(bookingBody()))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.5')
  })
})

describe('payments-verify', () => {
  const body = (sig?: string) => ({
    razorpay_order_id: 'order_TEST123456',
    razorpay_payment_id: 'pay_TEST123456',
    razorpay_signature: sig ?? sign(KEY_SECRET, 'order_TEST123456|pay_TEST123456'),
  })

  it('rejects a forged signature without touching the database', async () => {
    const { deps, rpc, razorpay } = makeDeps()
    const res = await verifyPaymentHandler(deps)(post(body('0'.repeat(64))))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_SIGNATURE')
    expect(rpc).not.toHaveBeenCalled()
    expect(razorpay.fetchPayment).not.toHaveBeenCalled()
  })

  it('confirms using the amount reported by Razorpay', async () => {
    const { deps, rpc } = makeDeps({
      rpc: { svc_confirm_payment: () => ({ outcome: 'CONFIRMED', token_no: 7 }) },
    })
    const res = await verifyPaymentHandler(deps)(post(body()))
    expect(await res.json()).toEqual({ outcome: 'CONFIRMED', token_no: 7 })
    expect(rpc).toHaveBeenCalledWith('svc_confirm_payment', {
      p_gateway_order_id: 'order_TEST123456',
      p_gateway_payment_id: 'pay_TEST123456',
      p_amount_paise: 5000,
      p_via: 'CHECKOUT_SIGNATURE',
    })
  })

  it('captures an authorized payment first; refuses failed payments', async () => {
    const { deps, razorpay } = makeDeps({
      rpc: { svc_confirm_payment: () => ({ outcome: 'CONFIRMED' }) },
    })
    razorpay.fetchPayment.mockResolvedValueOnce({
      id: 'pay_TEST123456',
      order_id: 'order_TEST123456',
      amount: 5000,
      currency: 'INR',
      status: 'authorized' as never,
    })
    expect((await verifyPaymentHandler(deps)(post(body()))).status).toBe(200)
    expect(razorpay.capturePayment).toHaveBeenCalledWith('pay_TEST123456', 5000, 'INR')

    razorpay.fetchPayment.mockResolvedValueOnce({
      id: 'pay_TEST123456',
      order_id: 'order_TEST123456',
      amount: 5000,
      currency: 'INR',
      status: 'failed' as never,
    })
    expect((await verifyPaymentHandler(deps)(post(body()))).status).toBe(402)
  })

  it('rejects a payment that belongs to another order', async () => {
    const { deps, razorpay, rpc } = makeDeps()
    razorpay.fetchPayment.mockResolvedValueOnce({
      id: 'pay_TEST123456',
      order_id: 'order_SOMEONEELSE',
      amount: 5000,
      currency: 'INR',
      status: 'captured',
    })
    expect((await verifyPaymentHandler(deps)(post(body()))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns 502 (not success) when Razorpay is unreachable', async () => {
    const { deps, razorpay, rpc } = makeDeps()
    razorpay.fetchPayment.mockRejectedValueOnce(new GatewayError(503, 'Service unavailable'))
    expect((await verifyPaymentHandler(deps)(post(body()))).status).toBe(502)
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('payments-webhook', () => {
  const event = {
    event: 'payment.captured',
    payload: {
      payment: { entity: { id: 'pay_W1', order_id: 'order_W1', amount: 5000, status: 'captured' } },
    },
  }
  const deliver = (raw: string, headers: Record<string, string>) =>
    new Request('https://x/payments-webhook', { method: 'POST', headers, body: raw })

  it('rejects unsigned or badly signed deliveries', async () => {
    const { deps, rpc } = makeDeps()
    const raw = JSON.stringify(event)
    expect(
      (await webhookHandler(deps)(deliver(raw, { 'x-razorpay-event-id': 'evt_1' }))).status,
    ).toBe(401)
    expect(
      (
        await webhookHandler(deps)(
          deliver(raw, {
            'x-razorpay-signature': sign('other', raw),
            'x-razorpay-event-id': 'evt_1',
          }),
        )
      ).status,
    ).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('passes the event id and entity ids to the idempotent DB processor', async () => {
    let seen = false
    const { deps, rpc } = makeDeps({
      rpc: {
        svc_process_payment_event: () => {
          const dup = seen
          seen = true
          return { duplicate: dup, result: dup ? undefined : 'CONFIRMED' }
        },
      },
    })
    const raw = JSON.stringify(event)
    const headers = {
      'x-razorpay-signature': sign(WEBHOOK_SECRET, raw),
      'x-razorpay-event-id': 'evt_1',
    }
    const first = await webhookHandler(deps)(deliver(raw, headers))
    const second = await webhookHandler(deps)(deliver(raw, headers))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(await second.json()).toMatchObject({ duplicate: true })
    expect(rpc).toHaveBeenCalledWith('svc_process_payment_event', {
      p_event_id: 'evt_1',
      p_event_type: 'payment.captured',
      p_gateway_order_id: 'order_W1',
      p_gateway_payment_id: 'pay_W1',
      p_gateway_refund_id: null,
      p_amount_paise: 5000,
      p_error: null,
    })
  })

  it('returns 5xx so Razorpay retries when processing fails', async () => {
    const { deps } = makeDeps({
      rpc: {
        svc_process_payment_event: () => {
          throw { message: 'MQ_REFUND_NOT_LINKED_YET', code: 'MQ001' }
        },
      },
    })
    const raw = JSON.stringify({
      event: 'refund.processed',
      payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1', amount: 5000 } } },
    })
    const res = await webhookHandler(deps)(
      deliver(raw, {
        'x-razorpay-signature': sign(WEBHOOK_SECRET, raw),
        'x-razorpay-event-id': 'evt_9',
      }),
    )
    expect(res.status).toBe(500)
  })

  it('requires the event id header for dedupe', async () => {
    const { deps } = makeDeps()
    const raw = JSON.stringify(event)
    expect(
      (
        await webhookHandler(deps)(
          deliver(raw, { 'x-razorpay-signature': sign(WEBHOOK_SECRET, raw) }),
        )
      ).status,
    ).toBe(400)
  })
})

describe('payments-refund', () => {
  const refundId = randomUUID()

  it('requires a signed-in (non-anonymous) admin; the database decides admin rights', async () => {
    const anonymous = makeDeps()
    expect((await refundHandler(anonymous.deps)(post({ refund_id: refundId }))).status).toBe(403)
    const notAdmin = makeDeps({
      user: { id: 'reception-1', isAnonymous: false },
      rpc: {
        svc_begin_refund: () => {
          throw { message: 'MQ_FORBIDDEN', hint: 'Administrator access required.' }
        },
      },
    })
    expect((await refundHandler(notAdmin.deps)(post({ refund_id: refundId }))).status).toBe(403)
    expect(notAdmin.razorpay.createRefund).not.toHaveBeenCalled()
  })

  it('requires an aal2 token from an admin with an authenticator, like app.mfa_satisfied()', async () => {
    const run = async (mfa: Pick<Caller, 'aal' | 'hasVerifiedFactor'>) => {
      const t = makeDeps({
        user: { id: 'admin-1', isAnonymous: false, ...mfa },
        rpc: {
          svc_begin_refund: () => ({
            refund_id: refundId,
            gateway_payment_id: 'pay_1',
            amount_paise: 5000,
            idempotency_key: 'idem-key-123456',
          }),
          svc_finish_refund_request: () => ({ status: 'PROCESSING' }),
        },
      })
      return { ...t, res: await refundHandler(t.deps)(post({ refund_id: refundId })) }
    }

    const passwordOnly = await run({ aal: 'aal1', hasVerifiedFactor: true })
    expect(passwordOnly.res.status).toBe(403)
    expect(await passwordOnly.res.json()).toEqual({
      code: 'MQ_FORBIDDEN',
      message: 'Sign out and sign in again with your authenticator code.',
    })
    expect(passwordOnly.rpc).not.toHaveBeenCalled()
    expect(passwordOnly.razorpay.createRefund).not.toHaveBeenCalled()
    expect((await run({ aal: null, hasVerifiedFactor: true })).res.status).toBe(403)

    expect((await run({ aal: 'aal2', hasVerifiedFactor: true })).res.status).toBe(200)
    // No authenticator added: unchanged, the database alone decides admin rights.
    expect((await run({ aal: 'aal1', hasVerifiedFactor: false })).res.status).toBe(200)
  })

  beforeEach(() => vi.clearAllMocks())

  it('records gateway status, or the failure, without claiming success', async () => {
    const begin = {
      refund_id: refundId,
      gateway_payment_id: 'pay_1',
      amount_paise: 5000,
      idempotency_key: 'idem-key-123456',
    }
    const ok = makeDeps({
      user: { id: 'admin-1', isAnonymous: false },
      rpc: {
        svc_begin_refund: () => begin,
        svc_finish_refund_request: (a) => ({
          status: a.p_gateway_status === 'pending' ? 'PROCESSING' : 'FAILED',
        }),
      },
    })
    expect(await (await refundHandler(ok.deps)(post({ refund_id: refundId }))).json()).toEqual({
      status: 'PROCESSING',
    })
    expect(ok.razorpay.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'idem-key-123456', amount: 5000 }),
    )

    const failing = makeDeps({
      user: { id: 'admin-1', isAnonymous: false },
      rpc: {
        svc_begin_refund: () => begin,
        svc_finish_refund_request: () => ({ status: 'FAILED' }),
      },
    })
    failing.razorpay.createRefund.mockRejectedValueOnce(
      new GatewayError(400, 'The payment has been fully refunded already'),
    )
    const res = await refundHandler(failing.deps)(post({ refund_id: refundId }))
    expect(res.status).toBe(502)
    expect(failing.rpc).toHaveBeenCalledWith(
      'svc_finish_refund_request',
      expect.objectContaining({
        p_gateway_refund_id: null,
        p_error: 'The payment has been fully refunded already',
      }),
    )
  })
})

describe('admin-create-staff', () => {
  const body = {
    hospital_id: randomUUID(),
    email: 'reception@example.com',
    password: 'Temp-Password-123',
    full_name: 'Desk One',
    role: 'receptionist',
  }

  it('checks admin rights before creating any Auth user', async () => {
    const { deps, authAdmin } = makeDeps({
      user: { id: 'u', isAnonymous: false },
      rpc: { svc_is_admin: () => false },
    })
    expect((await createStaffHandler(deps)(post(body))).status).toBe(403)
    expect(authAdmin.createUser).not.toHaveBeenCalled()
  })

  it('creates the user and grants the role with the admin as actor; reuses existing emails', async () => {
    const { deps, rpc, authAdmin } = makeDeps({
      user: { id: 'admin-1', isAnonymous: false },
      rpc: {
        svc_is_admin: () => true,
        svc_grant_staff_role: () => ({}),
        svc_find_user_by_email: () => 'existing-user',
      },
    })
    expect(await (await createStaffHandler(deps)(post(body))).json()).toEqual({
      user_id: 'new-user-id',
      created: true,
    })
    expect(rpc).toHaveBeenCalledWith(
      'svc_grant_staff_role',
      expect.objectContaining({
        p_actor_user_id: 'admin-1',
        p_user_id: 'new-user-id',
        p_role: 'receptionist',
      }),
    )
    authAdmin.createUser.mockResolvedValueOnce(null as never)
    expect(await (await createStaffHandler(deps)(post(body))).json()).toEqual({
      user_id: 'existing-user',
      created: false,
    })
  })

  it('validates role/doctor combinations', async () => {
    const { deps } = makeDeps({ user: { id: 'admin-1', isAnonymous: false } })
    expect((await createStaffHandler(deps)(post({ ...body, role: 'doctor' }))).status).toBe(400)
  })

  it('requires an aal2 token from an admin with an authenticator, like app.mfa_satisfied()', async () => {
    const run = async (mfa: Pick<Caller, 'aal' | 'hasVerifiedFactor'>) => {
      const t = makeDeps({
        user: { id: 'admin-1', isAnonymous: false, ...mfa },
        rpc: { svc_is_admin: () => true, svc_grant_staff_role: () => ({}) },
      })
      return { ...t, res: await createStaffHandler(t.deps)(post({ ...body, role: 'admin' })) }
    }

    const passwordOnly = await run({ aal: 'aal1', hasVerifiedFactor: true })
    expect(passwordOnly.res.status).toBe(403)
    expect(await passwordOnly.res.json()).toEqual({
      code: 'MQ_FORBIDDEN',
      message: 'Sign out and sign in again with your authenticator code.',
    })
    expect(passwordOnly.rpc).not.toHaveBeenCalled()
    expect(passwordOnly.authAdmin.createUser).not.toHaveBeenCalled()

    const withCode = await run({ aal: 'aal2', hasVerifiedFactor: true })
    expect(await withCode.res.json()).toEqual({ user_id: 'new-user-id', created: true })
    // No authenticator added: unchanged, svc_is_admin alone decides.
    const noFactor = await run({ aal: 'aal1', hasVerifiedFactor: false })
    expect(noFactor.res.status).toBe(200)
    expect(noFactor.rpc).toHaveBeenCalledWith('svc_is_admin', expect.anything())
  })
})

describe('accessTokenAal', () => {
  const token = (claims: object) =>
    [{ alg: 'ES256', typ: 'JWT' }, claims]
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.') + '.signature'

  it('reads the aal claim (base64url, unpadded, UTF-8 metadata)', () => {
    expect(accessTokenAal(token({ sub: 'u', aal: 'aal2' }))).toBe('aal2')
    expect(
      accessTokenAal(token({ sub: 'u', aal: 'aal1', user_metadata: { name: 'आशा ~?>' } })),
    ).toBe('aal1')
  })

  it('returns null when the claim is missing or the token is unreadable', () => {
    expect(accessTokenAal(token({ sub: 'u' }))).toBeNull()
    expect(accessTokenAal(token({ sub: 'u', aal: 2 }))).toBeNull()
    expect(accessTokenAal('valid-token')).toBeNull()
    expect(accessTokenAal('a.!!!.c')).toBeNull()
  })
})

describe('housekeeping', () => {
  it('requires the shared token', async () => {
    const { deps } = makeDeps({ rpc: { svc_housekeeping: () => ({ expired_holds: 0 }) } })
    const call = (token?: string) =>
      housekeepingHandler(deps)(
        new Request('https://x/housekeeping', {
          method: 'POST',
          headers: token ? { 'x-housekeeping-token': token } : {},
        }),
      )
    expect((await call()).status).toBe(401)
    expect((await call('wrong')).status).toBe(401)
    expect((await call('a-very-long-housekeeping-token-123')).status).toBe(200)
  })
})

describe('automation (auto refunds + queued SMS)', () => {
  const TOKEN = 'automation-token-0123456789abcdef'
  const call = (deps: Deps, token: string | null = TOKEN, method = 'POST') =>
    automationHandler(deps)(
      new Request('https://x/automation', {
        method,
        headers: token ? { 'x-automation-token': token } : {},
      }),
    )
  const claimed = [
    {
      refund_id: 'ref-1',
      gateway_payment_id: 'pay_1',
      amount_paise: 5000,
      idempotency_key: '11111111-1111-4111-8111-111111111111',
    },
    {
      refund_id: 'ref-2',
      gateway_payment_id: 'pay_2',
      amount_paise: 2000,
      idempotency_key: '22222222-2222-4222-8222-222222222222',
    },
  ]

  it('requires the shared token and POST', async () => {
    const { deps, rpc } = makeDeps({ env: { AUTOMATION_TOKEN: TOKEN } })
    expect((await call(deps, null)).status).toBe(401)
    expect((await call(deps, 'automation-token-0123456789abcdeX')).status).toBe(401)
    expect((await call(deps, TOKEN, 'GET')).status).toBe(405)
    const { deps: unset } = makeDeps()
    expect((await call(unset)).status).toBe(503)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('sends claimed refunds to Razorpay with their own idempotency keys', async () => {
    const finish = vi.fn((a: Record<string, unknown>) => ({ refund_id: a.p_refund_id }))
    const { deps, razorpay, rpc } = makeDeps({
      env: { AUTOMATION_TOKEN: TOKEN },
      rpc: {
        svc_claim_auto_refunds: () => claimed,
        svc_finish_refund_request: finish,
        svc_claim_outbound_notifications: () => [],
      },
    })
    razorpay.createRefund
      .mockResolvedValueOnce({ id: 'rfnd_1', payment_id: 'pay_1', amount: 5000, status: 'pending' })
      .mockRejectedValueOnce(new GatewayError(400, 'The amount is invalid'))
    const res = await call(deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      refunds: { claimed: 2, accepted: 1, failed: 1 },
      messages: { provider: 'none', claimed: 0, sent: 0, failed: 0 },
    })
    expect(rpc).toHaveBeenCalledWith('svc_claim_auto_refunds', {
      p_gateway_mode: 'test',
      p_limit: 10,
    })
    expect(razorpay.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_1',
        amount: 5000,
        idempotencyKey: claimed[0]!.idempotency_key,
      }),
    )
    expect(finish).toHaveBeenNthCalledWith(1, {
      p_refund_id: 'ref-1',
      p_gateway_refund_id: 'rfnd_1',
      p_gateway_status: 'pending',
    })
    expect(finish).toHaveBeenNthCalledWith(2, {
      p_refund_id: 'ref-2',
      p_gateway_refund_id: null,
      p_gateway_status: null,
      p_error: 'The amount is invalid',
    })
  })

  it('claims nothing while payments are off', async () => {
    const { deps, rpc } = makeDeps({
      env: { AUTOMATION_TOKEN: TOKEN, PAYMENTS_ENABLED: 'false' },
      rpc: { svc_claim_outbound_notifications: () => [] },
    })
    const body = await (await call(deps)).json()
    expect(body.refunds).toEqual({ skipped: 'PAYMENTS_DISABLED' })
    expect(rpc).not.toHaveBeenCalledWith('svc_claim_auto_refunds', expect.anything())
  })

  it('without a provider, queued messages are marked failed and nothing is sent', async () => {
    const finish = vi.fn(() => null)
    const { deps } = makeDeps({
      env: { AUTOMATION_TOKEN: TOKEN },
      rpc: {
        svc_claim_auto_refunds: () => [],
        svc_claim_outbound_notifications: () => [
          {
            id: 'n-1',
            channel: 'SMS',
            kind: 'TURN_NEAR',
            phone: '9876543210',
            text: 't',
            data: {},
          },
        ],
        svc_finish_outbound_notification: finish,
      },
    })
    const body = await (await call(deps)).json()
    expect(body.messages).toEqual({ provider: 'none', claimed: 1, sent: 0, failed: 1 })
    expect(finish).toHaveBeenCalledWith({
      p_id: 'n-1',
      p_ok: false,
      p_error: 'No SMS/WhatsApp provider is configured',
    })
  })

  it('uses the configured sender and keeps going when one task fails', async () => {
    const send = vi.fn(async (m: OutboundMessage) =>
      m.phone === '9876543210' ? ({ ok: true } as const) : ({ ok: false, error: 'DND' } as const),
    )
    const finish = vi.fn(() => null)
    const logged: string[] = []
    const { deps } = makeDeps({
      env: { AUTOMATION_TOKEN: TOKEN },
      rpc: {
        svc_claim_auto_refunds: () => {
          throw { message: 'MQ_FORBIDDEN' }
        },
        svc_claim_outbound_notifications: () => [
          {
            id: 'n-1',
            channel: 'SMS',
            kind: 'TURN_NEAR',
            phone: '9876543210',
            text: 'a',
            data: {},
          },
          {
            id: 'n-2',
            channel: 'SMS',
            kind: 'VISIT_REMINDER',
            phone: '9123456789',
            text: 'b',
            data: {},
          },
        ],
        svc_finish_outbound_notification: finish,
      },
    })
    deps.messages = { name: 'fake', send }
    deps.log = (m) => logged.push(m)
    const body = await (await call(deps)).json()
    expect(body.refunds).toEqual({ error: 'MQ_FORBIDDEN' })
    expect(body.messages).toEqual({ provider: 'fake', claimed: 2, sent: 1, failed: 1 })
    expect(finish).toHaveBeenCalledWith({ p_id: 'n-1', p_ok: true, p_error: null })
    expect(finish).toHaveBeenCalledWith({ p_id: 'n-2', p_ok: false, p_error: 'DND' })
    // phone numbers and message text never reach the logs
    expect(logged.join('\n')).not.toMatch(/9876543210|9123456789/)
  })

  it('MESSAGE_PROVIDER picks the sender; unknown names send nothing', async () => {
    expect(createMessageSender(() => undefined).name).toBe('none')
    const unknown = createMessageSender((k) => (k === 'MESSAGE_PROVIDER' ? 'acme' : undefined))
    expect(
      await unknown.send({ channel: 'SMS', phone: '9876543210', kind: 'X', text: 't', data: {} }),
    ).toEqual({ ok: false, error: 'Unknown MESSAGE_PROVIDER "acme"' })
  })
})
