import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  anon,
  book,
  createFixture,
  Db,
  openSession,
  queueAction,
  user,
  type BookingResult,
  type Fixture,
} from './helpers'

const db = new Db()
afterAll(() => db.close())

interface Note {
  id: string
  kind: string
  title: string
  body: string
  data: Record<string, unknown>
}

async function notes(b: BookingResult, kind?: string): Promise<Note[]> {
  const view = await db.rpc(anon, 'get_booking', {
    p_booking_reference: b.booking_reference,
    p_access_key: b.access_key,
  })
  return (view.notifications as Note[]).filter((n) => !kind || n.kind === kind)
}

async function bookMany(f: Fixture, count: number, date = f.today) {
  const out: BookingResult[] = []
  for (let i = 0; i < count; i++) {
    out.push(
      await book(db, i % 2 ? f.users.patientB : f.users.patientA, { shiftId: f.shiftId, date }),
    )
  }
  return out
}

describe('"your turn is near" alerts', () => {
  let f: Fixture
  let b: BookingResult[]
  beforeAll(async () => {
    f = await createFixture(db, { hospital: { turn_alert_ahead: 2 } })
    b = await bookMany(f, 5)
  })

  it('nothing is sent before the session opens', async () => {
    expect(await notes(b[0]!, 'TURN_NEAR')).toEqual([])
  })

  it('opening the session alerts the patients with at most N ahead, once each', async () => {
    await openSession(db, f)
    const first = await notes(b[0]!, 'TURN_NEAR')
    expect(first).toHaveLength(1)
    expect(first[0]!.data).toMatchObject({
      token_no: 1,
      ahead: 0,
      doctor: 'Dr. Test One',
      room: '1',
    })
    expect(first[0]!.body).toMatch(/You are next/)
    expect((await notes(b[2]!, 'TURN_NEAR'))[0]!.data).toMatchObject({ ahead: 2 })
    expect(await notes(b[3]!, 'TURN_NEAR')).toEqual([])
    expect(await notes(b[4]!, 'TURN_NEAR')).toEqual([])
  })

  it('queue progress alerts the next patients; repeated changes do not repeat alerts', async () => {
    const t1 = b[0]!.appointment_id
    await queueAction(db, f.users.receptionist, t1, 'ARRIVE')
    await queueAction(db, f.users.doctor, t1, 'CALL')
    // token 1 is still ahead of token 4 while called
    expect(await notes(b[3]!, 'TURN_NEAR')).toEqual([])
    await queueAction(db, f.users.doctor, t1, 'START')
    await queueAction(db, f.users.doctor, t1, 'COMPLETE')
    const fourth = await notes(b[3]!, 'TURN_NEAR')
    expect(fourth).toHaveLength(1)
    expect(fourth[0]!.data).toMatchObject({ token_no: 4, ahead: 2 })
    expect(await notes(b[1]!, 'TURN_NEAR')).toHaveLength(1)
    expect(await notes(b[4]!, 'TURN_NEAR')).toEqual([])
  })

  it('a hospital can turn the alert off', async () => {
    const off = await createFixture(db, { hospital: { turn_alert_ahead: 0 } })
    const [first] = await bookMany(off, 1)
    await openSession(db, off)
    expect(await notes(first!, 'TURN_NEAR')).toEqual([])
  })
})

describe('delay notices', () => {
  it('raising the delay by 15+ minutes notifies booked patients', async () => {
    const f = await createFixture(db)
    const [first] = await bookMany(f, 1)
    const delay = (minutes: number) =>
      db.rpc(user(f.users.admin), 'session_control', {
        p_shift_id: f.shiftId,
        p_session_date: f.today,
        p_action: 'SET_DELAY',
        p_delay_minutes: minutes,
        p_note: 'Doctor is in an emergency surgery',
      })
    await delay(10)
    expect(await notes(first!, 'DELAY')).toEqual([])
    await delay(20)
    await delay(25) // +5 only
    const after = await notes(first!, 'DELAY')
    expect(after).toHaveLength(1)
    expect(after[0]!.data).toMatchObject({ delay_minutes: 20, doctor: 'Dr. Test One' })
    expect(after[0]!.body).toBe('Doctor is in an emergency surgery')
    await delay(45)
    expect(await notes(first!, 'DELAY')).toHaveLength(2)
  })
})

describe('visit reminders', () => {
  it('reminds earlier bookings once, inside the reminder window', async () => {
    // a one-day lead puts "now" inside the window for tomorrow's all-day session
    const f = await createFixture(db, { hospital: { visit_reminder_minutes: 1440 } })
    const [early, late] = await bookMany(f, 2, f.tomorrow)
    await db.sql(
      `update public.appointments set created_at = now() - interval '2 days' where id = $1`,
      [early!.appointment_id],
    )
    const [{ n }] = await db.sql<{ n: number }>(`select app.queue_visit_reminders() as n`)
    expect(n).toBeGreaterThanOrEqual(1)
    const reminder = await notes(early!, 'VISIT_REMINDER')
    expect(reminder).toHaveLength(1)
    expect(reminder[0]!.data).toMatchObject({
      token_no: 1,
      start_time: '00:00',
      session_date: f.tomorrow,
    })
    expect(reminder[0]!.title).toBe('Reminder: token 1 at 12:00 AM')
    // booked inside the window: the confirmation is recent enough
    expect(await notes(late!, 'VISIT_REMINDER')).toEqual([])
    await db.sql(`select app.queue_visit_reminders()`)
    expect(await notes(early!, 'VISIT_REMINDER')).toHaveLength(1)
  })
})

describe('SMS/WhatsApp copies', () => {
  it('queues nothing by default', async () => {
    const f = await createFixture(db)
    const [first] = await bookMany(f, 1)
    await openSession(db, f)
    const rows = await db.sql(
      `select channel from public.notifications where appointment_id = $1 and kind = 'TURN_NEAR'`,
      [first!.appointment_id],
    )
    expect(rows).toEqual([{ channel: 'IN_APP' }])
  })
})
