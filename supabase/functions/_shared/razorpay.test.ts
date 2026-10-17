// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createRazorpayClient,
  GatewayError,
  hmacSha256Hex,
  timingSafeEqualHex,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from './razorpay.ts'

const SECRET = 'test_key_secret_123'
const nodeHmac = (secret: string, msg: string) =>
  createHmac('sha256', secret).update(msg).digest('hex')

describe('signatures', () => {
  it('matches Node crypto HMAC-SHA256', async () => {
    expect(await hmacSha256Hex(SECRET, 'order_A|pay_B')).toBe(nodeHmac(SECRET, 'order_A|pay_B'))
  })

  it('verifies a genuine checkout signature and rejects tampering', async () => {
    const signature = nodeHmac(SECRET, 'order_ABC123|pay_XYZ789')
    expect(
      await verifyPaymentSignature({
        orderId: 'order_ABC123',
        paymentId: 'pay_XYZ789',
        signature,
        keySecret: SECRET,
      }),
    ).toBe(true)
    // swapped payment id, other order, wrong secret, truncated
    expect(
      await verifyPaymentSignature({
        orderId: 'order_ABC123',
        paymentId: 'pay_OTHER1',
        signature,
        keySecret: SECRET,
      }),
    ).toBe(false)
    expect(
      await verifyPaymentSignature({
        orderId: 'order_OTHER',
        paymentId: 'pay_XYZ789',
        signature,
        keySecret: SECRET,
      }),
    ).toBe(false)
    expect(
      await verifyPaymentSignature({
        orderId: 'order_ABC123',
        paymentId: 'pay_XYZ789',
        signature,
        keySecret: 'wrong',
      }),
    ).toBe(false)
    expect(
      await verifyPaymentSignature({
        orderId: 'order_ABC123',
        paymentId: 'pay_XYZ789',
        signature: signature.slice(1),
        keySecret: SECRET,
      }),
    ).toBe(false)
  })

  it('verifies webhooks against the raw body only', async () => {
    const raw =
      '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_1","amount":5000}}}}'
    const sig = nodeHmac('whsec', raw)
    expect(await verifyWebhookSignature(raw, sig, 'whsec')).toBe(true)
    // the same JSON re-serialized with different spacing must fail
    expect(
      await verifyWebhookSignature(JSON.stringify(JSON.parse(raw), null, 1), sig, 'whsec'),
    ).toBe(false)
    expect(await verifyWebhookSignature(raw, null, 'whsec')).toBe(false)
  })

  it('timingSafeEqualHex', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true)
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false)
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false)
  })
})

describe('Razorpay client', () => {
  it('sends basic auth and the refund idempotency header', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: 'rfnd_1', payment_id: 'pay_1', amount: 5000, status: 'pending' }),
        ),
    )
    const client = createRazorpayClient({ keyId: 'rzp_test_key', keySecret: 'sec', fetchImpl })
    const refund = await client.createRefund({
      paymentId: 'pay_1',
      amount: 5000,
      idempotencyKey: 'idem-1234567890',
    })
    expect(refund.status).toBe('pending')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.razorpay.com/v1/payments/pay_1/refund')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Basic ${btoa('rzp_test_key:sec')}`)
    expect(headers['X-Refund-Idempotency']).toBe('idem-1234567890')
    expect(JSON.parse(init.body as string)).toMatchObject({ amount: 5000, speed: 'normal' })
  })

  it('maps gateway errors', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' },
          }),
          { status: 400 },
        ),
    )
    const client = createRazorpayClient({ keyId: 'rzp_test_key', keySecret: 'sec', fetchImpl })
    await expect(client.fetchPayment('pay_missing')).rejects.toBeInstanceOf(GatewayError)
    await expect(client.fetchPayment('pay_missing')).rejects.toThrow(
      'The id provided does not exist',
    )
  })
})
