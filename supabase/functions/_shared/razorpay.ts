// Razorpay helpers using only Web APIs (fetch + WebCrypto), so the same code runs in the
// Supabase Edge Runtime (Deno) and in Node for unit tests.

const encoder = new TextEncoder()

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export async function verifyPaymentSignature(input: {
  orderId: string
  paymentId: string
  signature: string
  keySecret: string
}): Promise<boolean> {
  const expected = await hmacSha256Hex(input.keySecret, `${input.orderId}|${input.paymentId}`)
  return timingSafeEqualHex(expected, input.signature.trim().toLowerCase())
}

/** Webhook signature: HMAC_SHA256(raw request body, webhook_secret). Must use the raw body. */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): Promise<boolean> {
  if (!signature) return false
  const expected = await hmacSha256Hex(secret, rawBody)
  return timingSafeEqualHex(expected, signature.trim().toLowerCase())
}

export class GatewayError extends Error {
  readonly status: number
  readonly gatewayCode?: string

  constructor(status: number, message: string, gatewayCode?: string) {
    super(message)
    this.name = 'GatewayError'
    this.status = status
    this.gatewayCode = gatewayCode
  }
}

export interface RazorpayOrder {
  id: string
  amount: number
  currency: string
  receipt: string
  status: string
}

export interface RazorpayPayment {
  id: string
  order_id: string
  amount: number
  currency: string
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed'
}

export interface RazorpayRefund {
  id: string
  payment_id: string
  amount: number
  status: 'pending' | 'processed' | 'failed'
}

export interface RazorpayClient {
  createOrder(input: {
    amount: number
    currency: string
    receipt: string
    notes?: Record<string, string>
  }): Promise<RazorpayOrder>
  fetchPayment(paymentId: string): Promise<RazorpayPayment>
  capturePayment(paymentId: string, amount: number, currency: string): Promise<RazorpayPayment>
  createRefund(input: {
    paymentId: string
    amount: number
    idempotencyKey: string
    notes?: Record<string, string>
  }): Promise<RazorpayRefund>
}

export function createRazorpayClient(opts: {
  keyId: string
  keySecret: string
  fetchImpl?: typeof fetch
  baseUrl?: string
  timeoutMs?: number
}): RazorpayClient {
  const base = opts.baseUrl ?? 'https://api.razorpay.com/v1'
  const doFetch = opts.fetchImpl ?? fetch
  const auth = `Basic ${btoa(`${opts.keyId}:${opts.keySecret}`)}`

  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { Authorization: auth, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      const err = (json as { error?: { code?: string; description?: string } } | null)?.error
      throw new GatewayError(
        res.status,
        err?.description ?? `Razorpay request failed (${res.status})`,
        err?.code,
      )
    }
    return json as T
  }

  return {
    createOrder: (i) =>
      call<RazorpayOrder>('POST', '/orders', {
        amount: i.amount,
        currency: i.currency,
        receipt: i.receipt,
        notes: i.notes,
      }),
    fetchPayment: (id) => call<RazorpayPayment>('GET', `/payments/${encodeURIComponent(id)}`),
    capturePayment: (id, amount, currency) =>
      call<RazorpayPayment>('POST', `/payments/${encodeURIComponent(id)}/capture`, {
        amount,
        currency,
      }),
    createRefund: (i) =>
      call<RazorpayRefund>(
        'POST',
        `/payments/${encodeURIComponent(i.paymentId)}/refund`,
        { amount: i.amount, speed: 'normal', notes: i.notes },
        { 'X-Refund-Idempotency': i.idempotencyKey },
      ),
  }
}
