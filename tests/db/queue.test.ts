import { afterAll, describe, expect, it } from 'vitest'
import {
  anon,
  book,
  createFixture,
  Db,
  expectMqError,
  openSession,
  queueAction,
  randomPhone,
  user,
  type Fixture,
} from './helpers'

const db = new Db()
afterAll(() => db.close())

const STATUSES = [
  'BOOKED',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'ARRIVED',
  'WAITING',
  'CALLED',
  'IN_CONSULTATION',
  'COMPLETED',
  'SKIPPED',
  'CANCELLED',
  'NO_SHOW',
] as const

async function bookToday(f: Fixture, n: number) {
  const out = []
  for (let i = 0; i < n; i++)
    out.push(await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today }))
  return out
}

async function queueState(id: string) {
  const [q] = await db.sql<{
    status: string
    current_token_no: number | null
    next_token_no: number | null
    waiting_count: number
    completed_count: number
    issued_count: number
    version: string
  }>(`select * from public.queue_states where id = $1`, [id])
  return q!
}

describe('status transition rules', () => {
  it('matches the documented transition table exactly', async () => {
    const rows = await db.sql<{ from_s: string; to_s: string }>(
      `select f::text as from_s, t::text as to_s
       from unnest(enum_range(null::public.appointment_status)) f,
            unnest(enum_range(null::public.appointment_status)) t
       where public.is_transition_allowed(f, t)
       order by 1, 2`,
    )
    const allowed = rows.map((r) => `${r.from_s}->${r.to_s}`)
    expect(allowed).toEqual(
      [
        'ARRIVED->CALLED',
        'ARRIVED->CANCELLED',
        'ARRIVED->SKIPPED',
        'ARRIVED->WAITING',
        'BOOKED->CANCELLED',
        'BOOKED->CONFIRMED',
        'CALLED->IN_CONSULTATION',
        'CALLED->SKIPPED',
        'CONFIRMED->ARRIVED',
        'CONFIRMED->CANCELLED',
        'CONFIRMED->NO_SHOW',
        'IN_CONSULTATION->COMPLETED',
        'PAYMENT_PENDING->CANCELLED',
        'PAYMENT_PENDING->CONFIRMED',
        'SKIPPED->CANCELLED',
        'SKIPPED->NO_SHOW',
        'SKIPPED->WAITING',
        'WAITING->CALLED',
        'WAITING->CANCELLED',
        'WAITING->SKIPPED',
      ].sort(),
    )
    // terminal states
    for (const s of ['COMPLETED', 'CANCELLED', 'NO_SHOW']) {
      expect(allowed.filter((a) => a.startsWith(`${s}->`))).toEqual([])
    }
    expect(STATUSES).toHaveLength(11)
  })
})

describe('happy path: CONFIRMED -> ARRIVED -> CALLED -> IN_CONSULTATION -> COMPLETED', () => {
  it('moves a patient through the queue and keeps queue_state consistent', async () => {
    const f = await createFixture(db)
    const [a1, a2] = await bookToday(f, 2)
    await openSession(db, f)

    await queueAction(db, f.users.receptionist, a2!.appointment_id, 'ARRIVE')
    await queueAction(db, f.users.receptionist, a1!.appointment_id, 'ARRIVE')
    let q = await queueState(a1!.queue_state_id)
    expect(q.waiting_count).toBe(2)
    expect(q.next_token_no).toBe(1)

    // call next picks the lowest checked-in token
    const called = await db.rpc(user(f.users.doctor), 'queue_call_next', {
      p_queue_state_id: a1!.queue_state_id,
    })
    expect(called.token_no).toBe(1)
    q = await queueState(a1!.queue_state_id)
    expect(q.current_token_no).toBe(1)
    expect(q.next_token_no).toBe(2)

    await queueAction(db, f.users.doctor, a1!.appointment_id, 'START')
    await queueAction(db, f.users.doctor, a1!.appointment_id, 'COMPLETE')
    q = await queueState(a1!.queue_state_id)
    expect(q.completed_count).toBe(1)
    expect(q.current_token_no).toBe(1) // stays on the last called token until the next call

    const [row] = await db.sql<{
      status: string
      arrived_at: Date
      called_at: Date
      completed_at: Date
    }>(
      `select status, arrived_at, called_at, completed_at from public.appointments where id = $1`,
      [a1!.appointment_id],
    )
    expect(row!.status).toBe('COMPLETED')
    expect(row!.arrived_at && row!.called_at && row!.completed_at).toBeTruthy()

    // every step was audited
    const actions = await db.sql<{ action: string }>(
      `select action from public.audit_logs where entity_id = $1 order by id`,
      [a1!.appointment_id],
    )
    expect(actions.map((a) => a.action)).toEqual([
      'appointment.booked',
      'queue.arrive',
      'queue.call_next',
      'queue.start',
      'queue.complete',
    ])
  })

  it('patients ahead and the public queue view update after each change', async () => {
    const f = await createFixture(db)
    const [a1, a2, a3] = await bookToday(f, 3)
    let view = await db.rpc(anon, 'get_booking', {
      p_booking_reference: a3!.booking_reference,
      p_access_key: a3!.access_key,
    })
    expect(view.patients_ahead).toBe(2)
    await openSession(db, f)
    await queueAction(db, f.users.receptionist, a1!.appointment_id, 'ARRIVE')
    await db.rpc(user(f.users.receptionist), 'queue_call_next', {
      p_queue_state_id: a1!.queue_state_id,
    })
    await queueAction(db, f.users.doctor, a1!.appointment_id, 'START')
    await queueAction(db, f.users.doctor, a1!.appointment_id, 'COMPLETE')
    view = await db.rpc(anon, 'get_booking', {
      p_booking_reference: a3!.booking_reference,
      p_access_key: a3!.access_key,
    })
    expect(view.patients_ahead).toBe(1)
    expect(view.queue.current_token_no).toBe(1)
    expect(a2).toBeDefined()
  })
})

describe('invalid transitions and guards', () => {
  it('rejects transitions outside the table', async () => {
    const f = await createFixture(db)
    const [a] = await bookToday(f, 1)
    await openSession(db, f)
    // cannot complete or call a patient who has not arrived
    await expectMqError(
      queueAction(db, f.users.doctor, a!.appointment_id, 'COMPLETE'),
      'MQ_INVALID_TRANSITION',
    )
    await expectMqError(
      queueAction(db, f.users.doctor, a!.appointment_id, 'CALL'),
      'MQ_INVALID_TRANSITION',
    )
    await expectMqError(
      queueAction(db, f.users.doctor, a!.appointment_id, 'TELEPORT'),
      'MQ_INVALID_ACTION',
    )
  })

  it('a cancelled appointment can never re-enter the queue', async () => {
    const f = await createFixture(db)
    const [a] = await bookToday(f, 1)
    await openSession(db, f)
    await expectMqError(
      queueAction(db, f.users.receptionist, a!.appointment_id, 'CANCEL'),
      'MQ_REASON_REQUIRED',
    )
    await queueAction(
      db,
      f.users.receptionist,
      a!.appointment_id,
      'CANCEL',
      'Patient requested at desk',
    )
    for (const action of ['ARRIVE', 'RECALL', 'CALL', 'START']) {
      await expectMqError(
        queueAction(db, f.users.admin, a!.appointment_id, action),
        'MQ_INVALID_TRANSITION',
      )
    }
  })

  it('skip and recall: a skipped patient returns to the waiting list', async () => {
    const f = await createFixture(db)
    const [a1, a2] = await bookToday(f, 2)
    await openSession(db, f)
    await queueAction(db, f.users.receptionist, a1!.appointment_id, 'ARRIVE')
    await queueAction(db, f.users.receptionist, a2!.appointment_id, 'ARRIVE')
    await db.rpc(user(f.users.doctor), 'queue_call_next', { p_queue_state_id: a1!.queue_state_id })
    await queueAction(db, f.users.doctor, a1!.appointment_id, 'SKIP')
    const next = await db.rpc(user(f.users.doctor), 'queue_call_next', {
      p_queue_state_id: a1!.queue_state_id,
    })
    expect(next.token_no).toBe(2)
    await queueAction(db, f.users.receptionist, a1!.appointment_id, 'RECALL')
    const [row] = await db.sql<{ status: string; skip_count: number }>(
      `select status, skip_count from public.appointments where id = $1`,
      [a1!.appointment_id],
    )
    expect(row).toEqual({ status: 'WAITING', skip_count: 1 })
  })

  it('only one patient can be CALLED at a time and queue actions need an open session', async () => {
    const f = await createFixture(db)
    const [a1, a2] = await bookToday(f, 2)
    await queueAction(db, f.users.receptionist, a1!.appointment_id, 'ARRIVE') // allowed before the session opens
    await queueAction(db, f.users.receptionist, a2!.appointment_id, 'ARRIVE')
    await expectMqError(
      db.rpc(user(f.users.doctor), 'queue_call_next', { p_queue_state_id: a1!.queue_state_id }),
      'MQ_SESSION_NOT_OPEN',
    )
    await openSession(db, f)
    await db.rpc(user(f.users.doctor), 'queue_call_next', { p_queue_state_id: a1!.queue_state_id })
    await expectMqError(
      db.rpc(user(f.users.doctor), 'queue_call_next', { p_queue_state_id: a1!.queue_state_id }),
      'MQ_ALREADY_CALLED',
    )
    // a doctor without the self-manage permission cannot pause the session
    await expectMqError(
      db.rpc(user(f.users.doctor), 'session_control', {
        p_shift_id: f.shiftId,
        p_session_date: f.today,
        p_action: 'PAUSE',
      }),
      'MQ_FORBIDDEN',
    )
  })

  it('stale writes are rejected with expected_version', async () => {
    const f = await createFixture(db)
    const [a] = await bookToday(f, 1)
    const [{ version }] = await db.sql<{ version: number }>(
      `select version from public.appointments where id = $1`,
      [a!.appointment_id],
    )
    await queueAction(db, f.users.receptionist, a!.appointment_id, 'ARRIVE')
    await expectMqError(
      db.rpc(user(f.users.receptionist), 'queue_update_status', {
        p_appointment_id: a!.appointment_id,
        p_action: 'SKIP',
        p_expected_version: version,
      }),
      'MQ_STALE',
    )
  })

  it('queue actions are only for today', async () => {
    const f = await createFixture(db)
    const a = await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.tomorrow })
    await expectMqError(
      queueAction(db, f.users.receptionist, a.appointment_id, 'ARRIVE'),
      'MQ_NOT_TODAY',
    )
  })
})

describe('session control', () => {
  it('closing a session resolves every remaining token', async () => {
    const f = await createFixture(db)
    const [done, inConsult, waiting, absent, skipped] = await bookToday(f, 5)
    await openSession(db, f)
    for (const a of [done, inConsult, waiting, skipped])
      await queueAction(db, f.users.receptionist, a!.appointment_id, 'ARRIVE')
    await db.rpc(user(f.users.doctor), 'queue_call_next', {
      p_queue_state_id: done!.queue_state_id,
    })
    await queueAction(db, f.users.doctor, done!.appointment_id, 'START')
    await queueAction(db, f.users.doctor, done!.appointment_id, 'COMPLETE')
    await db.rpc(user(f.users.doctor), 'queue_call_next', {
      p_queue_state_id: done!.queue_state_id,
    })
    await queueAction(db, f.users.doctor, inConsult!.appointment_id, 'START')
    await queueAction(db, f.users.receptionist, skipped!.appointment_id, 'SKIP')

    await expectMqError(
      db.rpc(user(f.users.admin), 'session_control', {
        p_shift_id: f.shiftId,
        p_session_date: f.today,
        p_action: 'CLOSE',
      }),
      'MQ_PATIENTS_WAITING',
    )
    const q = await db.rpc(user(f.users.admin), 'session_control', {
      p_shift_id: f.shiftId,
      p_session_date: f.today,
      p_action: 'CLOSE',
      p_force: true,
    })
    expect(q.status).toBe('CLOSED')
    expect(q.booking_open).toBe(false)
    const rows = await db.sql<{ id: string; status: string }>(
      `select id, status from public.appointments where queue_state_id = $1`,
      [done!.queue_state_id],
    )
    const statusOf = (id: string) => rows.find((r) => r.id === id)!.status
    expect(statusOf(done!.appointment_id)).toBe('COMPLETED')
    expect(statusOf(inConsult!.appointment_id)).toBe('COMPLETED')
    expect(statusOf(waiting!.appointment_id)).toBe('CANCELLED')
    expect(statusOf(absent!.appointment_id)).toBe('NO_SHOW')
    expect(statusOf(skipped!.appointment_id)).toBe('NO_SHOW')
  })

  it('cancelling a session cancels active tokens and notifies patients', async () => {
    const f = await createFixture(db)
    const a = await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.tomorrow })
    await expectMqError(
      db.rpc(user(f.users.admin), 'session_control', {
        p_shift_id: f.shiftId,
        p_session_date: f.tomorrow,
        p_action: 'CANCEL',
      }),
      'MQ_REASON_REQUIRED',
    )
    await db.rpc(user(f.users.admin), 'session_control', {
      p_shift_id: f.shiftId,
      p_session_date: f.tomorrow,
      p_action: 'CANCEL',
      p_note: 'Doctor attending an emergency',
    })
    const view = await db.rpc(anon, 'get_booking', {
      p_booking_reference: a.booking_reference,
      p_access_key: a.access_key,
    })
    expect(view.status).toBe('CANCELLED')
    expect(view.cancel_reason).toContain('Doctor attending an emergency')
    expect(view.notifications[0].kind).toBe('CANCELLED')
    await expectMqError(
      db.rpc(user(f.users.admin), 'session_control', {
        p_shift_id: f.shiftId,
        p_session_date: f.tomorrow,
        p_action: 'BOOKING_OPEN',
      }),
      'MQ_SESSION_ENDED',
    )
  })

  it('a self-managing doctor can start and pause; delay notes are public', async () => {
    const f = await createFixture(db)
    await db.sql(`update public.doctors set can_self_manage_session = true where id = $1`, [
      f.doctorId,
    ])
    await openSession(db, f, f.shiftId, f.users.doctor)
    await db.rpc(user(f.users.doctor), 'session_control', {
      p_shift_id: f.shiftId,
      p_session_date: f.today,
      p_action: 'SET_DELAY',
      p_delay_minutes: 20,
      p_note: 'Doctor delayed in surgery',
    })
    const sessions = await db.rpcRows(anon, 'get_sessions', {
      p_hospital_id: f.hospitalId,
      p_doctor_ids: [f.doctorId],
    })
    expect(sessions[0].session_status).toBe('OPEN')
    expect(sessions[0].delay_minutes).toBe(20)
    expect(sessions[0].public_note).toBe('Doctor delayed in surgery')
    // ...but cannot cancel the session (admin-only)
    await expectMqError(
      db.rpc(user(f.users.doctor), 'session_control', {
        p_shift_id: f.shiftId,
        p_session_date: f.today,
        p_action: 'CANCEL',
        p_note: 'x',
      }),
      'MQ_FORBIDDEN',
    )
  })
})

describe('walk-in tokens', () => {
  it('share the numbering sequence and start as ARRIVED', async () => {
    const f = await createFixture(db)
    await bookToday(f, 1)
    const w = await db.rpc(user(f.users.receptionist), 'create_walkin_token', {
      p_shift_id: f.shiftId,
      p_patient_name: 'Walk In Patient',
      p_patient_phone: randomPhone(),
      p_patient_age: 40,
    })
    expect(w.token_no).toBe(2)
    expect(w.status).toBe('ARRIVED')
    expect(w.source).toBe('WALK_IN')
    const [q] = await db.sql<{ waiting_count: number; next_token_no: number }>(
      `select waiting_count, next_token_no from public.queue_states where id = $1`,
      [w.queue_state_id],
    )
    expect(q).toEqual({ waiting_count: 1, next_token_no: 2 })
  })
})
