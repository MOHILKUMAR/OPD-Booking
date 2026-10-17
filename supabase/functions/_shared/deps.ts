// Real dependencies for the Edge Functions (Supabase client with the secret key + Razorpay).
import { createClient } from '@supabase/supabase-js'
import { accessTokenAal, type Deps } from './handlers.ts'
import { loadConfig } from './http.ts'
import { createMessageSender } from './messaging.ts'
import { createRazorpayClient } from './razorpay.ts'

export function createDeps(getEnv: (name: string) => string | undefined): Deps {
  const cfg = loadConfig(getEnv)
  const url = getEnv('SUPABASE_URL')
  // New projects: secret key (sb_secret_...). Older projects: service_role JWT (auto-injected).
  const secret = getEnv('SUPABASE_SECRET_KEY') || getEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !secret)
    throw new Error(
      'SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required',
    )

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return {
    cfg,
    db: {
      async rpc(fn, args) {
        const { data, error } = await admin.rpc(fn, args ?? {})
        if (error) throw error
        return data as never
      },
    },
    auth: {
      async getUser(token) {
        // Auth checks the signature, expiry and session, so this token's claims can be trusted
        // (auth.getClaims() does the same for HS256 projects) without a second round trip.
        const { data, error } = await admin.auth.getUser(token)
        if (error || !data.user) return null
        return {
          id: data.user.id,
          isAnonymous: data.user.is_anonymous ?? false,
          aal: accessTokenAal(token),
          hasVerifiedFactor: (data.user.factors ?? []).some((f) => f.status === 'verified'),
        }
      },
    },
    authAdmin: {
      async createUser({ email, password, fullName }) {
        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        })
        if (error) {
          if (error.code === 'email_exists' || /already been registered/i.test(error.message))
            return null
          throw error
        }
        return { id: data.user.id }
      },
    },
    messages: createMessageSender(getEnv),
    razorpay:
      cfg.razorpayKeyId && cfg.razorpayKeySecret
        ? createRazorpayClient({ keyId: cfg.razorpayKeyId, keySecret: cfg.razorpayKeySecret })
        : undefined,
  }
}
