// Real concurrency against PostgreSQL: many simultaneous transactions on separate connections.
import { afterAll, describe, expect, it } from 'vitest'
import {
  book,
  createAuthUser,
  createFixture,
  Db,
  openSession,
  queueAction,
  randomPhone,
  user,
} from './helpers'

const db = new Db(60)
afterAll(() => db.close())

describe('atomic token allocation under concurrent load', () => {
  it('60 simultaneous bookings for 25 tokens: exactly 25 succeed with unique, gapless numbers', async () => {
    const f = await createFixture(db, { maxTokens: 25 })
    const patients = await Promise.all(
      Array.from({ length: 60 }, () => createAuthUser(db, { anonymous: true })),
    )

    const results = await Promise.allSettled(
      patients.map((p) => book(db, p, { shiftId: f.shiftId, date: f.today })),
    )
    const ok = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<{ token_no: number }>).value)
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]

    expect(ok).toHaveLength(25)
    expect(failed).toHaveLength(35)
    for (const r of failed) {
      expect((r.reason as Error).message).toBe('MQ_SESSION_UNAVAILABLE')
      expect((r.reason as { detail: string }).detail).toBe('FULL')
    }
    const tokens = ok.map((r) => r.token_no).sort((a, b) => a - b)
    expect(tokens).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))

    const [q] = await db.sql<{ issued_count: number; last_token_no: number }>(
      `select issued_count, last_token_no from public.queue_states where shift_id = $1 and session_date = $2`,
      [f.shiftId, f.today],
    )
    expect(q).toEqual({ issued_count: 25, last_token_no: 25 })
  })

  it('simultaneous bookings across two doctors never interfere', async () => {
    const f = await createFixture(db, { maxTokens: 50 })
    const patients = await Promise.all(
      Array.from({ length: 40 }, () => createAuthUser(db, { anonymous: true })),
    )
    const results = await Promise.all(
      patients.map((p, i) =>
        book(db, p, { shiftId: i % 2 ? f.shiftId : f.shift2Id, date: f.today }),
      ),
    )
    for (const shiftId of [f.shiftId, f.shift2Id]) {
      const [{ ids }] = await db.sql<{ ids: number[] }>(
        `select array_agg(a.token_no order by a.token_no) as ids from public.appointments a
         join public.queue_states q on q.id = a.queue_state_id where q.shift_id = $1`,
        [shiftId],
      )
      expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    }
    expect(results).toHaveLength(40)
  })

  it('the same phone submitted 20 times at once yields one token', async () => {
    const f = await createFixture(db)
    const phone = randomPhone()
    const patients = await Promise.all(
      Array.from({ length: 20 }, () => createAuthUser(db, { anonymous: true })),
    )
    const results = await Promise.allSettled(
      patients.map((p) => book(db, p, { shiftId: f.shiftId, date: f.today, phone })),
    )
    const ok = results.filter((r) => r.status === 'fulfilled')
    expect(ok).toHaveLength(1)
    for (const r of results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]) {
      expect((r.reason as Error).message).toBe('MQ_DUPLICATE_BOOKING')
    }
  })

  it('a double-submitted form (same request id) creates one booking', async () => {
    const f = await createFixture(db)
    const requestId = crypto.randomUUID()
    const phone = randomPhone()
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today, phone, requestId }),
      ),
    )
    expect(new Set(results.map((r) => r.appointment_id)).size).toBe(1)
    expect(results.filter((r) => !r.replayed)).toHaveLength(1)
  })
})

describe('concurrent staff actions', () => {
  it('two desks pressing "call next" at the same moment call one patient', async () => {
    const f = await createFixture(db)
    const bookings = []
    for (let i = 0; i < 3; i++)
      bookings.push(await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today }))
    await openSession(db, f)
    for (const b of bookings)
      await queueAction(db, f.users.receptionist, b.appointment_id, 'ARRIVE')

    const results = await Promise.allSettled([
      db.rpc(user(f.users.receptionist), 'queue_call_next', {
        p_queue_state_id: bookings[0]!.queue_state_id,
      }),
      db.rpc(user(f.users.doctor), 'queue_call_next', {
        p_queue_state_id: bookings[0]!.queue_state_id,
      }),
      db.rpc(user(f.users.admin), 'queue_call_next', {
        p_queue_state_id: bookings[0]!.queue_state_id,
      }),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled')
    expect(ok).toHaveLength(1)
    const [{ n }] = await db.sql<{ n: number }>(
      `select count(*)::int as n from public.appointments where queue_state_id = $1 and status = 'CALLED'`,
      [bookings[0]!.queue_state_id],
    )
    expect(n).toBe(1)
  })

  it('conflicting updates to the same token apply exactly one', async () => {
    const f = await createFixture(db)
    const b = await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today })
    await openSession(db, f)
    await queueAction(db, f.users.receptionist, b.appointment_id, 'ARRIVE')
    const [{ version }] = await db.sql<{ version: number }>(
      `select version from public.appointments where id = $1`,
      [b.appointment_id],
    )
    const results = await Promise.allSettled(
      ['SKIP', 'CALL', 'CANCEL'].map((action) =>
        db.rpc(user(f.users.admin), 'queue_update_status', {
          p_appointment_id: b.appointment_id,
          p_action: action,
          p_reason: 'test',
          p_expected_version: version,
        }),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]) {
      expect((r.reason as Error).message).toBe('MQ_STALE')
    }
  })

  it('bookings and queue actions interleaving on the same session stay consistent', async () => {
    const f = await createFixture(db, { maxTokens: 100 })
    const first = []
    for (let i = 0; i < 5; i++)
      first.push(await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today }))
    await openSession(db, f)
    const patients = await Promise.all(
      Array.from({ length: 30 }, () => createAuthUser(db, { anonymous: true })),
    )
    await Promise.all([
      ...patients.map((p) => book(db, p, { shiftId: f.shiftId, date: f.today })),
      ...first.map((b) => queueAction(db, f.users.receptionist, b.appointment_id, 'ARRIVE')),
    ])
    const [q] = await db.sql<{
      issued_count: number
      waiting_count: number
      last_token_no: number
      next_token_no: number
    }>(
      `select issued_count, waiting_count, last_token_no, next_token_no from public.queue_states where id = $1`,
      [first[0]!.queue_state_id],
    )
    expect(q).toEqual({ issued_count: 35, waiting_count: 5, last_token_no: 35, next_token_no: 1 })
  })
})
