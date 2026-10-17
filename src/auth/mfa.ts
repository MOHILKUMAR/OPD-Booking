// Two-factor authentication for staff with an authenticator app (TOTP), using Supabase Auth MFA.
// TOTP is free on every Supabase plan. Signing in with a password gives an `aal1` session; a
// verified code upgrades it to `aal2`.
import type { Factor } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export async function listTotpFactors(): Promise<Factor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return data.all.filter((f) => f.factor_type === 'totp')
}

/** Starts enrolment. Leftovers from an abandoned attempt are removed first (names must be unique). */
export async function enrollTotp() {
  for (const f of await listTotpFactors()) {
    if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator app',
    issuer: 'MediQueue',
  })
  if (error) throw error
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

/** Checks one code. On success Supabase replaces the session with an `aal2` one. */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const challenge = await supabase.auth.mfa.challenge({ factorId })
  if (challenge.error) throw challenge.error
  const { error } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  })
  if (error) throw error
}

/** Sign-in second step: verifies the code against the account's authenticator app. */
export async function verifySignInCode(code: string): Promise<void> {
  const factor = (await listTotpFactors()).find((f) => f.status === 'verified')
  if (!factor) throw new Error('No authenticator app is set up for this account.')
  await verifyTotp(factor.id, code)
}

/** Drops an enrolment the user abandoned before verifying it (best effort). */
export function discardEnrolment(factorId: string): void {
  void supabase.auth.mfa.unenroll({ factorId }).catch(() => {})
}

export async function removeTotp(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) throw error
  // Refresh so the session's factor list (and so the assurance level) no longer includes it.
  await supabase.auth.refreshSession()
}

/** Keeps digits only, at most 6, so pasted codes like "123 456" work. */
export function normalizeTotpCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6)
}

export function mfaErrorMessage(err: unknown): string {
  const e = (err ?? {}) as { code?: string; message?: string }
  switch (e.code) {
    case 'mfa_verification_failed':
      return 'That code is not correct. Make sure the time on your phone is set automatically, then enter the current code.'
    case 'mfa_challenge_expired':
      return 'The code expired. Enter the current code from your app.'
    case 'mfa_totp_enroll_not_enabled':
    case 'mfa_totp_verify_not_enabled':
      return 'Authenticator apps are turned off for this project (Supabase Auth → Multi-Factor).'
    case 'insufficient_aal':
      return 'Sign out and sign in again with your authenticator code to make this change.'
  }
  return e.message || 'Something went wrong. Please try again.'
}
