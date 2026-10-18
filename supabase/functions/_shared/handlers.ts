// Edge Function request handlers. Pure functions of their dependencies so they can be unit
// tested in Node with fakes; each supabase/functions/<name>/index.ts wires real dependencies.
import {
  browserEndpoint,
  bearerToken,
  HttpError,
  json,
  readJson,
  toHttpError,
  type Config,
} from './http.ts'
import {
  GatewayError,
  hmacSha256Hex,
  timingSafeEqualHex,
  verifyPaymentSignature,
  verifyWebhookSignature,
  type RazorpayClient,
} from './razorpay.ts'
import { noProvider, type MessageSender, type SendResult } from './messaging.ts'
import {
  bookingRequestSchema,
  createStaffSchema,
  refundRequestSchema,
  verifyPaymentSchema,
} from './schemas.ts'

/** Calls a database function with the secret (service-role) key. Throws the PostgREST error. */
export interface Db {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>
}

export interface Caller {
  id: string
  isAnonymous: boolean
  /** The token's `aal` claim: 'aal1' after a password, 'aal2' after an authenticator code. */
  aal: string | null
  /** True when the user has a verified MFA factor (row in auth.mfa_factors, status 'verified'). */
  hasVerifiedFactor: boolean
}

export interface CallerAuth {
  /** Verifies a user access token with Supabase Auth. */
  getUser(token: string): Promise<Caller | null>
}

/**
 * Reads the `aal` claim of an access token. Only meaningful for a token Supabase Auth has just
 * verified (signature, expiry, live session); returns null when the claim is missing or unreadable.
 */
export function accessTokenAal(token: string): string | null {
  try {
    const payload = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
    const claims = JSON.parse(new TextDecoder().decode(bytes)) as { aal?: unknown }
    return typeof claims.aal === 'string' ? claims.aal : null
  } catch {
    return null
  }
}

export interface AuthAdmin {
  /** Creates a confirmed email+password user, or returns null if the email already exists. */
  createUser(input: {
    email: string
    password: string
    fullName: string
  }): Promise<{ id: string } | null>
}

export interface Deps {
  cfg: Config
  db: Db
  auth: CallerAuth
  razorpay?: RazorpayClient
  authAdmin?: AuthAdmin
  /** SMS/WhatsApp provider for queued alert copies; defaults to none (nothing is sent). */
  messages?: MessageSender
  log?: (msg: string) => void
}

function firstIssue(err: { issues: { message: string; path: PropertyKey[] }[] }): string {
  const i = err.issues[0]
  return i ? `${i.path.join('.') || 'body'}: ${i.message}` : 'Invalid request.'
}

async function requireUser(
  req: Request,
  auth: CallerAuth,
  opts: { allowAnonymous: boolean; enforceMfa: boolean },
) {
  const token = bearerToken(req)
  const user = token ? await auth.getUser(token) : null
  if (!user)
    throw new HttpError(
      401,
      'MQ_AUTH_REQUIRED',
      'Your session has expired. Refresh the page and try again.',
    )
  if (user.isAnonymous && !opts.allowAnonymous)
    throw new HttpError(403, 'MQ_FORBIDDEN', 'Staff sign-in required.')
  // Staff endpoints call svc_* functions with the secret key, which skip app.mfa_satisfied(), so
  // apply the same rule here: a user with a verified factor must present an aal2 token.
  if (opts.enforceMfa && user.hasVerifiedFactor && user.aal !== 'aal2')
    throw new HttpError(
      403,
      'MQ_FORBIDDEN',
      'Sign out and sign in again with your authenticator code.',
    )
  return user
}

function requirePayments(d: Deps): RazorpayClient {
  if (!d.cfg.paymentsEnabled || !d.razorpay || !d.cfg.razorpayKeyId || !d.cfg.razorpayKeySecret) {
    throw new HttpError(
      503,
      'PAYMENTS_DISABLED',
      'Online payment is not available. You can pay at the hospital counter.',
    )
  }
  return d.razorpay
}

function gatewayFailure(err: unknown): never {
  if (err instanceof GatewayError) {
    throw new HttpError(
      502,
      'GATEWAY_ERROR',
      'The payment provider could not process the request. Please try again.',
    )
  }
  throw err
}

interface HoldResult {
  outcome: 'HOLD_CREATED' | 'HOLD_EXISTS' | 'ORDER_IN_PROGRESS' | 'ALREADY_PAID'
  appointment_id: string
  booking_reference: string
  access_key: string
  payment_id: string
  gateway_order_id: string | null
  receipt: string
  amount_paise: number
  currency: string
  needs_order: boolean
  hold_expires_at: string | null
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// payments-create-order
// ---------------------------------------------------------------------------
export function createOrderHandler(d: Deps) {
  return browserEndpoint(
    d.cfg,
    async (req) => {
      const razorpay = requirePayments(d)
      const user = await requireUser(req, d.auth, { allowAnonymous: true, enforceMfa: false })
      const parsed = bookingRequestSchema.safeParse(await readJson(req))
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST', firstIssue(parsed.error))
      const b = parsed.data

      // Amount, fee and capacity are decided by the database, never by this request.
      const hold = await d.db.rpc<HoldResult>('svc_hold_paid_booking', {
        p_user_id: user.id,
        p_shift_id: b.shift_id,
        p_session_date: b.session_date,
        p_patient_name: b.patient_name,
        p_patient_phone: b.patient_phone,
        p_patient_age: b.patient_age ?? null,
        p_idempotency_key: b.idempotency_key,
        p_gateway_mode: d.cfg.razorpayMode,
      })

      if (hold.outcome === 'ORDER_IN_PROGRESS') {
        throw new HttpError(
          409,
          'ORDER_IN_PROGRESS',
          'Your payment is being prepared. Please wait a moment.',
        )
      }

      let orderId = hold.gateway_order_id
      if (hold.outcome !== 'ALREADY_PAID' && hold.needs_order) {
        const order = await razorpay
          .createOrder({
            amount: hold.amount_paise,
            currency: hold.currency,
            receipt: hold.receipt,
            notes: {
              appointment_id: hold.appointment_id,
              booking_reference: hold.booking_reference,
            },
          })
          .catch(gatewayFailure)
        if (order.amount !== hold.amount_paise || order.currency !== hold.currency) {
          throw new HttpError(
            502,
            'GATEWAY_ERROR',
            'The payment provider returned an unexpected amount.',
          )
        }
        await d.db.rpc('svc_attach_order', {
          p_payment_id: hold.payment_id,
          p_gateway_order_id: order.id,
        })
        orderId = order.id
      }
      if (!orderId)
        throw new HttpError(
          409,
          'ORDER_IN_PROGRESS',
          'Your payment is being prepared. Please wait a moment.',
        )

      const {
        outcome,
        needs_order: _n,
        payment_id: _p,
        receipt: _r,
        gateway_order_id: _g,
        ...booking
      } = hold
      return {
        status: outcome === 'ALREADY_PAID' ? 'ALREADY_PAID' : 'ORDER_CREATED',
        key_id: d.cfg.razorpayKeyId,
        order_id: orderId,
        amount_paise: hold.amount_paise,
        currency: hold.currency,
        hold_expires_at: hold.hold_expires_at,
        booking,
      }
    },
    d.log,
  )
}

// ---------------------------------------------------------------------------
// payments-verify: never trust the browser's "success" — verify signature AND ask Razorpay.
// ---------------------------------------------------------------------------
export function verifyPaymentHandler(d: Deps) {
  return browserEndpoint(
    d.cfg,
    async (req) => {
      const razorpay = requirePayments(d)
      await requireUser(req, d.auth, { allowAnonymous: true, enforceMfa: false })
      const parsed = verifyPaymentSchema.safeParse(await readJson(req))
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST', firstIssue(parsed.error))
      const v = parsed.data

      const valid = await verifyPaymentSignature({
        orderId: v.razorpay_order_id,
        paymentId: v.razorpay_payment_id,
        signature: v.razorpay_signature,
        keySecret: d.cfg.razorpayKeySecret!,
      })
      if (!valid) throw new HttpError(400, 'INVALID_SIGNATURE', 'Payment could not be verified.')

      let payment = await razorpay.fetchPayment(v.razorpay_payment_id).catch(gatewayFailure)
      if (payment.order_id !== v.razorpay_order_id) {
        throw new HttpError(400, 'INVALID_SIGNATURE', 'Payment does not belong to this order.')
      }
      if (payment.status === 'authorized') {
        payment = await razorpay
          .capturePayment(payment.id, payment.amount, payment.currency)
          .catch(gatewayFailure)
      }
      if (payment.status !== 'captured') {
        throw new HttpError(402, 'PAYMENT_NOT_CAPTURED', 'The payment has not been completed.')
      }

      // The database compares the amount with the booking fee it stored and confirms atomically.
      return d.db.rpc('svc_confirm_payment', {
        p_gateway_order_id: v.razorpay_order_id,
        p_gateway_payment_id: payment.id,
        p_amount_paise: payment.amount,
        p_via: 'CHECKOUT_SIGNATURE',
      })
    },
    d.log,
  )
}

// ---------------------------------------------------------------------------
// payments-webhook (server-to-server; verify_jwt = false)
// ---------------------------------------------------------------------------
interface WebhookPayload {
  event?: string
  payload?: {
    payment?: {
      entity?: {
        id?: string
        order_id?: string
        amount?: number
        error_description?: string | null
      }
    }
    order?: { entity?: { id?: string } }
    refund?: { entity?: { id?: string; payment_id?: string; amount?: number } }
  }
}

export function webhookHandler(d: Deps) {
  const log = d.log ?? console.error
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
    if (!d.cfg.razorpayWebhookSecret) return json({ code: 'PAYMENTS_DISABLED' }, 503)

    const raw = await req.text()
    if (raw.length > 1_000_000) return json({ code: 'PAYLOAD_TOO_LARGE' }, 413)
    const ok = await verifyWebhookSignature(
      raw,
      req.headers.get('x-razorpay-signature'),
      d.cfg.razorpayWebhookSecret,
    )
    if (!ok) return json({ code: 'INVALID_SIGNATURE' }, 401)

    const eventId = req.headers.get('x-razorpay-event-id')
    if (!eventId) return json({ code: 'MISSING_EVENT_ID' }, 400)

    let body: WebhookPayload
    try {
      body = JSON.parse(raw) as WebhookPayload
    } catch {
      return json({ code: 'INVALID_JSON' }, 400)
    }
    const payment = body.payload?.payment?.entity
    const refund = body.payload?.refund?.entity
    try {
      const result = await d.db.rpc<{ duplicate: boolean; result?: string }>(
        'svc_process_payment_event',
        {
          p_event_id: eventId,
          p_event_type: body.event ?? 'unknown',
          p_gateway_order_id: payment?.order_id ?? body.payload?.order?.entity?.id ?? null,
          p_gateway_payment_id: payment?.id ?? refund?.payment_id ?? null,
          p_gateway_refund_id: refund?.id ?? null,
          p_amount_paise: payment?.amount ?? refund?.amount ?? null,
          p_error: payment?.error_description ?? null,
        },
      )
      // 2xx tells Razorpay to stop retrying: processed, duplicate or recorded-and-rejected.
      return json({ ok: true, duplicate: result.duplicate, result: result.result ?? null })
    } catch (err) {
      // Anything else (e.g. refund not linked yet, DB unavailable) → 5xx so Razorpay retries.
      log(
        `[payments-webhook] ${body.event} ${eventId}: ${(err as { message?: string })?.message ?? String(err)}`,
      )
      return json({ code: 'RETRY_LATER' }, 500)
    }
  }
}

// ---------------------------------------------------------------------------
// payments-refund (administrators)
// ---------------------------------------------------------------------------
export function refundHandler(d: Deps) {
  return browserEndpoint(
    d.cfg,
    async (req) => {
      const razorpay = requirePayments(d)
      const user = await requireUser(req, d.auth, { allowAnonymous: false, enforceMfa: true })
      const parsed = refundRequestSchema.safeParse(await readJson(req))
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST', firstIssue(parsed.error))

      // Checks the caller is an admin of the refund's hospital and moves it to PROCESSING.
      const begin = await d.db.rpc<{
        refund_id: string
        gateway_payment_id: string
        amount_paise: number
        idempotency_key: string
      }>('svc_begin_refund', { p_refund_id: parsed.data.refund_id, p_actor_user_id: user.id })
      let rz
      try {
        // Same idempotency key on every retry, so a timed-out first attempt is never refunded twice.
        rz = await razorpay.createRefund({
          paymentId: begin.gateway_payment_id,
          amount: begin.amount_paise,
          idempotencyKey: begin.idempotency_key,
          notes: { refund_id: begin.refund_id },
        })
      } catch (err) {
        const message = err instanceof GatewayError ? err.message : 'Refund request failed'
        await d.db.rpc('svc_finish_refund_request', {
          p_refund_id: begin.refund_id,
          p_gateway_refund_id: null,
          p_gateway_status: null,
          p_error: message,
        })
        throw new HttpError(502, 'GATEWAY_ERROR', `Razorpay did not accept the refund: ${message}`)
      }
      return d.db.rpc('svc_finish_refund_request', {
        p_refund_id: begin.refund_id,
        p_gateway_refund_id: rz.id,
        p_gateway_status: rz.status,
      })
    },
    d.log,
  )
}

// ---------------------------------------------------------------------------
// admin-create-staff
// ---------------------------------------------------------------------------
export function createStaffHandler(d: Deps) {
  return browserEndpoint(
    d.cfg,
    async (req) => {
      const user = await requireUser(req, d.auth, { allowAnonymous: false, enforceMfa: true })
      const parsed = createStaffSchema.safeParse(await readJson(req))
      if (!parsed.success) throw new HttpError(400, 'INVALID_REQUEST', firstIssue(parsed.error))
      const s = parsed.data

      // Authorize before touching Auth so non-admins cannot even probe for emails.
      const isAdmin = await d.db.rpc<boolean>('svc_is_admin', {
        p_user_id: user.id,
        p_hospital_id: s.hospital_id,
      })
      if (!isAdmin) throw new HttpError(403, 'MQ_FORBIDDEN', 'Administrator access required.')
      if (!d.authAdmin)
        throw new HttpError(500, 'INTERNAL', 'Staff provisioning is not configured.')

      const created = await d.authAdmin.createUser({
        email: s.email,
        password: s.password,
        fullName: s.full_name,
      })
      const userId =
        created?.id ??
        (await d.db.rpc<string | null>('svc_find_user_by_email', { p_email: s.email }))
      if (!userId)
        throw new HttpError(409, 'USER_CONFLICT', 'Could not create or find this account.')

      await d.db.rpc('svc_grant_staff_role', {
        p_actor_user_id: user.id,
        p_user_id: userId,
        p_hospital_id: s.hospital_id,
        p_role: s.role,
        p_doctor_id: s.doctor_id ?? null,
        p_full_name: s.full_name,
        p_email: s.email,
      })
      return { user_id: userId, created: !!created }
    },
    d.log,
  )
}

// ---------------------------------------------------------------------------
// Shared-secret endpoints called by schedulers (no user JWT)
// ---------------------------------------------------------------------------
/** Returns an error response unless `provided` equals the configured secret (24+ chars). */
function sharedSecretError(provided: string | null, expected: string | undefined): Response | null {
  if (!expected || expected.length < 24) return json({ code: 'NOT_CONFIGURED' }, 503)
  // compare as hex of the UTF-8 bytes so length leaks nothing beyond "wrong length"
  const hex = (v: string) =>
    Array.from(new TextEncoder().encode(v), (b) => b.toString(16).padStart(2, '0')).join('')
  if (!timingSafeEqualHex(hex(provided ?? ''), hex(expected)))
    return json({ code: 'UNAUTHORIZED' }, 401)
  return null
}

// housekeeping (cron alternative when pg_cron is unavailable)
export function housekeepingHandler(d: Deps) {
  return async (req: Request): Promise<Response> => {
    const denied = sharedSecretError(
      req.headers.get('x-housekeeping-token'),
      d.cfg.housekeepingToken,
    )
    if (denied) return denied
    try {
      return json(await d.db.rpc('svc_housekeeping'))
    } catch (err) {
      const e = toHttpError(err)
      return json({ code: e.code }, e.status)
    }
  }
}

// ---------------------------------------------------------------------------
// automation: woken by pg_cron + pg_net (app.kick_automation) only when there is work.
//   1. automatic refunds the hospital's policy allows (svc_claim_auto_refunds)
//   2. queued SMS/WhatsApp copies of patient alerts (none unless a hospital enables them)
// Each task is independent: a failure in one is reported without stopping the other.
// ---------------------------------------------------------------------------
interface ClaimedRefund {
  refund_id: string
  gateway_payment_id: string
  amount_paise: number
  idempotency_key: string
}

interface QueuedMessage {
  id: string
  channel: 'SMS' | 'WHATSAPP'
  kind: string
  phone: string
  text: string
  data: Record<string, unknown>
  language?: 'en' | 'hi'
  hospital?: string
}

async function runAutoRefunds(d: Deps, log: (msg: string) => void) {
  if (!d.cfg.paymentsEnabled || !d.razorpay) return { skipped: 'PAYMENTS_DISABLED' }
  const claimed = await d.db.rpc<ClaimedRefund[]>('svc_claim_auto_refunds', {
    p_gateway_mode: d.cfg.razorpayMode,
    p_limit: 10,
  })
  let accepted = 0
  let failed = 0
  for (const r of claimed) {
    try {
      // The refund's own idempotency key: an administrator retrying later can never refund twice.
      const rz = await d.razorpay.createRefund({
        paymentId: r.gateway_payment_id,
        amount: r.amount_paise,
        idempotencyKey: r.idempotency_key,
        notes: { refund_id: r.refund_id, initiated_via: 'AUTO' },
      })
      await d.db.rpc('svc_finish_refund_request', {
        p_refund_id: r.refund_id,
        p_gateway_refund_id: rz.id,
        p_gateway_status: rz.status,
      })
      accepted += 1
    } catch (err) {
      const message = err instanceof GatewayError ? err.message : 'Refund request failed'
      log(`[automation] refund ${r.refund_id}: ${message}`)
      // Left FAILED for an administrator (Payments page); automatic runs do not retry it.
      await d.db.rpc('svc_finish_refund_request', {
        p_refund_id: r.refund_id,
        p_gateway_refund_id: null,
        p_gateway_status: null,
        p_error: message,
      })
      failed += 1
    }
  }
  return { claimed: claimed.length, accepted, failed }
}

async function runOutboundMessages(d: Deps, log: (msg: string) => void) {
  const sender = d.messages ?? noProvider
  const queued = await d.db.rpc<QueuedMessage[]>('svc_claim_outbound_notifications', {
    p_limit: 20,
  })
  let sent = 0
  for (const m of queued) {
    let result: SendResult
    try {
      result = await sender.send({
        channel: m.channel,
        phone: m.phone,
        kind: m.kind,
        text: m.text,
        data: m.data,
        language: m.language,
        hospital: m.hospital,
      })
    } catch {
      result = { ok: false, error: 'The message provider failed' }
    }
    if (result.ok) sent += 1
    // never log the phone number or text
    else log(`[automation] message ${m.id} (${m.kind}) not sent: ${result.error}`)
    await d.db.rpc('svc_finish_outbound_notification', {
      p_id: m.id,
      p_ok: result.ok,
      p_error: result.ok ? null : result.error,
      p_provider_id: result.ok ? (result.id ?? null) : null,
    })
  }
  return { provider: sender.name, claimed: queued.length, sent, failed: queued.length - sent }
}

export function automationHandler(d: Deps) {
  const log = d.log ?? console.error
  const task = async (name: string, run: () => Promise<Record<string, unknown>>) => {
    try {
      return await run()
    } catch (err) {
      const e = toHttpError(err)
      log(`[automation] ${name}: ${e.code} ${(err as { message?: string })?.message ?? ''}`)
      return { error: e.code }
    }
  }
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
    const denied = sharedSecretError(req.headers.get('x-automation-token'), d.cfg.automationToken)
    if (denied) return denied
    const refunds = await task('refunds', () => runAutoRefunds(d, log))
    const messages = await task('messages', () => runOutboundMessages(d, log))
    return json({ refunds, messages })
  }
}

// ---------------------------------------------------------------------------
// whatsapp-webhook (Meta): subscription check, STOP replies, failed deliveries
// ---------------------------------------------------------------------------
interface WhatsAppWebhookPayload {
  entry?: {
    changes?: {
      field?: string
      value?: {
        messages?: {
          from?: string
          type?: string
          text?: { body?: string }
          button?: { text?: string }
          interactive?: { button_reply?: { title?: string } }
        }[]
        statuses?: { id?: string; status?: string; errors?: { code?: number; title?: string }[] }[]
      }
    }[]
  }[]
}

/** Replies that withdraw WhatsApp consent (English and Hindi). */
export const STOP_WORDS = /^\s*(stop|unsubscribe|रोकें|रोको|बंद करें|बंद)\s*[.!।]?\s*$/i

export function whatsappWebhookHandler(d: Deps) {
  const log = d.log ?? console.error
  return async (req: Request): Promise<Response> => {
    if (req.method === 'GET') {
      // Meta's one-time subscription check: echo hub.challenge for the right verify token
      const verifyToken = d.cfg.whatsappVerifyToken
      if (!verifyToken) return json({ code: 'NOT_CONFIGURED' }, 503)
      const url = new URL(req.url)
      const hex = (v: string) =>
        Array.from(new TextEncoder().encode(v), (b) => b.toString(16).padStart(2, '0')).join('')
      const given = url.searchParams.get('hub.verify_token') ?? ''
      if (
        url.searchParams.get('hub.mode') === 'subscribe' &&
        timingSafeEqualHex(hex(given), hex(verifyToken))
      ) {
        return new Response(url.searchParams.get('hub.challenge') ?? '', {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
      return json({ code: 'FORBIDDEN' }, 403)
    }
    if (req.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405)
    const appSecret = d.cfg.whatsappAppSecret
    if (!appSecret) return json({ code: 'NOT_CONFIGURED' }, 503)

    const raw = await req.text()
    if (raw.length > 1_000_000) return json({ code: 'PAYLOAD_TOO_LARGE' }, 413)
    const signature = (req.headers.get('x-hub-signature-256') ?? '').trim().toLowerCase()
    const expected = await hmacSha256Hex(appSecret, raw)
    if (!signature.startsWith('sha256=') || !timingSafeEqualHex(signature.slice(7), expected))
      return json({ code: 'INVALID_SIGNATURE' }, 401)

    let body: WhatsAppWebhookPayload
    try {
      body = JSON.parse(raw) as WhatsAppWebhookPayload
    } catch {
      return json({ code: 'INVALID_JSON' }, 400)
    }
    let optOuts = 0
    let failures = 0
    try {
      for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
          if (change.field !== 'messages' || !change.value) continue
          for (const m of change.value.messages ?? []) {
            const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? ''
            if (m.from && STOP_WORDS.test(text)) {
              optOuts += await d.db.rpc<number>('svc_whatsapp_opt_out', { p_phone: m.from })
            }
          }
          for (const st of change.value.statuses ?? []) {
            if (st.status !== 'failed' || !st.id) continue
            const e = st.errors?.[0]
            await d.db.rpc('svc_record_message_status', {
              p_provider_message_id: st.id,
              p_status: 'failed',
              p_error: e ? `${e.code ?? ''} ${e.title ?? ''}`.trim() : null,
            })
            failures += 1
          }
        }
      }
    } catch (err) {
      // 5xx: Meta retries the delivery
      log(`[whatsapp-webhook] ${(err as { message?: string })?.message ?? String(err)}`)
      return json({ code: 'RETRY_LATER' }, 500)
    }
    return json({ ok: true, opt_outs: optOuts, failures })
  }
}
