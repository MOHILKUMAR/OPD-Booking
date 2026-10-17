// Cloudflare Turnstile (free CAPTCHA) for Supabase Auth's CAPTCHA protection on anonymous
// sign-in. Rendered only when VITE_TURNSTILE_SITE_KEY is set; the script is loaded on demand, so
// pages without the widget never contact challenges.cloudflare.com.
import { AlertCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { defineMessages, useT } from '@/i18n'

const messages = defineMessages({
  en: {
    loadFailed:
      'The security check could not load. Check your connection, turn off content blockers for this site, and reload the page.',
  },
  hi: {
    loadFailed:
      'सुरक्षा जाँच लोड नहीं हो सकी। अपना इंटरनेट कनेक्शन जाँचें, इस साइट के लिए कंटेंट ब्लॉकर बंद करें और पेज फिर से लोड करें।',
  },
})

interface TurnstileRenderOptions {
  sitekey: string
  action?: string
  theme?: 'auto' | 'light' | 'dark'
  size?: 'normal' | 'flexible' | 'compact'
  callback: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
}

declare global {
  interface Window {
    turnstile?: {
      render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined
      remove(widgetId: string): void
    }
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | null = null

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_URL
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('Could not load the security check.'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/**
 * Renders one Turnstile widget and reports its token (null when it expires or fails). Tokens are
 * single-use: remount the component (change its `key`) to get a fresh one after a sign-in attempt.
 */
export function Turnstile({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string
  action?: string
  onToken: (token: string | null) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  const [failed, setFailed] = useState(false)
  const t = useT(messages)

  useEffect(() => {
    onTokenRef.current = onToken
  })

  useEffect(() => {
    let cancelled = false
    let widgetId: string | undefined
    loadTurnstile().then(
      () => {
        const el = container.current
        if (cancelled || !el || !window.turnstile) return
        widgetId = window.turnstile.render(el, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          // "flexible" needs at least 300 px; very narrow phones get the compact widget.
          size: el.offsetWidth >= 300 ? 'flexible' : 'compact',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
      if (widgetId) window.turnstile?.remove(widgetId)
      onTokenRef.current(null)
    }
  }, [siteKey, action])

  if (failed) {
    return (
      <p className="flex items-center gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        {t('loadFailed')}
      </p>
    )
  }
  return <div ref={container} className="min-h-[65px]" />
}
