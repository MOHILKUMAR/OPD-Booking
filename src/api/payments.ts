// Online payment flow (Razorpay test mode). Disabled unless the hospital setting, the
// VITE_PAYMENTS_ENABLED flag and the Edge Function PAYMENTS_ENABLED secret are all on.
// The browser never confirms a payment: payments-verify and the webhook do, on the server.
import type { BookingResult } from '@/types/database'
import { ensurePatientSession } from './bookings'
import { invokeFunction } from './functions'

export interface CreateOrderResponse {
  status: 'ORDER_CREATED' | 'ALREADY_PAID'
  key_id: string
  order_id: string
  amount_paise: number
  currency: string
  hold_expires_at: string | null
  booking: BookingResult
}

export interface VerifyResponse {
  outcome: 'CONFIRMED' | 'ALREADY_CONFIRMED' | 'REFUND_REQUIRED' | 'DUPLICATE_PAYMENT_REVIEW'
  booking_reference: string
  token_no: number | null
  status: string
}

export async function createPaymentOrder({
  captchaToken,
  ...body
}: {
  shift_id: string
  session_date: string
  patient_name: string
  patient_phone: string
  patient_age: number | null
  idempotency_key: string
  /** Turnstile token for the anonymous sign-in; never sent to the Edge Function. */
  captchaToken?: string | null
}): Promise<CreateOrderResponse> {
  await ensurePatientSession(captchaToken)
  // A concurrent duplicate request gets 409 ORDER_IN_PROGRESS; retry briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      return await invokeFunction<CreateOrderResponse>('payments-create-order', body)
    } catch (err) {
      if ((err as { code?: string }).code === 'ORDER_IN_PROGRESS' && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      throw err
    }
  }
}

export function verifyPayment(input: {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}): Promise<VerifyResponse> {
  return invokeFunction<VerifyResponse>('payments-verify', input)
}

interface RazorpaySuccess {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

interface RazorpayInstance {
  open(): void
  on(event: 'payment.failed', cb: (resp: { error: { description?: string } }) => void): void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

let scriptPromise: Promise<void> | null = null

/** Loads Razorpay Checkout only when a payment is actually started. */
export function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('Could not load the payment window. Check your connection.'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/**
 * Opens Checkout and resolves with Razorpay's response. Resolution does NOT mean the booking is
 * paid — the caller must send the response to verifyPayment().
 */
export async function openCheckout(
  order: CreateOrderResponse,
  hospitalName: string,
  prefill: { name: string; contact: string },
) {
  await loadRazorpay()
  return new Promise<RazorpaySuccess>((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount_paise,
      currency: order.currency,
      name: hospitalName,
      description: `OPD booking ${order.booking.booking_reference}`,
      prefill: { name: prefill.name, contact: prefill.contact },
      notes: { booking_reference: order.booking.booking_reference },
      theme: { color: '#0f766e' },
      handler: (resp: RazorpaySuccess) => resolve(resp),
      modal: { ondismiss: () => reject(new Error('CHECKOUT_DISMISSED')) },
    })
    // Razorpay keeps the window open after a failed attempt so the patient can retry; we only
    // stop waiting when they close it.
    rzp.on('payment.failed', () => {})
    rzp.open()
  })
}
