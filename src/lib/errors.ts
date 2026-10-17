// Turns PostgREST / Edge Function errors into something the UI can show.
// Database business errors carry a stable code in `message` and patient-safe text in `hint`.

export class AppError extends Error {
  readonly code: string
  readonly detail?: string

  constructor(code: string, message: string, detail?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.detail = detail
  }
}

const FALLBACK: Record<string, string> = {
  MQ_AUTH_REQUIRED: 'Your session has expired. Refresh the page and try again.',
  MQ_FORBIDDEN: 'You do not have permission to do that.',
  MQ_RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
  MQ_NOT_FOUND: 'Not found.',
  MQ_STALE: 'Someone else just updated this. The latest data has been loaded.',
  PAYMENTS_DISABLED: 'Online payment is not available. You can pay at the hospital counter.',
  NETWORK: 'Network problem. Check your connection and try again.',
}

interface PostgrestLikeError {
  message?: string
  hint?: string | null
  details?: string | null
  code?: string
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  const e = (err ?? {}) as PostgrestLikeError
  const message = typeof e.message === 'string' ? e.message : ''
  if (/^(MQ_[A-Z_]+|PAYMENTS_DISABLED|ORDER_IN_PROGRESS|INVALID_SIGNATURE)$/.test(message)) {
    return new AppError(
      message,
      e.hint || FALLBACK[message] || 'The request could not be completed.',
      e.details ?? undefined,
    )
  }
  if (e.code === '42501') return new AppError('MQ_FORBIDDEN', FALLBACK.MQ_FORBIDDEN!)
  if (err instanceof TypeError || /fetch|network/i.test(message))
    return new AppError('NETWORK', FALLBACK.NETWORK!)
  return new AppError('UNKNOWN', 'Something went wrong. Please try again.')
}

/** Throws AppError when a supabase-js result has an error, otherwise returns data. */
export function unwrap<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw toAppError(result.error)
  return result.data
}

export function errorMessage(err: unknown): string {
  return toAppError(err).message
}
