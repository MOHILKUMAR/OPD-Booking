// HTTP plumbing shared by all Edge Functions: config, CORS, JSON responses, error mapping.

export interface Config {
  allowedOrigins: string[]
  paymentsEnabled: boolean
  razorpayMode: 'test' | 'live'
  razorpayKeyId?: string
  razorpayKeySecret?: string
  razorpayWebhookSecret?: string
  housekeepingToken?: string
}

export function loadConfig(get: (name: string) => string | undefined): Config {
  const mode = get('RAZORPAY_MODE') === 'live' ? 'live' : 'test'
  const keyId = get('RAZORPAY_KEY_ID') || undefined
  // Refuse to mix modes: test keys start with rzp_test_, live keys with rzp_live_.
  if (keyId && !keyId.startsWith(mode === 'live' ? 'rzp_live_' : 'rzp_test_')) {
    throw new Error(`RAZORPAY_KEY_ID does not match RAZORPAY_MODE=${mode}`)
  }
  return {
    allowedOrigins: (get('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    paymentsEnabled: get('PAYMENTS_ENABLED') === 'true',
    razorpayMode: mode,
    razorpayKeyId: keyId,
    razorpayKeySecret: get('RAZORPAY_KEY_SECRET') || undefined,
    razorpayWebhookSecret: get('RAZORPAY_WEBHOOK_SECRET') || undefined,
    housekeepingToken: get('HOUSEKEEPING_TOKEN') || undefined,
  }
}

export class HttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export function corsHeaders(req: Request, cfg: Config): Record<string, string> {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
  if (origin && cfg.allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  })
}

/** Error from the database (PostgREST shape). Business errors carry an MQ_ code in `message`. */
export interface DbError {
  message?: string
  hint?: string | null
  details?: string | null
  code?: string
}

export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err
  const e = (err ?? {}) as DbError
  if (typeof e.message === 'string' && /^MQ_[A-Z_]+$/.test(e.message)) {
    const status = e.message === 'MQ_FORBIDDEN' ? 403 : e.message === 'MQ_RATE_LIMITED' ? 429 : 400
    return new HttpError(status, e.message, e.hint || 'The request could not be completed.')
  }
  return new HttpError(500, 'INTERNAL', 'Something went wrong. Please try again.')
}

export async function readJson(req: Request, maxBytes = 16_384): Promise<unknown> {
  const text = await req.text()
  if (text.length > maxBytes) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request too large.')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'Body must be JSON.')
  }
}

type Handler = (req: Request) => Promise<Response>

/**
 * Wraps a browser-facing handler: CORS preflight, origin allow-list, POST only, uniform errors.
 * Internal errors are logged without request bodies (no patient data in logs).
 */
export function browserEndpoint(
  cfg: Config,
  fn: (req: Request) => Promise<unknown>,
  log: (msg: string) => void = console.error,
): Handler {
  return async (req) => {
    const cors = corsHeaders(req, cfg)
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    const origin = req.headers.get('origin')
    if (origin && !cfg.allowedOrigins.includes(origin)) {
      return json({ code: 'ORIGIN_NOT_ALLOWED', message: 'Origin not allowed.' }, 403, cors)
    }
    if (req.method !== 'POST')
      return json({ code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' }, 405, cors)
    try {
      return json(await fn(req), 200, cors)
    } catch (err) {
      const httpErr = toHttpError(err)
      if (httpErr.status >= 500)
        log(`[${new URL(req.url).pathname}] ${err instanceof Error ? err.message : String(err)}`)
      return json({ code: httpErr.code, message: httpErr.message }, httpErr.status, cors)
    }
  }
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1]!.trim() : null
}
