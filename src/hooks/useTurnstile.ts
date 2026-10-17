import { useState } from 'react'
import { env } from '@/lib/env'

/**
 * Token state for a <Turnstile> widget in front of a Supabase Auth sign-in (Auth's CAPTCHA
 * protection covers anonymous and password sign-ins). `siteKey` is null, and so no widget is
 * shown and no token is sent, when VITE_TURNSTILE_SITE_KEY is unset or `needed` is false.
 * Each token works once: call `renew()` after every sign-in attempt that used it.
 */
export function useTurnstile(needed = true) {
  const siteKey = needed ? env.VITE_TURNSTILE_SITE_KEY : null
  const [token, setToken] = useState<string | null>(null)
  const [round, setRound] = useState(0)
  return {
    siteKey,
    /** Token to pass as `captchaToken`; null when no CAPTCHA is in use. */
    token: siteKey ? token : null,
    /** True while the widget is shown but has not produced a token yet. */
    missing: !!siteKey && !token,
    /** Use as the widget's `key`: a new round remounts it for a fresh token. */
    round,
    setToken,
    renew: () => {
      setToken(null)
      setRound((n) => n + 1)
    },
  }
}
