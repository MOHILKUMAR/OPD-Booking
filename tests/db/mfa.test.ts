// Staff two-factor authentication at the database: once a staff user has a verified
// authenticator app, every staff role check needs an aal2 token, so a stolen password alone
// (aal1) cannot reach staff data through the API. Staff without a factor and patients are
// unaffected.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addMfaFactor,
  book,
  createFixture,
  Db,
  expectMqError,
  queueAction,
  user,
  type Aal,
  type BookingResult,
  type Fixture,
} from './helpers'

const db = new Db()
let f: Fixture
let booking: BookingResult
let bookingDoctor2: BookingResult
let inactiveDepartmentId: string

beforeAll(async () => {
  f = await createFixture(db)
  booking = await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today })
  bookingDoctor2 = await book(db, f.users.patientB, { shiftId: f.shift2Id, date: f.today })
  // inactive rows are visible to the hospital's staff only (app.is_staff)
  ;[{ id: inactiveDepartmentId }] = await db.sql<{ id: string }>(
    `insert into public.departments (hospital_id, name, is_active) values ($1, 'Closed Ward', false) returning id`,
    [f.hospitalId],
  )
  await addMfaFactor(db, f.users.admin)
  await addMfaFactor(db, f.users.doctor)
  // an enrolment abandoned before the code was confirmed does not count
  await addMfaFactor(db, f.users.receptionistDoctor2, 'unverified')
})
afterAll(() => db.close())

const admin = (aal: Aal) => user(f.users.admin, { aal })

describe('staff with a verified authenticator app need an aal2 token', () => {
  it.each<[string, Aal]>([
    ['a password-only (aal1) token', 'aal1'],
    ['a token without an aal claim', null],
  ])('an enrolled admin with %s is refused by every staff check', async (_, aal) => {
    // SECURITY DEFINER functions (app.is_admin / app.require_doctor_permission / app.can_access_doctor)
    await expectMqError(
      db.rpc(admin(aal), 'admin_dashboard', { p_hospital_id: f.hospitalId }),
      'MQ_FORBIDDEN',
    )
    await expectMqError(
      db.rpc(admin(aal), 'session_control', {
        p_shift_id: f.shiftId,
        p_session_date: f.today,
        p_action: 'OPEN',
      }),
      'MQ_FORBIDDEN',
    )
    await expectMqError(
      db.rpc(admin(aal), 'queue_stats', { p_queue_state_id: booking.queue_state_id }),
      'MQ_FORBIDDEN',
    )
    // RLS policies
    expect(
      await db.query(
        admin(aal),
        `update public.doctors set room_no = '7A' where id = $1 returning id`,
        [f.doctorId],
      ),
    ).toEqual([])
    await expect(
      db.query(
        admin(aal),
        `insert into public.departments (hospital_id, name) values ($1, 'Password Only')`,
        [f.hospitalId],
      ),
    ).rejects.toThrow(/row-level security/)
    expect(await db.query(admin(aal), `select id from public.appointments`)).toEqual([])
    expect(await db.query(admin(aal), `select id from public.audit_logs`)).toEqual([])
    expect(
      await db.query(admin(aal), `select id from public.departments where id = $1`, [
        inactiveDepartmentId,
      ]),
    ).toEqual([])
    // own role rows stay readable, so the app knows to ask for the code after the password
    const roles = await db.query(
      admin(aal),
      `select user_id, role from public.user_roles where hospital_id = $1`,
      [f.hospitalId],
    )
    expect(roles).toEqual([{ user_id: f.users.admin, role: 'admin' }])
  })

  it('the same admin with an aal2 token is allowed', async () => {
    const dashboard = await db.rpc(admin('aal2'), 'admin_dashboard', {
      p_hospital_id: f.hospitalId,
    })
    expect(dashboard).toHaveProperty('today', f.today)
    await db.rpc(admin('aal2'), 'session_control', {
      p_shift_id: f.shiftId,
      p_session_date: f.today,
      p_action: 'OPEN',
    })
    expect(
      await db.rpc(admin('aal2'), 'queue_stats', { p_queue_state_id: booking.queue_state_id }),
    ).toHaveProperty('queue')
    expect(
      await db.query(
        admin('aal2'),
        `update public.doctors set room_no = '7A' where id = $1 returning id`,
        [f.doctorId],
      ),
    ).toEqual([{ id: f.doctorId }])
    await db.query(
      admin('aal2'),
      `insert into public.departments (hospital_id, name) values ($1, 'With Code')`,
      [f.hospitalId],
    )
    const appointments = await db.query(admin('aal2'), `select id from public.appointments`)
    expect(appointments.map((r) => r.id).sort()).toEqual(
      [booking.appointment_id, bookingDoctor2.appointment_id].sort(),
    )
    expect(
      await db.query(admin('aal2'), `select id from public.departments where id = $1`, [
        inactiveDepartmentId,
      ]),
    ).toEqual([{ id: inactiveDepartmentId }])
    const roles = await db.query(
      admin('aal2'),
      `select id from public.user_roles where hospital_id = $1`,
      [f.hospitalId],
    )
    expect(roles).toHaveLength(5)
  })

  it('an enrolled doctor needs aal2 for their own queue as well', async () => {
    expect(await db.query(user(f.users.doctor), `select id from public.appointments`)).toEqual([])
    await expectMqError(
      db.rpc(user(f.users.doctor), 'queue_stats', { p_queue_state_id: booking.queue_state_id }),
      'MQ_FORBIDDEN',
    )
    const rows = await db.query(
      user(f.users.doctor, { aal: 'aal2' }),
      `select id from public.appointments`,
    )
    expect(rows.map((r) => r.id)).toEqual([booking.appointment_id])
  })
})

describe('callers without a verified factor behave as before', () => {
  it('staff without an authenticator app (or with an unfinished enrolment) work with aal1', async () => {
    // a fresh hospital where nobody has set up an authenticator app
    const fx = await createFixture(db)
    const a = await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today })
    await db.rpc(user(fx.users.admin), 'session_control', {
      p_shift_id: fx.shiftId,
      p_session_date: fx.today,
      p_action: 'OPEN',
    })
    expect(
      await db.rpc(user(fx.users.admin), 'admin_dashboard', { p_hospital_id: fx.hospitalId }),
    ).toHaveProperty('today', fx.today)
    await queueAction(db, fx.users.receptionist, a.appointment_id, 'ARRIVE')
    const rows = await db.query(user(fx.users.doctor), `select id, status from public.appointments`)
    expect(rows).toEqual([{ id: a.appointment_id, status: 'ARRIVED' }])

    // unverified factor only: still aal1-only access, as before enrolment
    const desk = await db.query(
      user(f.users.receptionistDoctor2),
      `select id from public.appointments`,
    )
    expect(desk.map((r) => r.id)).toEqual([bookingDoctor2.appointment_id])
  })

  it('patients are unaffected', async () => {
    const mine = await db.rpc(user(f.users.patientA, { isAnonymous: true }), 'get_my_appointments')
    expect(mine).toHaveLength(1)
    const rows = await db.query(
      user(f.users.patientB, { isAnonymous: true }),
      `select id from public.appointments`,
    )
    expect(rows.map((r) => r.id)).toEqual([bookingDoctor2.appointment_id])
  })
})
