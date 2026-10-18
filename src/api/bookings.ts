// Patient booking, tracking and cancellation.
import { defineMessages, tr } from '@/i18n'
import { AppError, unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { BookingResult, BookingView } from '@/types/database'

const messages = defineMessages({
  en: {
    captchaFailed: 'The security check failed or expired. Please complete it again and retry.',
    sessionFailed: 'Could not start a booking session. Please refresh the page and try again.',
  },
  hi: {
    captchaFailed:
      'सुरक्षा जाँच विफल हो गई या उसका समय निकल गया। कृपया इसे फिर से पूरा करें और दोबारा कोशिश करें।',
    sessionFailed: 'बुकिंग शुरू नहीं हो सकी। कृपया पेज रीफ़्रेश करके फिर कोशिश करें।',
  },
})

/**
 * Bookings are tied to a Supabase session. Patients do not need an account: we create an
 * anonymous session (no personal data) the first time they book on a device.
 *
 * When Supabase Auth's CAPTCHA protection is on, that sign-in needs a Cloudflare Turnstile token
 * (rendered by BookPage when VITE_TURNSTILE_SITE_KEY is set). Without a token the call is the
 * same as before CAPTCHA existed.
 */
export async function ensurePatientSession(captchaToken?: string | null): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (data.session) return
  const { error } = captchaToken
    ? await supabase.auth.signInAnonymously({ options: { captchaToken } })
    : await supabase.auth.signInAnonymously()
  if (error) {
    if (error.code === 'captcha_failed') {
      throw new AppError('CAPTCHA_FAILED', tr(messages, 'captchaFailed'), error.message)
    }
    throw new AppError('MQ_AUTH_REQUIRED', tr(messages, 'sessionFailed'), error.message)
  }
}

export interface BookTokenInput {
  shiftId: string
  sessionDate: string
  patientName: string
  patientPhone: string
  patientAge: number | null
  requestId: string
  /** Turnstile token; used only if this device has no session yet. */
  captchaToken?: string | null
}

export async function bookToken(input: BookTokenInput): Promise<BookingResult> {
  await ensurePatientSession(input.captchaToken)
  return unwrap(
    await supabase.rpc('book_token', {
      p_shift_id: input.shiftId,
      p_session_date: input.sessionDate,
      p_patient_name: input.patientName,
      p_patient_phone: input.patientPhone,
      p_patient_age: input.patientAge,
      p_client_request_id: input.requestId,
    }),
  ) as BookingResult
}

export async function getBooking(
  reference: string,
  accessKey?: string | null,
): Promise<BookingView | null> {
  return unwrap(
    await supabase.rpc('get_booking', {
      p_booking_reference: reference,
      p_access_key: accessKey || null,
    }),
  ) as BookingView | null
}

export async function cancelBooking(
  reference: string,
  accessKey: string | null,
  reason: string | null,
): Promise<{ status: string; refund_requested: boolean }> {
  return unwrap(
    await supabase.rpc('cancel_booking', {
      p_booking_reference: reference,
      p_access_key: accessKey,
      p_reason: reason,
    }),
  ) as { status: string; refund_requested: boolean }
}

export async function getMyAppointments(): Promise<BookingView[]> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) return []
  return (
    (unwrap(
      await supabase.rpc('get_my_appointments', { p_limit: 50, p_offset: 0 }),
    ) as BookingView[]) ?? []
  )
}

export async function rotateAccessKey(reference: string): Promise<string> {
  const res = unwrap(
    await supabase.rpc('rotate_access_key', { p_booking_reference: reference }),
  ) as {
    access_key: string
  }
  return res.access_key
}

/** Tracking link with the key in the URL fragment (never sent to any server in URLs). */
export function trackingUrl(
  reference: string,
  accessKey: string,
  origin = window.location.origin,
): string {
  return `${origin}/track/${encodeURIComponent(reference)}#k=${encodeURIComponent(accessKey)}`
}

/** Reads `k` from a `#k=...` fragment. */
export function keyFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const key = params.get('k')
  return key && /^[0-9a-f]{32}$/i.test(key) ? key.toLowerCase() : null
}

/** Accepts a pasted tracking link or a bare reference. */
export function parseTrackingInput(
  input: string,
): { reference: string; key: string | null } | null {
  const text = input.trim()
  const refMatch = text.match(/MQ-[A-Z2-9]{8}/i)
  if (!refMatch) return null
  const hashIndex = text.indexOf('#')
  return {
    reference: refMatch[0].toUpperCase(),
    key: hashIndex >= 0 ? keyFromHash(text.slice(hashIndex)) : null,
  }
}

/** Patient opt-in/out for WhatsApp updates on one booking (booking holder only). */
export async function setWhatsappAlerts(
  reference: string,
  accessKey: string | null,
  enabled: boolean,
  language: 'en' | 'hi',
): Promise<{ enabled: boolean; language: 'en' | 'hi' }> {
  return unwrap(
    await supabase.rpc('set_whatsapp_alerts', {
      p_booking_reference: reference,
      p_access_key: accessKey,
      p_enabled: enabled,
      p_language: language,
    }),
  ) as { enabled: boolean; language: 'en' | 'hi' }
}
