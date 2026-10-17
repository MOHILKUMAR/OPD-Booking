import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  anon,
  book,
  createFixture,
  Db,
  expectMqError,
  expectPermissionDenied,
  openSession,
  queueAction,
  user,
  type BookingResult,
  type Fixture,
} from './helpers'

const db = new Db()
let f: Fixture
const bookings: BookingResult[] = []
afterAll(() => db.close())

beforeAll(async () => {
  f = await createFixture(db)
  for (const name of ['Asha Verma', 'Ravi Kumar', 'Meena Iyer']) {
    bookings.push(await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today, name }))
  }
  await openSession(db, f)
  const first = bookings[0]!.appointment_id
  for (const [by, action] of [
    [f.users.receptionist, 'ARRIVE'],
    [f.users.doctor, 'CALL'],
    [f.users.doctor, 'START'],
    [f.users.doctor, 'COMPLETE'],
  ] as const) {
    await queueAction(db, by, first, action)
  }
})

const exportAs = (by: string, kind: string, extra: Record<string, unknown> = {}) =>
  db.rpc(user(by), 'admin_export', {
    p_hospital_id: f.hospitalId,
    p_kind: kind,
    p_from: f.today,
    p_to: f.today,
    ...extra,
  })

describe('report exports', () => {
  it('appointments: report order, no patient details unless asked for', async () => {
    const out = await exportAs(f.users.admin, 'appointments')
    expect(out.has_more).toBe(false)
    expect(out.timezone).toBe('Asia/Kolkata')
    expect(out.rows.map((r: { token_no: number }) => r.token_no)).toEqual([1, 2, 3])
    expect(out.rows[0]).toMatchObject({
      session_date: f.today,
      doctor: 'Dr. Test One',
      department: 'General Medicine',
      source: 'ONLINE',
      status: 'COMPLETED',
      patient_name: null,
      patient_phone: null,
      patient_age: null,
    })
    expect(out.rows[0].completed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(JSON.stringify(out.rows)).not.toMatch(/Asha|Ravi|Meena/)

    const withPatients = await exportAs(f.users.admin, 'appointments', { p_include_patient: true })
    expect(withPatients.rows[1]).toMatchObject({ patient_name: 'Ravi Kumar', patient_age: 30 })
    expect(withPatients.rows[1].patient_phone).toMatch(/^[6-9]\d{9}$/)
  })

  it('pages through large exports and audits each export once', async () => {
    const before = await db.sql(
      `select count(*)::int as n from public.audit_logs where hospital_id = $1 and action = 'report.exported'`,
      [f.hospitalId],
    )
    const page1 = await exportAs(f.users.admin, 'appointments', { p_limit: 2 })
    expect(page1.rows).toHaveLength(2)
    expect(page1.has_more).toBe(true)
    const page2 = await exportAs(f.users.admin, 'appointments', { p_limit: 2, p_offset: 2 })
    expect(page2.rows.map((r: { token_no: number }) => r.token_no)).toEqual([3])
    expect(page2.has_more).toBe(false)
    const audits = await db.sql<{ details: Record<string, unknown> }>(
      `select details from public.audit_logs where hospital_id = $1 and action = 'report.exported' order by id`,
      [f.hospitalId],
    )
    expect(audits.length - (before[0] as { n: number }).n).toBe(1)
    expect(audits.at(-1)!.details).toEqual({
      from: f.today,
      to: f.today,
      include_patient_details: false,
    })
  })

  it('daily summary: one row per session with outcomes', async () => {
    const out = await exportAs(f.users.admin, 'daily_summary')
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toMatchObject({
      doctor: 'Dr. Test One',
      session_status: 'OPEN',
      tokens_issued: 3,
      online: 3,
      walk_in: 0,
      completed: 1,
      cancelled: 0,
      online_fees_rupees: 0,
    })
  })

  it('payments, refunds and audit log exports', async () => {
    expect((await exportAs(f.users.admin, 'payments')).rows).toEqual([])
    expect((await exportAs(f.users.admin, 'refunds')).rows).toEqual([])
    const audit = await exportAs(f.users.admin, 'audit')
    const actions = audit.rows.map((r: { action: string }) => r.action)
    expect(actions).toContain('queue.complete')
    expect(actions).toContain('report.exported')
    expect(typeof audit.rows[0].details).toBe('string')
  })

  it('administrators only; ranges and report names are validated', async () => {
    await expectMqError(exportAs(f.users.receptionist, 'appointments'), 'MQ_FORBIDDEN')
    await expectMqError(exportAs(f.users.doctor, 'audit'), 'MQ_FORBIDDEN')
    await expectPermissionDenied(
      db.query(anon, `select public.admin_export($1, 'appointments', current_date, current_date)`, [
        f.hospitalId,
      ]),
    )
    await expectMqError(exportAs(f.users.admin, 'patients'), 'MQ_INVALID_REQUEST')
    await expectMqError(
      exportAs(f.users.admin, 'appointments', { p_from: f.tomorrow, p_to: f.today }),
      'MQ_INVALID_RANGE',
    )
    await expectMqError(
      exportAs(f.users.admin, 'appointments', { p_from: '2025-01-01', p_to: '2026-06-01' }),
      'MQ_INVALID_RANGE',
    )
    // another hospital's administrator gets nothing
    const other = await createFixture(db)
    await expectMqError(
      db.rpc(user(other.users.admin), 'admin_export', {
        p_hospital_id: f.hospitalId,
        p_kind: 'appointments',
        p_from: f.today,
        p_to: f.today,
      }),
      'MQ_FORBIDDEN',
    )
  })
})
