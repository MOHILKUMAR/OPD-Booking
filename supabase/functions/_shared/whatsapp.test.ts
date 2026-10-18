// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { automationHandler, STOP_WORDS, whatsappWebhookHandler, type Deps } from './handlers.ts'
import { loadConfig } from './http.ts'
import {
  createMessageSender,
  templateParameters,
  whatsappCloudSender,
  whatsappConfigFromEnv,
  type OutboundMessage,
} from './messaging.ts'

const env = {
  WHATSAPP_ACCESS_TOKEN: 'EAAG-test-token',
  WHATSAPP_PHONE_NUMBER_ID: '1234567890',
}
const turnNear: OutboundMessage = {
  channel: 'WHATSAPP',
  phone: '9876543210',
  kind: 'TURN_NEAR',
  text: 'English text',
  data: { token_no: 12, ahead: 2, doctor: 'Dr. Vikram Iyer (Demo)', room: '4' },
  language: 'hi',
  hospital: 'MediQueue Demo Hospital',
}

function fakeFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
  )
}

describe('WhatsApp Cloud API sender', () => {
  it('is configured only by the two secrets, with defaults for the rest', () => {
    expect(whatsappConfigFromEnv(() => undefined)).toBeNull()
    expect(whatsappConfigFromEnv((k) => env[k as keyof typeof env])).toEqual({
      accessToken: 'EAAG-test-token',
      phoneNumberId: '1234567890',
      graphVersion: 'v23.0',
      templates: { TURN_NEAR: 'mediqueue_turn_near', VISIT_REMINDER: 'mediqueue_visit_reminder' },
    })
  })

  it('sends the approved template in the patient language', async () => {
    const fetch = fakeFetch(200, { messages: [{ id: 'wamid.ABC' }] })
    const sender = whatsappCloudSender(
      whatsappConfigFromEnv((k) => env[k as keyof typeof env])!,
      fetch,
    )
    expect(await sender.send(turnNear)).toEqual({ ok: true, id: 'wamid.ABC' })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('https://graph.facebook.com/v23.0/1234567890/messages')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer EAAG-test-token')
    expect(JSON.parse(init!.body as string)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210',
      type: 'template',
      template: {
        name: 'mediqueue_turn_near',
        language: { code: 'hi' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'MediQueue Demo Hospital' },
              { type: 'text', text: '12' },
              { type: 'text', text: '2' },
              { type: 'text', text: 'Dr. Vikram Iyer (Demo) (कक्ष 4)' },
            ],
          },
        ],
      },
    })
  })

  it('fills the visit reminder template in English', () => {
    expect(
      templateParameters({
        ...turnNear,
        kind: 'VISIT_REMINDER',
        language: 'en',
        data: { token_no: 3, doctor: 'Dr. A', room: null, start_time: '09:30' },
      }),
    ).toEqual(['MediQueue Demo Hospital', '3', 'Dr. A', '9:30 AM'])
    // template variables may not contain line breaks
    expect(
      templateParameters({ ...turnNear, hospital: 'Line\none', data: { ...turnNear.data } })![0],
    ).toBe('Line one')
  })

  it('reports API errors without phone numbers, and refuses kinds without a template', async () => {
    const fetch = fakeFetch(400, {
      error: { code: 131030, message: 'Recipient +91 98765 43210 not in allowed list' },
    })
    const sender = whatsappCloudSender(
      whatsappConfigFromEnv((k) => env[k as keyof typeof env])!,
      fetch,
    )
    const result = await sender.send(turnNear)
    expect(result).toEqual({ ok: false, error: '131030 Recipient … not in allowed list' })
    expect(await sender.send({ ...turnNear, kind: 'DELAY' })).toEqual({
      ok: false,
      error: 'No WhatsApp template for DELAY',
    })
    const down = whatsappCloudSender(
      whatsappConfigFromEnv((k) => env[k as keyof typeof env])!,
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    expect(await down.send(turnNear)).toEqual({ ok: false, error: 'WhatsApp API unreachable' })
  })

  it('routes WhatsApp copies to Meta and SMS copies to the SMS provider (none)', async () => {
    const fetch = fakeFetch(200, { messages: [{ id: 'wamid.X' }] })
    const sender = createMessageSender((k) => env[k as keyof typeof env], fetch)
    expect(sender.name).toBe('whatsapp_cloud')
    expect(await sender.send(turnNear)).toEqual({ ok: true, id: 'wamid.X' })
    expect(await sender.send({ ...turnNear, channel: 'SMS' })).toEqual({
      ok: false,
      error: 'No SMS/WhatsApp provider is configured',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
const APP_SECRET = 'whatsapp-app-secret-for-tests'
const VERIFY = 'verify-token-for-tests-0123456789'

function webhookDeps(rpc: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const deps: Deps = {
    cfg: loadConfig(
      (k) => ({ WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY })[k as string],
    ),
    db: {
      rpc: (async (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args: args ?? {} })
        const impl = rpc[fn]
        if (!impl) throw new Error(`unexpected rpc ${fn}`)
        return impl(args ?? {})
      }) as Deps['db']['rpc'],
    },
    auth: { getUser: async () => null },
    log: () => {},
  }
  return { deps, calls }
}

const signed = (body: unknown, secret = APP_SECRET) => {
  const raw = JSON.stringify(body)
  return new Request('https://x/whatsapp-webhook', {
    method: 'POST',
    headers: {
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
    },
    body: raw,
  })
}

const payload = (value: object) => ({ entry: [{ changes: [{ field: 'messages', value }] }] })

describe('WhatsApp webhook', () => {
  it('answers the subscription check only with the right verify token', async () => {
    const { deps } = webhookDeps()
    const get = (token: string) =>
      whatsappWebhookHandler(deps)(
        new Request(
          `https://x/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=4242`,
        ),
      )
    const ok = await get(VERIFY)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('4242')
    expect((await get('wrong')).status).toBe(403)
  })

  it('rejects unsigned or wrongly signed deliveries', async () => {
    const { deps, calls } = webhookDeps()
    const body = payload({ messages: [{ from: '919876543210', text: { body: 'STOP' } }] })
    expect((await whatsappWebhookHandler(deps)(signed(body, 'other-secret'))).status).toBe(401)
    expect(
      (
        await whatsappWebhookHandler(deps)(
          new Request('https://x', { method: 'POST', body: JSON.stringify(body) }),
        )
      ).status,
    ).toBe(401)
    expect(calls).toEqual([])
  })

  it('STOP (English or Hindi) withdraws consent; failed deliveries are recorded', async () => {
    const { deps, calls } = webhookDeps({
      svc_whatsapp_opt_out: () => 1,
      svc_record_message_status: () => 'RECORDED',
    })
    const res = await whatsappWebhookHandler(deps)(
      signed(
        payload({
          messages: [
            { from: '919876543210', type: 'text', text: { body: ' Stop ' } },
            { from: '919123456789', type: 'text', text: { body: 'बंद करें' } },
            { from: '919000000000', type: 'text', text: { body: 'When is my turn?' } },
          ],
          statuses: [
            { id: 'wamid.1', status: 'delivered' },
            { id: 'wamid.2', status: 'failed', errors: [{ code: 131026, title: 'Undeliverable' }] },
          ],
        }),
      ),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, opt_outs: 2, failures: 1 })
    expect(calls).toEqual([
      { fn: 'svc_whatsapp_opt_out', args: { p_phone: '919876543210' } },
      { fn: 'svc_whatsapp_opt_out', args: { p_phone: '919123456789' } },
      {
        fn: 'svc_record_message_status',
        args: {
          p_provider_message_id: 'wamid.2',
          p_status: 'failed',
          p_error: '131026 Undeliverable',
        },
      },
    ])
    expect(STOP_WORDS.test('unsubscribe')).toBe(true)
    expect(STOP_WORDS.test('please stop calling')).toBe(false)
  })

  it('asks Meta to retry when the database is unavailable', async () => {
    const { deps } = webhookDeps({
      svc_whatsapp_opt_out: () => {
        throw new Error('connection refused')
      },
    })
    const res = await whatsappWebhookHandler(deps)(
      signed(payload({ messages: [{ from: '919876543210', text: { body: 'STOP' } }] })),
    )
    expect(res.status).toBe(500)
  })
})

describe('automation with WhatsApp', () => {
  it('passes language and hospital to the sender and stores the message id', async () => {
    const finish = vi.fn(() => null)
    const send = vi.fn(async () => ({ ok: true as const, id: 'wamid.OK' }))
    const { deps } = webhookDeps({
      svc_claim_outbound_notifications: () => [
        {
          id: 'n-1',
          channel: 'WHATSAPP',
          kind: 'TURN_NEAR',
          phone: '9876543210',
          text: 't',
          data: { token_no: 1 },
          language: 'hi',
          hospital: 'H',
        },
      ],
      svc_finish_outbound_notification: finish,
    })
    deps.cfg = loadConfig(
      (k) => ({ AUTOMATION_TOKEN: 'automation-token-0123456789abcdef' })[k as string],
    )
    deps.messages = { name: 'whatsapp_cloud', send }
    const res = await automationHandler(deps)(
      new Request('https://x/automation', {
        method: 'POST',
        headers: { 'x-automation-token': 'automation-token-0123456789abcdef' },
      }),
    )
    expect((await res.json()).messages).toEqual({
      provider: 'whatsapp_cloud',
      claimed: 1,
      sent: 1,
      failed: 0,
    })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ language: 'hi', hospital: 'H' }))
    expect(finish).toHaveBeenCalledWith({
      p_id: 'n-1',
      p_ok: true,
      p_error: null,
      p_provider_id: 'wamid.OK',
    })
  })
})
