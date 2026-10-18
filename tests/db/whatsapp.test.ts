import { afterAll, describe, expect, it } from 'vitest'
import {
  anon,
  book,
  createFixture,
  Db,
  expectMqError,
  expectPermissionDenied,
  openSession,
  service,
  user,
  type BookingResult,
  type Fixture,
} from './helpers'

const db = new Db()
afterAll(() => db.close())

const consent = (b: BookingResult, enabled: boolean, language = 'hi', key = b.access_key) =>
  db.rpc(anon, 'set_whatsapp_alerts', {
    p_booking_reference: b.booking_reference,
    p_access_key: key,
    p_enabled: enabled,
    p_language: language,
  })

const view = (b: BookingResult) =>
  db.rpc(anon, 'get_booking', {
    p_booking_reference: b.booking_reference,
    p_access_key: b.access_key,
  })

const whatsappRows = (appointmentId: string) =>
  db.sql<{ id: string; status: string; kind: string; error: string | null }>(
    `select id, status, kind, error from public.notifications
     where appointment_id = $1 and channel = 'WHATSAPP' order by created_at`,
    [appointmentId],
  )

async function hospitalWithBooking(whatsapp: boolean): Promise<[Fixture, BookingResult]> {
  const f = await createFixture(db, {
    hospital: { whatsapp_alerts_enabled: whatsapp, turn_alert_ahead: 3 },
  })
  return [f, await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today })]
}

describe('WhatsApp consent (tracking page)', () => {
  it('is offered only when the hospital enabled WhatsApp', async () => {
    const [, b] = await hospitalWithBooking(false)
    expect((await view(b)).whatsapp).toEqual({ available: false, enabled: false, language: 'en' })
    await expectMqError(consent(b, true), 'MQ_WHATSAPP_UNAVAILABLE')
  })

  it('needs the tracking key; opting in and out is recorded without the phone number', async () => {
    const [f, b] = await hospitalWithBooking(true)
    await expectMqError(consent(b, true, 'hi', 'wrong-key'), 'MQ_NOT_FOUND')
    expect(await consent(b, true, 'hi')).toEqual({ enabled: true, language: 'hi' })
    expect((await view(b)).whatsapp).toEqual({ available: true, enabled: true, language: 'hi' })
    expect(await consent(b, false, 'en')).toEqual({ enabled: false, language: 'en' })
    const audits = await db.sql<{ action: string; details: Record<string, unknown> }>(
      `select action, details from public.audit_logs
       where hospital_id = $1 and action like 'appointment.whatsapp_%' order by id`,
      [f.hospitalId],
    )
    expect(audits.map((a) => a.action)).toEqual([
      'appointment.whatsapp_opt_in',
      'appointment.whatsapp_opt_out',
    ])
    expect(JSON.stringify(audits)).not.toMatch(/[6-9]\d{9}/)
  })

  it('cannot be turned on for a cancelled booking', async () => {
    const [f] = await hospitalWithBooking(true)
    // tomorrow: today's all-day test session has already started, so it cannot be cancelled online
    const b = await book(db, f.users.patientB, { shiftId: f.shiftId, date: f.tomorrow })
    await db.rpc(anon, 'cancel_booking', {
      p_booking_reference: b.booking_reference,
      p_access_key: b.access_key,
      p_reason: null,
    })
    await expectMqError(consent(b, true), 'MQ_WHATSAPP_UNAVAILABLE')
  })
})

describe('WhatsApp queue', () => {
  it('queues a copy only for patients who opted in, in their language', async () => {
    const f = await createFixture(db, { hospital: { whatsapp_alerts_enabled: true } })
    const yes = await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today })
    const no = await book(db, f.users.patientB, { shiftId: f.shiftId, date: f.today })
    await consent(yes, true, 'hi')
    await openSession(db, f)
    expect((await whatsappRows(yes.appointment_id)).map((r) => [r.kind, r.status])).toEqual([
      ['TURN_NEAR', 'PENDING'],
    ])
    expect(await whatsappRows(no.appointment_id)).toEqual([])
    // never listed in the app
    expect((await view(yes)).notifications.map((n: { kind: string }) => n.kind)).toEqual([
      'TURN_NEAR',
      'BOOKED',
    ])

    const claimed = await db.rpc<
      { id: string; language: string; hospital: string; data: object }[]
    >(service, 'svc_claim_outbound_notifications', { p_limit: 100 })
    const queuedId = (await whatsappRows(yes.appointment_id))[0]!.id
    const mine = claimed.find((c) => c.id === queuedId)
    expect(mine).toMatchObject({
      channel: 'WHATSAPP',
      language: 'hi',
      hospital: 'Test Hospital',
      data: { token_no: 1, ahead: 0, doctor: 'Dr. Test One' },
    })
    await db.rpc(service, 'svc_finish_outbound_notification', {
      p_id: mine!.id,
      p_ok: true,
      p_provider_id: 'wamid.TEST1',
    })
    // a failed-delivery webhook marks it
    expect(
      await db.rpc(service, 'svc_record_message_status', {
        p_provider_message_id: 'wamid.TEST1',
        p_status: 'failed',
        p_error: '131026 Message undeliverable',
      }),
    ).toBe('RECORDED')
    expect((await whatsappRows(yes.appointment_id))[0]).toMatchObject({
      status: 'FAILED',
      error: '131026 Message undeliverable',
    })
    expect(
      await db.rpc(service, 'svc_record_message_status', {
        p_provider_message_id: 'wamid.TEST1',
        p_status: 'delivered',
      }),
    ).toBe('IGNORED')
  })

  it('nothing is queued while the hospital switch is off, even with consent', async () => {
    const [f, b] = await hospitalWithBooking(true)
    await consent(b, true)
    await db.sql(`update public.hospitals set whatsapp_alerts_enabled = false where id = $1`, [
      f.hospitalId,
    ])
    await openSession(db, f)
    expect(await whatsappRows(b.appointment_id)).toEqual([])
  })

  it('a STOP reply withdraws consent for that number and drops queued copies', async () => {
    const f = await createFixture(db, { hospital: { whatsapp_alerts_enabled: true } })
    const phone = `9${String(Date.now()).slice(-9)}`
    const b = await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today, phone })
    await consent(b, true)
    await openSession(db, f)
    expect((await whatsappRows(b.appointment_id))[0]!.status).toBe('PENDING')

    await expectPermissionDenied(
      db.query(user(f.users.admin), `select public.svc_whatsapp_opt_out($1)`, [`91${phone}`]),
    )
    expect(await db.rpc(service, 'svc_whatsapp_opt_out', { p_phone: `91${phone}` })).toBe(1)
    expect((await view(b)).whatsapp.enabled).toBe(false)
    expect((await whatsappRows(b.appointment_id))[0]).toMatchObject({
      status: 'FAILED',
      error: 'Patient opted out',
    })
    expect(await db.rpc(service, 'svc_whatsapp_opt_out', { p_phone: 'not-a-phone' })).toBe(0)
  })
})
