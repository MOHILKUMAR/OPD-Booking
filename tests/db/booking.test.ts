import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  anon,
  book,
  createFixture,
  Db,
  expectMqError,
  expectPermissionDenied,
  openSession,
  randomPhone,
  user,
  type Fixture,
} from './helpers'

const db = new Db()
let f: Fixture

beforeAll(async () => {
  f = await createFixture(db, { maxTokens: 5, walkinReserved: 1 })
})
afterAll(() => db.close())

describe('valid booking', () => {
  it('confirms a free booking with token 1, a reference and a secret key', async () => {
    const fx = await createFixture(db)
    const res = await book(db, fx.users.patientA, {
      shiftId: fx.shiftId,
      date: fx.today,
      name: '  Asha   Rao ',
    })
    expect(res.status).toBe('CONFIRMED')
    expect(res.token_no).toBe(1)
    expect(res.booking_reference).toMatch(/^MQ-[A-Z2-9]{8}$/)
    expect(res.access_key).toMatch(/^[0-9a-f]{32}$/)
    expect(res.patient_name).toBe('Asha Rao')
    expect(res.payment_mode).toBe('FREE')

    // only the hash is stored
    const [row] = await db.sql<{ access_key_hash: string }>(
      `select access_key_hash from public.appointments where id = $1`,
      [res.appointment_id],
    )
    expect(row!.access_key_hash).not.toContain(res.access_key)
    expect(row!.access_key_hash).toHaveLength(64)

    const second = await book(db, fx.users.patientB, { shiftId: fx.shiftId, date: fx.today })
    expect(second.token_no).toBe(2)
  })

  it('accepts +91 / spaced phone formats and normalizes them', async () => {
    const fx = await createFixture(db)
    const res = await book(db, fx.users.patientA, {
      shiftId: fx.shiftId,
      date: fx.tomorrow,
      phone: '+91 98765-43210',
    })
    const [row] = await db.sql<{ patient_phone: string }>(
      `select patient_phone from public.appointments where id = $1`,
      [res.appointment_id],
    )
    expect(row!.patient_phone).toBe('9876543210')
  })

  it('writes an audit entry and an in-app notification without patient contact details', async () => {
    const fx = await createFixture(db)
    const res = await book(db, fx.users.patientA, {
      shiftId: fx.shiftId,
      date: fx.today,
      phone: '9123456780',
      name: 'Private Person',
    })
    const logs = await db.sql<{ action: string; details: unknown; actor_role: string }>(
      `select action, details, actor_role from public.audit_logs where entity_id = $1`,
      [res.appointment_id],
    )
    expect(logs.map((l) => l.action)).toContain('appointment.booked')
    expect(logs[0]!.actor_role).toBe('patient_guest')
    expect(JSON.stringify(logs)).not.toContain('9123456780')
    expect(JSON.stringify(logs)).not.toContain('Private Person')
    const notes = await db.sql(`select kind from public.notifications where appointment_id = $1`, [
      res.appointment_id,
    ])
    expect(notes).toEqual([{ kind: 'BOOKED' }])
  })
})

describe('input validation (server side)', () => {
  it.each([
    ['MQ_INVALID_PHONE', { phone: '12345' }],
    ['MQ_INVALID_PHONE', { phone: '5123456789' }],
    ['MQ_INVALID_NAME', { name: 'A' }],
    ['MQ_INVALID_NAME', { name: 'Robert<script>' }],
    ['MQ_INVALID_NAME', { name: 'Call 9876543210' }],
    ['MQ_INVALID_AGE', { age: 150 }],
  ])('rejects %s for %o', async (code, override) => {
    await expectMqError(
      book(db, f.users.patientA, { shiftId: f.shiftId, date: f.tomorrow, ...override } as never),
      code,
    )
  })

  it('requires age when the hospital requires it', async () => {
    const fx = await createFixture(db, { hospital: { require_patient_age: true } })
    await expectMqError(
      db.rpc(user(fx.users.patientA), 'book_token', {
        p_shift_id: fx.shiftId,
        p_session_date: fx.today,
        p_patient_name: 'No Age',
        p_patient_phone: randomPhone(),
      }),
      'MQ_AGE_REQUIRED',
    )
  })

  it('rejects an unknown shift', async () => {
    await expectMqError(
      book(db, f.users.patientA, { shiftId: randomUUID(), date: f.today }),
      'MQ_SHIFT_NOT_FOUND',
    )
  })

  it('requires a signed-in session (anonymous sign-in is enough)', async () => {
    await expectPermissionDenied(
      db.rpc(anon, 'book_token', {
        p_shift_id: f.shiftId,
        p_session_date: f.today,
        p_patient_name: 'Anon',
        p_patient_phone: randomPhone(),
      }),
    )
  })
})

describe('duplicate-booking prevention', () => {
  it('allows one active token per phone, doctor, shift and date', async () => {
    const fx = await createFixture(db)
    const phone = randomPhone()
    await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today, phone })
    const err = await expectMqError(
      book(db, fx.users.patientB, {
        shiftId: fx.shiftId,
        date: fx.today,
        phone,
        name: 'Someone Else',
      }),
      'MQ_DUPLICATE_BOOKING',
    )
    expect(err.hint).toMatch(/Track Token/)
    // same phone, other doctor or other date is fine
    await book(db, fx.users.patientA, { shiftId: fx.shift2Id, date: fx.today, phone })
    await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.tomorrow, phone })
  })

  it('allows rebooking after cancellation', async () => {
    const fx = await createFixture(db)
    const phone = randomPhone()
    const first = await book(db, fx.users.patientA, {
      shiftId: fx.shiftId,
      date: fx.tomorrow,
      phone,
    })
    await db.rpc(anon, 'cancel_booking', {
      p_booking_reference: first.booking_reference,
      p_access_key: first.access_key,
    })
    const again = await book(db, fx.users.patientA, {
      shiftId: fx.shiftId,
      date: fx.tomorrow,
      phone,
    })
    expect(again.token_no).toBe(2) // numbers are never reused
  })

  it('PHONE_AND_NAME policy lets one phone book for two different patients', async () => {
    const fx = await createFixture(db, { hospital: { duplicate_policy: 'PHONE_AND_NAME' } })
    const phone = randomPhone()
    await book(db, fx.users.patientA, {
      shiftId: fx.shiftId,
      date: fx.today,
      phone,
      name: 'Child One',
    })
    await book(db, fx.users.patientA, {
      shiftId: fx.shiftId,
      date: fx.today,
      phone,
      name: 'Child Two',
    })
    await expectMqError(
      book(db, fx.users.patientA, {
        shiftId: fx.shiftId,
        date: fx.today,
        phone,
        name: 'child   one',
      }),
      'MQ_DUPLICATE_BOOKING',
    )
  })

  it('limits bookings per phone per day across doctors', async () => {
    const fx = await createFixture(db, { hospital: { max_bookings_per_phone_per_day: 1 } })
    const phone = randomPhone()
    await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today, phone })
    await expectMqError(
      book(db, fx.users.patientA, { shiftId: fx.shift2Id, date: fx.today, phone }),
      'MQ_PHONE_DAILY_LIMIT',
    )
  })
})

describe('idempotent retries', () => {
  it('returns the same booking for the same client request id and rotates the key', async () => {
    const fx = await createFixture(db)
    const requestId = randomUUID()
    const phone = randomPhone()
    const first = await book(db, fx.users.patientA, {
      shiftId: fx.shiftId,
      date: fx.today,
      phone,
      requestId,
    })
    const retry = await book(db, fx.users.patientA, {
      shiftId: fx.shiftId,
      date: fx.today,
      phone,
      requestId,
    })
    expect(retry.replayed).toBe(true)
    expect(retry.appointment_id).toBe(first.appointment_id)
    expect(retry.token_no).toBe(first.token_no)
    expect(retry.access_key).not.toBe(first.access_key)
    const [{ n }] = await db.sql<{ n: number }>(
      `select count(*)::int as n from public.appointments where queue_state_id = $1`,
      [first.queue_state_id],
    )
    expect(n).toBe(1)
  })
})

describe('capacity enforcement', () => {
  it('a full shift accepts no more online bookings; walk-in reserve stays for the desk', async () => {
    const fx = await createFixture(db, { maxTokens: 3, walkinReserved: 1 })
    await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today })
    await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today })
    const err = await expectMqError(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today }),
      'MQ_SESSION_UNAVAILABLE',
    )
    expect(err.detail).toBe('FULL')

    // the reserved token is available to reception
    const walkin = await db.rpc(user(fx.users.receptionist), 'create_walkin_token', {
      p_shift_id: fx.shiftId,
      p_patient_name: 'Walk In',
      p_patient_phone: randomPhone(),
    })
    expect(walkin.token_no).toBe(3)
    expect(walkin.status).toBe('ARRIVED')
    await expectMqError(
      db.rpc(user(fx.users.receptionist), 'create_walkin_token', {
        p_shift_id: fx.shiftId,
        p_patient_name: 'Walk In Two',
        p_patient_phone: randomPhone(),
      }),
      'MQ_SESSION_UNAVAILABLE',
    )
  })

  it('once the OPD starts, unused walk-in tokens open to online booking until the session is full', async () => {
    const fx = await createFixture(db, { maxTokens: 5, walkinReserved: 2 })
    const sessionsToday = async () =>
      (
        await db.rpcRows(anon, 'get_sessions', {
          p_hospital_id: fx.hospitalId,
          p_from: fx.today,
          p_to: fx.today,
          p_doctor_ids: [fx.doctorId],
        })
      )[0] as { online_capacity: number; remaining_online: number; bookable: boolean }
    for (let i = 0; i < 3; i++) {
      await book(db, i % 2 ? fx.users.patientB : fx.users.patientA, {
        shiftId: fx.shiftId,
        date: fx.today,
      })
    }
    expect(await sessionsToday()).toMatchObject({
      online_capacity: 3,
      remaining_online: 0,
      bookable: false,
    })
    const full = await expectMqError(
      book(db, fx.users.patientB, { shiftId: fx.shiftId, date: fx.today }),
      'MQ_SESSION_UNAVAILABLE',
    )
    expect(full.detail).toBe('FULL')

    await openSession(db, fx)
    expect(await sessionsToday()).toMatchObject({
      online_capacity: 5,
      remaining_online: 2,
      bookable: true,
    })
    const [{ online_capacity }] = await db.sql<{ online_capacity: number }>(
      `select online_capacity from public.queue_states where shift_id = $1 and session_date = $2`,
      [fx.shiftId, fx.today],
    )
    expect(online_capacity).toBe(5)
    const fourth = await book(db, fx.users.patientB, { shiftId: fx.shiftId, date: fx.today })
    const fifth = await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today })
    expect([fourth.token_no, fifth.token_no]).toEqual([4, 5])
    expect(
      (
        await expectMqError(
          book(db, fx.users.patientB, { shiftId: fx.shiftId, date: fx.today }),
          'MQ_SESSION_UNAVAILABLE',
        )
      ).detail,
    ).toBe('FULL')
  })

  it('a hospital can keep the walk-in reserve for the desk all day', async () => {
    const fx = await createFixture(db, {
      maxTokens: 3,
      walkinReserved: 1,
      hospital: { release_walkin_reserve_on_start: false },
    })
    await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today })
    await book(db, fx.users.patientB, { shiftId: fx.shiftId, date: fx.today })
    await openSession(db, fx)
    const err = await expectMqError(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today }),
      'MQ_SESSION_UNAVAILABLE',
    )
    expect(err.detail).toBe('FULL')
  })

  it('a cancellation frees a slot', async () => {
    const fx = await createFixture(db, { maxTokens: 1 })
    const first = await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.tomorrow })
    await expectMqError(
      book(db, fx.users.patientB, { shiftId: fx.shiftId, date: fx.tomorrow }),
      'MQ_SESSION_UNAVAILABLE',
    )
    await db.rpc(anon, 'cancel_booking', {
      p_booking_reference: first.booking_reference,
      p_access_key: first.access_key,
    })
    const second = await book(db, fx.users.patientB, { shiftId: fx.shiftId, date: fx.tomorrow })
    expect(second.token_no).toBe(2)
  })

  it('honours a capacity-change exception for the date', async () => {
    const fx = await createFixture(db, { maxTokens: 10 })
    await db.sql(
      `insert into public.shift_exceptions (hospital_id, doctor_id, shift_id, exception_date, kind, max_tokens, reason)
       values ($1, $2, $3, $4, 'CAPACITY_CHANGE', 1, 'Short session')`,
      [fx.hospitalId, fx.doctorId, fx.shiftId, fx.tomorrow],
    )
    await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.tomorrow })
    await expectMqError(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.tomorrow }),
      'MQ_SESSION_UNAVAILABLE',
    )
  })
})

describe('closed / invalid sessions are rejected', () => {
  async function expectReason(promise: Promise<unknown>, reason: string) {
    const err = await expectMqError(promise, 'MQ_SESSION_UNAVAILABLE')
    expect(err.detail).toBe(reason)
    expect(err.hint).toBeTruthy()
  }

  it('past date', async () => {
    await expectReason(
      book(db, f.users.patientA, { shiftId: f.shiftId, date: f.yesterday }),
      'PAST_SESSION',
    )
  })

  it('beyond the booking window (today + tomorrow)', async () => {
    const [{ d }] = await db.sql<{ d: string }>(`select ($1::date + 2)::text as d`, [f.today])
    await expectReason(
      book(db, f.users.patientA, { shiftId: f.shiftId, date: d }),
      'OUTSIDE_BOOKING_WINDOW',
    )
  })

  it('hospital holiday', async () => {
    const fx = await createFixture(db)
    await db.sql(
      `insert into public.shift_exceptions (hospital_id, exception_date, kind, reason) values ($1, $2, 'HOLIDAY', 'Festival holiday')`,
      [fx.hospitalId, fx.tomorrow],
    )
    const err = await expectMqError(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.tomorrow }),
      'MQ_SESSION_UNAVAILABLE',
    )
    expect(err.detail).toBe('HOLIDAY')
    expect(err.hint).toContain('Festival holiday')
  })

  it('doctor on leave (doctor-level closure)', async () => {
    const fx = await createFixture(db)
    await db.sql(
      `insert into public.shift_exceptions (hospital_id, doctor_id, exception_date, kind, reason) values ($1, $2, $3, 'CLOSED', 'Doctor on leave')`,
      [fx.hospitalId, fx.doctorId, fx.tomorrow],
    )
    await expectReason(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.tomorrow }),
      'CLOSED',
    )
    await book(db, fx.users.patientA, { shiftId: fx.shift2Id, date: fx.tomorrow }) // other doctor unaffected
  })

  it('weekday without a schedule', async () => {
    const fx = await createFixture(db)
    await db.sql(
      `update public.doctor_schedules set is_active = false where shift_id = $1 and weekday = extract(dow from $2::date)`,
      [fx.shiftId, fx.tomorrow],
    )
    await expectReason(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.tomorrow }),
      'NOT_SCHEDULED',
    )
  })

  it('inactive doctor or shift, or doctor not accepting bookings', async () => {
    const fx = await createFixture(db)
    await db.sql(`update public.doctors set accepting_bookings = false where id = $1`, [
      fx.doctorId,
    ])
    await expectReason(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today }),
      'DOCTOR_NOT_ACCEPTING',
    )
    await db.sql(`update public.doctors set is_active = false where id = $1`, [fx.doctorId])
    await expectReason(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today }),
      'DOCTOR_INACTIVE',
    )
    await db.sql(`update public.shifts set is_active = false where id = $1`, [fx.shift2Id])
    await expectReason(
      book(db, fx.users.patientA, { shiftId: fx.shift2Id, date: fx.today }),
      'SHIFT_INACTIVE',
    )
  })

  it('session closed or cancelled by staff, or online booking paused', async () => {
    const fx = await createFixture(db)
    await db.rpc(user(fx.users.admin), 'session_control', {
      p_shift_id: fx.shiftId,
      p_session_date: fx.tomorrow,
      p_action: 'BOOKING_CLOSE',
    })
    await expectReason(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.tomorrow }),
      'BOOKING_PAUSED',
    )

    await db.rpc(user(fx.users.admin), 'session_control', {
      p_shift_id: fx.shiftId,
      p_session_date: fx.today,
      p_action: 'OPEN',
    })
    await db.rpc(user(fx.users.admin), 'session_control', {
      p_shift_id: fx.shiftId,
      p_session_date: fx.today,
      p_action: 'CLOSE',
    })
    await expectReason(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today }),
      'SESSION_CLOSED',
    )

    await db.rpc(user(fx.users.admin), 'session_control', {
      p_shift_id: fx.shift2Id,
      p_session_date: fx.tomorrow,
      p_action: 'CANCEL',
      p_note: 'Doctor unavailable',
    })
    await expectReason(
      book(db, fx.users.patientA, { shiftId: fx.shift2Id, date: fx.tomorrow }),
      'SESSION_CANCELLED',
    )
  })

  it('same-day booking closes after the cutoff', async () => {
    const fx = await createFixture(db)
    // a shift that already ended today (00:00 - 00:00:01)
    const [{ id: shiftId }] = await db.sql<{ id: string }>(
      `insert into public.shifts (hospital_id, doctor_id, name, start_time, end_time, max_tokens, booking_cutoff_minutes)
       values ($1, $2, 'Early OPD', '00:00', '00:00:01', 10, 0) returning id`,
      [fx.hospitalId, fx.doctor2Id],
    )
    await db.sql(`update public.doctor_schedules set is_active = false where shift_id = $1`, [
      fx.shift2Id,
    ])
    await db.sql(
      `insert into public.doctor_schedules (hospital_id, doctor_id, shift_id, weekday, effective_from)
       select $1, $2, $3, wd, current_date - 1 from generate_series(0, 6) wd`,
      [fx.hospitalId, fx.doctor2Id, shiftId],
    )
    await expectReason(
      book(db, fx.users.patientA, { shiftId, date: fx.today }),
      'BOOKING_CLOSED_FOR_TODAY',
    )
  })
})

describe('payments', () => {
  it('free path is refused when online payment is required', async () => {
    const fx = await createFixture(db, {
      hospital: { default_booking_fee_paise: 5000, online_payments_enabled: true },
    })
    await expectMqError(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today }),
      'MQ_PAYMENT_REQUIRED',
    )
  })

  it('fee with payments disabled becomes pay-at-hospital; price comes from the server', async () => {
    const fx = await createFixture(db, { hospital: { default_booking_fee_paise: 5000 } })
    const res = await book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today })
    expect(res.payment_mode).toBe('PAY_AT_HOSPITAL')
    expect(res.fee_paise).toBe(5000)
    expect(res.status).toBe('CONFIRMED')
  })
})

describe('rate limiting', () => {
  it('limits successful bookings per account per hour', async () => {
    const fx = await createFixture(db, { maxTokens: 50 })
    for (let i = 0; i < 10; i++) {
      await book(db, fx.users.patientA, {
        shiftId: i % 2 ? fx.shiftId : fx.shift2Id,
        date: i < 5 ? fx.today : fx.tomorrow,
      })
    }
    await expectMqError(
      book(db, fx.users.patientA, { shiftId: fx.shiftId, date: fx.today }),
      'MQ_RATE_LIMITED',
    )
  })
})

describe('configurable limits', () => {
  it('per-IP booking limit comes from app.config and only counts successful bookings', async () => {
    const fx = await createFixture(db, { maxTokens: 100 })
    const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
    await db.sql(`update app.config set value = 3 where key = 'rate.book_per_ip_hour'`)
    try {
      const patients = [fx.users.patientA, fx.users.patientB, fx.users.admin, fx.users.doctor]
      for (let i = 0; i < 3; i++)
        await book(db, patients[i]!, { shiftId: fx.shiftId, date: fx.today }, { ip })
      await expectMqError(
        book(db, patients[3]!, { shiftId: fx.shiftId, date: fx.today }, { ip }),
        'MQ_RATE_LIMITED',
      )
      // a different IP is unaffected
      await book(db, patients[3]!, { shiftId: fx.shiftId, date: fx.today }, { ip: '10.250.0.1' })
    } finally {
      await db.sql(`update app.config set value = 60 where key = 'rate.book_per_ip_hour'`)
    }
  })
})
