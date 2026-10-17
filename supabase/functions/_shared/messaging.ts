// Outbound SMS/WhatsApp adapter. Patient alerts are free in-app notifications; a copy is queued
// for SMS only when a hospital turns on sms_alerts_enabled, and it is sent through the provider
// named by the MESSAGE_PROVIDER secret. No provider is built in: in India each one needs a paid
// account, DLT registration and approved templates, so adding one waits until the provider and
// its cost are approved. A provider is one object implementing MessageSender.

export interface OutboundMessage {
  channel: 'SMS' | 'WHATSAPP'
  /** 10-digit Indian mobile number (the database stores no other format). */
  phone: string
  /** Notification kind, e.g. TURN_NEAR or VISIT_REMINDER (maps to a DLT template). */
  kind: string
  /** English text written by the database; templates can use `data` instead. */
  text: string
  data: Record<string, unknown>
}

export type SendResult = { ok: true } | { ok: false; error: string }

export interface MessageSender {
  readonly name: string
  send(message: OutboundMessage): Promise<SendResult>
}

/** Default: nothing is sent and each queued copy is marked FAILED with this reason. */
export const noProvider: MessageSender = {
  name: 'none',
  send: () => Promise.resolve({ ok: false, error: 'No SMS/WhatsApp provider is configured' }),
}

export function createMessageSender(get: (name: string) => string | undefined): MessageSender {
  const name = (get('MESSAGE_PROVIDER') ?? '').trim().toLowerCase()
  if (!name || name === 'none') return noProvider
  return {
    name,
    send: () => Promise.resolve({ ok: false, error: `Unknown MESSAGE_PROVIDER "${name}"` }),
  }
}
