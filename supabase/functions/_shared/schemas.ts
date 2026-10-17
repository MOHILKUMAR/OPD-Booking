// Validation shared by the React app and the Edge Functions (single source of truth).
// The database re-validates everything; these schemas give fast, friendly feedback.
import { z } from 'zod'

/** Same rules as app.normalize_phone() in SQL. Returns 10 digits or null. */
export function normalizeIndianMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

const NAME_FORBIDDEN = /[0-9<>{}[\]\\/@#$%^*=+|~"`;:]/
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

export const patientNameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(2, 'Enter the patient’s full name')
      .max(80, 'Name is too long')
      .refine(
        (s) => !NAME_FORBIDDEN.test(s) && !CONTROL_CHARS.test(s),
        'Use letters only (no numbers or symbols)',
      ),
  )

export const patientPhoneSchema = z
  .string()
  .trim()
  .min(1, 'Enter a mobile number')
  .transform((s, ctx) => {
    const phone = normalizeIndianMobile(s)
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' })
      return z.NEVER
    }
    return phone
  })

export const patientAgeSchema = z.coerce
  .number({ message: 'Enter age in years' })
  .int('Enter age in whole years')
  .min(0, 'Age cannot be negative')
  .max(120, 'Enter a valid age')

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date')

export const bookingRequestSchema = z.object({
  shift_id: z.uuid(),
  session_date: isoDateSchema,
  patient_name: patientNameSchema,
  patient_phone: patientPhoneSchema,
  patient_age: patientAgeSchema.nullish(),
  idempotency_key: z.uuid(),
})
export type BookingRequest = z.output<typeof bookingRequestSchema>

export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]{6,40}$/, 'Invalid order id'),
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/, 'Invalid payment id'),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid signature'),
})
export type VerifyPaymentRequest = z.output<typeof verifyPaymentSchema>

export const refundRequestSchema = z.object({ refund_id: z.uuid() })

export const staffRoleSchema = z.enum(['admin', 'receptionist', 'doctor'])

export const createStaffSchema = z
  .object({
    hospital_id: z.uuid(),
    email: z.email('Enter a valid email').max(254),
    password: z.string().min(10, 'Use at least 10 characters').max(72),
    full_name: z.string().trim().min(2).max(120),
    role: staffRoleSchema,
    doctor_id: z.uuid().nullish(),
  })
  .refine((v) => v.role !== 'doctor' || !!v.doctor_id, {
    message: 'Choose the doctor this login belongs to',
    path: ['doctor_id'],
  })
  .refine((v) => v.role !== 'admin' || !v.doctor_id, {
    message: 'Administrators are not tied to a doctor',
    path: ['doctor_id'],
  })
export type CreateStaffRequest = z.output<typeof createStaffSchema>
