// Row Level Security, privilege and patient-privacy tests. Every query here goes through the
// same role switching PostgREST performs for browser requests.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  anon,
  book,
  createFixture,
  Db,
  expectMqError,
  expectPermissionDenied,
  queueAction,
  randomPhone,
  service,
  user,
  type BookingResult,
  type Fixture,
} from './helpers'

const db = new Db()
let f: Fixture
let bookingA: BookingResult
let bookingB: BookingResult
let bookingDoctor2: BookingResult

beforeAll(async () => {
  f = await createFixture(db)
  bookingA = await book(db, f.users.patientA, {
    shiftId: f.shiftId,
    date: f.today,
    name: 'Alice Secret',
    phone: '9811111111',
  })
  bookingB = await book(db, f.users.patientB, {
    shiftId: f.shiftId,
    date: f.today,
    name: 'Bob Hidden',
    phone: '9822222222',
  })
  bookingDoctor2 = await book(db, f.users.patientB, {
    shiftId: f.shift2Id,
    date: f.today,
    name: 'Carol Other',
    phone: '9833333333',
  })
})
afterAll(() => db.close())

describe('patient data privacy', () => {
  it('anonymous visitors cannot read appointments at all', async () => {
    await expectPermissionDenied(db.query(anon, `select * from public.appointments`))
  })

  it('a patient sees only their own appointments', async () => {
    const rows = await db.query(
      user(f.users.patientA),
      `select id, patient_name from public.appointments`,
    )
    expect(rows.map((r) => r.id)).toEqual([bookingA.appointment_id])
    const mine = await db.rpc(user(f.users.patientA), 'get_my_appointments')
    expect(mine).toHaveLength(1)
    expect(JSON.stringify(mine)).not.toContain('Bob Hidden')
  })

  it('a booking reference alone does not reveal a booking', async () => {
    expect(
      await db.rpc(anon, 'get_booking', { p_booking_reference: bookingB.booking_reference }),
    ).toBeNull()
    expect(
      await db.rpc(anon, 'get_booking', {
        p_booking_reference: bookingB.booking_reference,
        p_access_key: bookingA.access_key,
      }),
    ).toBeNull()
    // the other patient (owner of A) cannot read B either
    expect(
      await db.rpc(user(f.users.patientA), 'get_booking', {
        p_booking_reference: bookingB.booking_reference,
      }),
    ).toBeNull()
  })

  it('tracking view masks name and phone and never includes other patients', async () => {
    const view = await db.rpc(anon, 'get_booking', {
      p_booking_reference: bookingB.booking_reference.toLowerCase(),
      p_access_key: bookingB.access_key,
    })
    expect(view.token_no).toBe(2)
    expect(view.patient_name_masked).toBe('B** H*****')
    expect(view.patient_phone_masked).toBe('XXXXXX2222')
    const json = JSON.stringify(view)
    expect(json).not.toContain('9822222222')
    expect(json).not.toContain('Bob Hidden')
    expect(json).not.toContain('Alice')
    expect(json).not.toContain('9811111111')
  })

  it('the TV display board exposes no patient names or phone numbers', async () => {
    await db.rpc(user(f.users.admin), 'session_control', {
      p_shift_id: f.shiftId,
      p_session_date: f.today,
      p_action: 'OPEN',
    })
    await queueAction(db, f.users.receptionist, bookingA.appointment_id, 'ARRIVE')
    await db.rpc(user(f.users.receptionist), 'queue_call_next', {
      p_queue_state_id: bookingA.queue_state_id,
    })
    const board = await db.rpc(anon, 'get_display_board', { p_hospital_id: f.hospitalId })
    expect(board.sessions.length).toBeGreaterThan(0)
    expect(
      board.sessions.find((s: { current_token_no: number }) => s.current_token_no === 1),
    ).toBeTruthy()
    const json = JSON.stringify(board)
    for (const secret of [
      'Alice',
      'Bob',
      'Carol',
      '9811111111',
      '9822222222',
      '9833333333',
      'patient',
    ]) {
      expect(json).not.toContain(secret)
    }
  })

  it('public queue_states rows carry no patient data', async () => {
    const rows = await db.query(anon, `select * from public.queue_states where hospital_id = $1`, [
      f.hospitalId,
    ])
    expect(rows.length).toBeGreaterThan(0)
    const cols = Object.keys(rows[0])
    expect(cols.some((c) => /patient|phone|name/.test(c))).toBe(false)
  })
})

describe('no direct writes from the browser', () => {
  it('appointments and queue state cannot be written directly by anyone but the functions', async () => {
    await expectPermissionDenied(
      db.query(user(f.users.admin), `update public.appointments set token_no = 99 where id = $1`, [
        bookingA.appointment_id,
      ]),
    )
    await expectPermissionDenied(
      db.query(
        user(f.users.receptionist),
        `update public.queue_states set current_token_no = 42 where hospital_id = $1`,
        [f.hospitalId],
      ),
    )
    await expectPermissionDenied(
      db.query(
        user(f.users.patientA),
        `insert into public.appointments (hospital_id) values ($1)`,
        [f.hospitalId],
      ),
    )
    await expectPermissionDenied(db.query(user(f.users.admin), `delete from public.audit_logs`))
  })

  it('internal and server-only functions are not callable by clients', async () => {
    await expectPermissionDenied(
      db.query(
        user(f.users.patientA),
        `select public.svc_confirm_payment('order_x', 'pay_x', 100, 'WEBHOOK')`,
      ),
    )
    await expectPermissionDenied(db.query(anon, `select public.svc_housekeeping()`))
    await expectPermissionDenied(
      db.query(user(f.users.admin), `select app.refresh_queue_state($1)`, [
        bookingA.queue_state_id,
      ]),
    )
    await expectPermissionDenied(db.query(user(f.users.admin), `select * from app.rate_limits`))
  })

  it('service functions re-check the service_role claim themselves (defence in depth)', async () => {
    // a privileged DB login without the claim (e.g. a mis-granted role) is still refused
    await expectMqError(db.sql(`select public.svc_housekeeping()`), 'MQ_FORBIDDEN')
    const r = await db.rpc(service, 'svc_housekeeping')
    expect(r).toHaveProperty('expired_holds')
  })
})

describe('role permissions', () => {
  it('receptionist cannot change administrator settings', async () => {
    const updated = await db.query(
      user(f.users.receptionist),
      `update public.hospitals set online_payments_enabled = true where id = $1 returning id`,
      [f.hospitalId],
    )
    expect(updated).toEqual([]) // RLS filters the row: nothing changes
    const updatedDoctor = await db.query(
      user(f.users.receptionist),
      `update public.doctors set consultation_fee_paise = 1 where id = $1 returning id`,
      [f.doctorId],
    )
    expect(updatedDoctor).toEqual([])
    await expect(
      db.query(
        user(f.users.receptionist),
        `insert into public.user_roles (user_id, hospital_id, role) values ($1, $2, 'admin')`,
        [f.users.receptionist, f.hospitalId],
      ),
    ).rejects.toThrow(/row-level security/)
    await expect(
      db.query(
        user(f.users.receptionist),
        `insert into public.departments (hospital_id, name) values ($1, 'Hacked')`,
        [f.hospitalId],
      ),
    ).rejects.toThrow(/row-level security/)
    await expectMqError(
      db.rpc(user(f.users.receptionist), 'admin_dashboard', { p_hospital_id: f.hospitalId }),
      'MQ_FORBIDDEN',
    )
    expect(await db.query(user(f.users.receptionist), `select * from public.audit_logs`)).toEqual(
      [],
    )
    expect(await db.query(user(f.users.receptionist), `select * from public.payments`)).toEqual([])
  })

  it('receptionist can run the desk but not doctor-only steps', async () => {
    const fx = await createFixture(db)
    const a = await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today })
    await db.rpc(user(fx.users.admin), 'session_control', {
      p_shift_id: fx.shiftId,
      p_session_date: fx.today,
      p_action: 'OPEN',
    })
    await queueAction(db, fx.users.receptionist, a.appointment_id, 'ARRIVE')
    await db.rpc(user(fx.users.receptionist), 'queue_call_next', {
      p_queue_state_id: a.queue_state_id,
    })
    await expectMqError(
      queueAction(db, fx.users.receptionist, a.appointment_id, 'START'),
      'MQ_FORBIDDEN',
    )
    await expectMqError(
      db.rpc(user(fx.users.receptionist), 'session_control', {
        p_shift_id: fx.shiftId,
        p_session_date: fx.today,
        p_action: 'CLOSE',
      }),
      'MQ_FORBIDDEN',
    )
  })

  it('a receptionist assigned to one doctor cannot touch another doctor’s queue', async () => {
    const rows = await db.query(
      user(f.users.receptionistDoctor2),
      `select id from public.appointments`,
    )
    expect(rows.map((r) => r.id)).toEqual([bookingDoctor2.appointment_id])
    await expectMqError(
      queueAction(db, f.users.receptionistDoctor2, bookingB.appointment_id, 'ARRIVE'),
      'MQ_FORBIDDEN',
    )
    await expectMqError(
      db.rpc(user(f.users.receptionistDoctor2), 'create_walkin_token', {
        p_shift_id: f.shiftId,
        p_patient_name: 'Wrong Desk',
        p_patient_phone: randomPhone(),
      }),
      'MQ_FORBIDDEN',
    )
  })

  it('doctors see and act on their own queue only, and cannot do desk-only actions', async () => {
    const rows = await db.query(user(f.users.doctor2), `select id from public.appointments`)
    expect(rows.map((r) => r.id)).toEqual([bookingDoctor2.appointment_id])
    await expectMqError(
      queueAction(db, f.users.doctor2, bookingB.appointment_id, 'SKIP'),
      'MQ_FORBIDDEN',
    )
    await expectMqError(
      queueAction(db, f.users.doctor2, bookingDoctor2.appointment_id, 'ARRIVE'),
      'MQ_FORBIDDEN',
    )
    await expectMqError(
      queueAction(db, f.users.doctor2, bookingDoctor2.appointment_id, 'CANCEL', 'not allowed'),
      'MQ_FORBIDDEN',
    )
    await expectMqError(
      db.rpc(user(f.users.doctor2), 'create_walkin_token', {
        p_shift_id: f.shift2Id,
        p_patient_name: 'Doctor Walkin',
        p_patient_phone: randomPhone(),
      }),
      'MQ_FORBIDDEN',
    )
    expect(
      await db.query(
        user(f.users.doctor2),
        `update public.doctors set full_name = 'x' where id = $1 returning id`,
        [f.doctor2Id],
      ),
    ).toEqual([])
  })

  it('patients have no staff powers', async () => {
    await expectMqError(
      queueAction(db, f.users.patientA, bookingA.appointment_id, 'COMPLETE'),
      'MQ_FORBIDDEN',
    )
    await expectMqError(
      db.rpc(user(f.users.patientA), 'queue_call_next', {
        p_queue_state_id: bookingA.queue_state_id,
      }),
      'MQ_FORBIDDEN',
    )
    await expectMqError(
      db.rpc(user(f.users.patientA), 'session_control', {
        p_shift_id: f.shiftId,
        p_session_date: f.today,
        p_action: 'OPEN',
      }),
      'MQ_FORBIDDEN',
    )
  })

  it('administrators manage configuration; changes are audited with the actor', async () => {
    const fx = await createFixture(db)
    await db.query(user(fx.users.admin), `update public.doctors set room_no = '9B' where id = $1`, [
      fx.doctorId,
    ])
    await db.query(
      user(fx.users.admin),
      `insert into public.departments (hospital_id, name) values ($1, 'Cardiology')`,
      [fx.hospitalId],
    )
    const logs = await db.query(
      user(fx.users.admin),
      `select action, actor_user_id, actor_role, details from public.audit_logs where hospital_id = $1 and actor_user_id = $2 and entity_type in ('doctors', 'departments') order by id`,
      [fx.hospitalId, fx.users.admin],
    )
    expect(logs.map((l) => l.action)).toEqual(['doctors.update', 'departments.insert'])
    expect(logs[0].actor_user_id).toBe(fx.users.admin)
    expect(logs[0].actor_role).toBe('admin')
    expect(logs[0].details).toEqual({ changed: { room_no: '9B' } })
    // an admin of another hospital sees none of it
    expect(
      await db.query(
        user(f.users.admin),
        `select * from public.audit_logs where hospital_id = $1`,
        [fx.hospitalId],
      ),
    ).toEqual([])
  })

  it('the last administrator cannot be removed', async () => {
    const fx = await createFixture(db)
    await expect(
      db.query(
        user(fx.users.admin),
        `delete from public.user_roles where user_id = $1 and role = 'admin'`,
        [fx.users.admin],
      ),
    ).rejects.toThrow('MQ_LAST_ADMIN')
  })

  it('announcement author and publish time are set by the server', async () => {
    const fx = await createFixture(db)
    const [row] = await db.query(
      user(fx.users.admin),
      `insert into public.hospital_announcements (hospital_id, title, body, is_published, author_id, published_at)
       values ($1, 'Holiday notice', 'OPD closed on Friday', true, $2, '2000-01-01') returning author_id, published_at`,
      [fx.hospitalId, fx.users.receptionist],
    )
    expect(row.author_id).toBe(fx.users.admin)
    expect(new Date(row.published_at).getFullYear()).toBeGreaterThan(2000)
    const visible = await db.query(
      anon,
      `select title from public.hospital_announcements where hospital_id = $1`,
      [fx.hospitalId],
    )
    expect(visible).toEqual([{ title: 'Holiday notice' }])
  })
})

describe('retention', () => {
  it('audit rows are deletable only through the retention job, and only when old', async () => {
    await expectMqError(
      db.sql(`delete from public.audit_logs where id = (select min(id) from public.audit_logs)`),
      'MQ_AUDIT_IMMUTABLE',
    )
    await expectMqError(
      db.sql(`select app.purge_audit_logs(current_date - 10)`),
      'MQ_INVALID_RANGE',
    )
    const fx = await createFixture(db)
    await expectMqError(
      db.sql(`update public.audit_logs set action = 'x' where hospital_id = $1`, [fx.hospitalId]),
      'MQ_AUDIT_IMMUTABLE',
    )
    const [{ n }] = await db.sql<{ n: number }>(
      `select app.purge_audit_logs(current_date - 365) as n`,
    )
    expect(n).toBe(0)
    // other test files write audit rows concurrently, so look for this purge's own entry
    const purges = await db.sql<{ details: { rows: number } }>(
      `select details from public.audit_logs
       where action = 'audit.purged' and created_at > now() - interval '1 minute'`,
    )
    expect(purges.some((p) => p.details.rows === 0)).toBe(true)
  })
})
