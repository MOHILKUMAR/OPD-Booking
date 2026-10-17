import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { notificationText } from '@/lib/notification-text'
import type { BookingView } from '@/types/database'

export type AlertPermission = 'unsupported' | 'default' | 'granted' | 'denied'

/** Notification kinds worth interrupting the patient for. */
const ALERT_KINDS = new Set([
  'TURN_NEAR',
  'CALLED',
  'SKIPPED',
  'DELAY',
  'VISIT_REMINDER',
  'CANCELLED',
  'PAYMENT_UNMATCHED',
  'REFUND_INITIATED',
  'REFUND_PROCESSED',
])

function permissionNow(): AlertPermission {
  if (typeof window === 'undefined' || !('Notification' in window) || !window.isSecureContext)
    return 'unsupported'
  return Notification.permission
}

// Per-device memory (alerts on/off per booking, notifications already announced). Browser
// storage can be unavailable; then alerts simply start off.
const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value === null) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, value)
    } catch {
      // not remembered after this visit
    }
  },
}

async function registerWorker() {
  try {
    await navigator.serviceWorker?.register('/sw.js', { scope: '/' })
  } catch {
    // Desktop browsers can still use new Notification()
  }
}

async function showSystemNotification(title: string, body: string, tag: string, url: string) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/')
    if (reg) {
      await reg.showNotification(title, { body, tag, icon: '/favicon.svg', data: { url } })
    } else {
      new Notification(title, { body, tag, icon: '/favicon.svg' })
    }
    navigator.vibrate?.([200, 100, 200])
  } catch {
    // the update still shows on the page
  }
}

/**
 * The patient's choice to get phone/desktop alerts for one booking on this device, and the
 * browser's notification permission. Alerts are active only with both.
 */
export function useAlertSettings(reference: string) {
  const enabledKey = `mq.alerts.${reference}`
  const [permission, setPermission] = useState<AlertPermission>(permissionNow)
  const [enabled, setEnabled] = useState(() => store.get(enabledKey) === '1')
  const active = enabled && permission === 'granted'

  useEffect(() => {
    if (active) void registerWorker()
  }, [active])

  const enable = useCallback(async () => {
    if (permissionNow() === 'unsupported') return
    const result =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') {
      await registerWorker()
      store.set(enabledKey, '1')
      setEnabled(true)
    }
  }, [enabledKey])

  const disable = useCallback(() => {
    store.set(enabledKey, null)
    setEnabled(false)
  }, [enabledKey])

  return { permission, enabled: active, enable, disable }
}

export type AlertSettings = ReturnType<typeof useAlertSettings>

/**
 * Announces new booking notifications ("your turn is near", called, delays, refunds) as a toast
 * on the page and, with `systemAlerts`, as a phone/desktop notification while the tracking page
 * is open (also in a background tab). Nothing is sent to a server: the alerts come from the
 * booking data the page already fetches.
 */
export function useAnnounceNotifications(
  booking: BookingView | undefined,
  reference: string,
  systemAlerts: boolean,
) {
  const seenKey = `mq.seen.${reference}`
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    const items = booking?.notifications
    if (!booking || !items) return
    if (!seen.current) {
      const saved = store.get(seenKey)
      if (saved === null) {
        // first visit on this device: nothing to announce, only remember what is already there
        seen.current = new Set(items.map((n) => n.id))
        store.set(seenKey, JSON.stringify([...seen.current]))
        return
      }
      try {
        seen.current = new Set(JSON.parse(saved) as string[])
      } catch {
        seen.current = new Set()
      }
    }
    const fresh = items.filter((n) => n.id && !seen.current!.has(n.id)).reverse()
    if (!fresh.length) return
    for (const n of fresh) {
      seen.current.add(n.id)
      if (!ALERT_KINDS.has(n.kind)) continue
      const { title, body } = notificationText(n, booking)
      if (document.visibilityState === 'visible') toast.info(title, { description: body })
      if (systemAlerts) void showSystemNotification(title, body, n.id, window.location.href)
    }
    store.set(seenKey, JSON.stringify([...seen.current].slice(-50)))
  }, [booking, systemAlerts, seenKey])
}
