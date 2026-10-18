// Outbound SMS/WhatsApp. Patient alerts are free in-app notifications; paid copies are queued only
// when a hospital turns them on (and, for WhatsApp, the patient opted in for that booking), and
// the `automation` Edge Function sends them through a MessageSender.
//   * WhatsApp: Meta's WhatsApp Cloud API with approved templates, active once the
//     WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID secrets are set.
//   * SMS: the provider named by MESSAGE_PROVIDER. None is built in: in India each one needs a
//     paid account, DLT registration and approved templates.
// Without a sender a queued copy is marked FAILED and nothing is sent.

export interface OutboundMessage {
  channel: 'SMS' | 'WHATSAPP'
  /** 10-digit Indian mobile number (the database stores no other format). */
  phone: string
  /** Notification kind: TURN_NEAR or VISIT_REMINDER (one approved template each). */
  kind: string
  /** English text written by the database; templates use `data` instead. */
  text: string
  data: Record<string, unknown>
  /** Language the patient chose when opting in (WhatsApp template language). */
  language?: 'en' | 'hi'
  hospital?: string
}

export type SendResult = { ok: true; id?: string } | { ok: false; error: string }

export interface MessageSender {
  readonly name: string
  send(message: OutboundMessage): Promise<SendResult>
}

/** Default: nothing is sent and each queued copy is marked FAILED with this reason. */
export const noProvider: MessageSender = {
  name: 'none',
  send: () => Promise.resolve({ ok: false, error: 'No SMS/WhatsApp provider is configured' }),
}

function smsSender(get: (name: string) => string | undefined): MessageSender {
  const name = (get('MESSAGE_PROVIDER') ?? '').trim().toLowerCase()
  if (!name || name === 'none') return noProvider
  return {
    name,
    send: () => Promise.resolve({ ok: false, error: `Unknown MESSAGE_PROVIDER "${name}"` }),
  }
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API (Meta)
// ---------------------------------------------------------------------------
export interface WhatsAppConfig {
  accessToken: string
  phoneNumberId: string
  /** Graph API version, e.g. v23.0 */
  graphVersion: string
  /** Approved template name per notification kind (created in both English and Hindi). */
  templates: Record<string, string>
}

export function whatsappConfigFromEnv(
  get: (name: string) => string | undefined,
): WhatsAppConfig | null {
  const accessToken = get('WHATSAPP_ACCESS_TOKEN')?.trim()
  const phoneNumberId = get('WHATSAPP_PHONE_NUMBER_ID')?.trim()
  if (!accessToken || !phoneNumberId) return null
  return {
    accessToken,
    phoneNumberId,
    graphVersion: get('WHATSAPP_GRAPH_VERSION')?.trim() || 'v23.0',
    templates: {
      TURN_NEAR: get('WHATSAPP_TEMPLATE_TURN_NEAR')?.trim() || 'mediqueue_turn_near',
      VISIT_REMINDER: get('WHATSAPP_TEMPLATE_VISIT_REMINDER')?.trim() || 'mediqueue_visit_reminder',
    },
  }
}

// Template variables may not contain new lines, tabs or more than 4 spaces in a row.
const param = (value: unknown) =>
  String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim()
    .slice(0, 200) || '-'

function clock12(hhmm: unknown): string {
  const [h, m] = String(hhmm ?? '')
    .split(':')
    .map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(hhmm ?? '')
  return `${h! % 12 === 0 ? 12 : h! % 12}:${String(m).padStart(2, '0')} ${h! >= 12 ? 'PM' : 'AM'}`
}

/**
 * Body variables, in template order:
 *   mediqueue_turn_near       {{1}} hospital  {{2}} token  {{3}} patients ahead  {{4}} doctor (room)
 *   mediqueue_visit_reminder  {{1}} hospital  {{2}} token  {{3}} doctor (room)   {{4}} start time
 */
export function templateParameters(m: OutboundMessage): string[] | null {
  const d = m.data
  const room = d.room ? (m.language === 'hi' ? ` (कक्ष ${d.room})` : ` (Room ${d.room})`) : ''
  const place = `${d.doctor ?? ''}${room}`
  switch (m.kind) {
    case 'TURN_NEAR':
      return [m.hospital, d.token_no, d.ahead, place].map(param)
    case 'VISIT_REMINDER':
      return [m.hospital, d.token_no, place, clock12(d.start_time)].map(param)
    default:
      return null
  }
}

// Provider error text may echo request details; never let a phone number reach the logs.
const redactNumbers = (text: string) => text.replace(/\+?\d[\d\s-]{8,}\d/g, '…')

export function whatsappCloudSender(
  cfg: WhatsAppConfig,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): MessageSender {
  return {
    name: 'whatsapp_cloud',
    async send(m) {
      if (m.channel !== 'WHATSAPP') return { ok: false, error: 'Not a WhatsApp message' }
      const template = cfg.templates[m.kind]
      const params = templateParameters(m)
      if (!template || !params) return { ok: false, error: `No WhatsApp template for ${m.kind}` }
      let res: Response
      try {
        res = await fetchImpl(
          `https://graph.facebook.com/${encodeURIComponent(cfg.graphVersion)}/${encodeURIComponent(cfg.phoneNumberId)}/messages`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${cfg.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: `91${m.phone}`,
              type: 'template',
              template: {
                name: template,
                language: { code: m.language === 'hi' ? 'hi' : 'en' },
                components: [
                  { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
                ],
              },
            }),
            signal: AbortSignal.timeout(10_000),
          },
        )
      } catch {
        return { ok: false, error: 'WhatsApp API unreachable' }
      }
      const body = (await res.json().catch(() => null)) as {
        messages?: { id?: string }[]
        error?: { code?: number; message?: string }
      } | null
      const id = body?.messages?.[0]?.id
      if (res.ok && id) return { ok: true, id }
      const e = body?.error
      return {
        ok: false,
        error: redactNumbers(
          e ? `${e.code ?? res.status} ${e.message ?? ''}`.trim() : `HTTP ${res.status}`,
        ).slice(0, 300),
      }
    },
  }
}

/** SMS from MESSAGE_PROVIDER, WhatsApp from the WHATSAPP_* secrets; each falls back to none. */
export function createMessageSender(
  get: (name: string) => string | undefined,
  fetchImpl?: typeof fetch,
): MessageSender {
  const sms = smsSender(get)
  const wa = whatsappConfigFromEnv(get)
  if (!wa) return sms
  const whatsapp = whatsappCloudSender(wa, fetchImpl)
  return {
    name: sms === noProvider ? whatsapp.name : `${sms.name}+${whatsapp.name}`,
    send: (m) => (m.channel === 'WHATSAPP' ? whatsapp : sms).send(m),
  }
}
