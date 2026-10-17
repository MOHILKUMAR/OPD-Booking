// "A day at the OPD", compressed: 500 visitors browse, book, track and cancel while reception
// checks patients in and doctors work through six queues; then a burst of 60 waiting-room
// viewers polls every second (the Realtime fallback path). Reports latency per operation,
// invariants, and storage growth used to extrapolate against the free-tier database size.
//   npm run load:day
import { randomInt, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import {
  createHospital,
  createUsers,
  openDatabase,
  pool,
  printTable,
  randomIp,
  randomPhone,
  Recorder,
  rpc,
  rpcRows,
} from './lib.mjs'

const VISITORS = Number(process.env.LOAD_VISITORS ?? 500)
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 25)
const db = await openDatabase({ port: 54369, connections: CONCURRENCY + 10 })
const rec = new Recorder()
const checks = []
const check = (name, pass, detail) => {
  checks.push({ check: name, result: pass ? 'PASS' : 'FAIL', detail })
  if (!pass) process.exitCode = 1
}
const anon = (ip) => ({ role: 'anon', ip })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  const h = await createHospital(db, {
    doctors: Number(process.env.LOAD_DOCTORS ?? 6),
    maxTokens: Number(process.env.LOAD_TOKENS ?? 60),
    walkinReserved: 10,
  }) // default: 6 doctors × 50 online tokens = 300 online bookings per day
  const tomorrow = (await db.superuser.query(`select ($1::date + 1)::text as d`, [h.today])).rows[0]
    .d
  const sizeBefore = (await db.superuser.query(`select pg_database_size(current_database()) as b`))
    .rows[0].b
  for (const s of h.sessions) {
    await rpc(db, { role: 'authenticated', userId: h.admin }, 'session_control', {
      p_shift_id: s.shiftId,
      p_session_date: h.today,
      p_action: 'OPEN',
    })
  }
  const patients = await createUsers(db, VISITORS)
  const bookings = []
  const started = performance.now()
  let staffRunning = true

  // Reception and doctors work continuously while patients arrive.
  const staffLoop = (async () => {
    while (staffRunning) {
      const { rows } = await db.superuser.query(
        `select a.id, a.queue_state_id, a.status, q.shift_id from public.appointments a join public.queue_states q on q.id = a.queue_state_id
         where q.hospital_id = $1 and a.session_date = $2 and a.status in ('CONFIRMED') order by random() limit 4`,
        [h.hospitalId, h.today],
      )
      for (const a of rows) {
        await rec.time(
          'staff: mark arrived',
          () =>
            rpc(db, { role: 'authenticated', userId: h.receptionist }, 'queue_update_status', {
              p_appointment_id: a.id,
              p_action: 'ARRIVE',
            }),
          {
            expectedErrors: ['MQ_INVALID_TRANSITION', 'MQ_STALE'],
          },
        )
      }
      await Promise.all(
        h.sessions.map(async (s, i) => {
          const doctor = { role: 'authenticated', userId: h.doctorUsers[i] }
          const { rows: q } = await db.superuser.query(
            `select id from public.queue_states where shift_id = $1 and session_date = $2`,
            [s.shiftId, h.today],
          )
          if (!q[0]) return
          const called = await rec.time(
            'doctor: call next',
            () => rpc(db, doctor, 'queue_call_next', { p_queue_state_id: q[0].id }),
            {
              expectedErrors: ['MQ_QUEUE_EMPTY', 'MQ_ALREADY_CALLED'],
            },
          )
          if (!called) return
          await rec.time('doctor: start', () =>
            rpc(db, doctor, 'queue_update_status', {
              p_appointment_id: called.appointment_id,
              p_action: 'START',
            }),
          )
          await rec.time('doctor: complete', () =>
            rpc(db, doctor, 'queue_update_status', {
              p_appointment_id: called.appointment_id,
              p_action: 'COMPLETE',
            }),
          )
        }),
      )
      await sleep(50)
    }
  })()

  const visitor = (patient) => async () => {
    const ip = randomIp()
    await rec.time('home: search_doctors', () =>
      rpc(db, anon(ip), 'search_doctors', { p_hospital_id: h.hospitalId, p_limit: 50 }),
    )
    await rec.time('directory: search (filtered)', () =>
      rpc(db, anon(ip), 'search_doctors', {
        p_hospital_id: h.hospitalId,
        p_search: 'Load',
        p_available_only: true,
        p_limit: 8,
      }),
    )
    const s = h.sessions[randomInt(0, h.sessions.length)]
    await rec.time('profile: get_sessions', () =>
      rpcRows(db, anon(ip), 'get_sessions', {
        p_hospital_id: h.hospitalId,
        p_doctor_ids: [s.doctorId],
      }),
    )
    if (Math.random() < 0.7) {
      const date = Math.random() < 0.3 ? tomorrow : h.today
      const b = await rec.time(
        'book_token',
        () =>
          rpc(db, { role: 'authenticated', userId: patient, anonymous: true, ip }, 'book_token', {
            p_shift_id: s.shiftId,
            p_session_date: date,
            p_patient_name: 'Day Patient',
            p_patient_phone: randomPhone(),
            p_patient_age: randomInt(1, 90),
            p_client_request_id: randomUUID(),
          }),
        { expectedErrors: ['MQ_SESSION_UNAVAILABLE'] },
      )
      if (b) {
        bookings.push(b)
        for (let i = 0; i < randomInt(2, 6); i++) {
          await rec.time('track: get_booking', () =>
            rpc(db, anon(ip), 'get_booking', {
              p_booking_reference: b.booking_reference,
              p_access_key: b.access_key,
            }),
          )
        }
        if (Math.random() < (date === tomorrow ? 0.25 : 0.03)) {
          await rec.time(
            'cancel_booking',
            () =>
              rpc(db, anon(ip), 'cancel_booking', {
                p_booking_reference: b.booking_reference,
                p_access_key: b.access_key,
                p_reason: 'Plans changed',
              }),
            { expectedErrors: ['MQ_CANNOT_CANCEL'] },
          )
        }
      }
    }
  }

  await pool(patients.map(visitor), CONCURRENCY)
  staffRunning = false
  await staffLoop
  const dayMs = performance.now() - started

  // Burst: 60 TV/tracking screens polling once a second for 20 s (Realtime unavailable).
  const viewers = bookings.slice(0, 50)
  const burstEnd = performance.now() + 20_000
  await Promise.all([
    ...viewers.map(async (b) => {
      while (performance.now() < burstEnd) {
        await rec.time('burst: track poll (50 viewers @1 s)', () =>
          rpc(db, anon(randomIp()), 'get_booking', {
            p_booking_reference: b.booking_reference,
            p_access_key: b.access_key,
          }),
        )
        await sleep(1000)
      }
    }),
    ...Array.from({ length: 10 }, async () => {
      while (performance.now() < burstEnd) {
        await rec.time('burst: TV board poll (10 screens @1 s)', () =>
          rpc(db, anon(randomIp()), 'get_display_board', { p_hospital_id: h.hospitalId }),
        )
        await sleep(1000)
      }
    }),
  ])

  // ---------------------------------------------------------------- invariants
  const { rows: dupTokens } = await db.superuser.query(
    `select count(*)::int as n from (select queue_state_id, token_no from public.appointments where token_no is not null group by 1, 2 having count(*) > 1) d`,
  )
  check(
    'no duplicate token numbers in any queue',
    dupTokens[0].n === 0,
    `${dupTokens[0].n} duplicates`,
  )
  const { rows: drift } = await db.superuser.query(
    `select count(*)::int as n from public.queue_states q
     where q.hospital_id = $1 and q.issued_count <> app.active_token_count(q.id)`,
    [h.hospitalId],
  )
  check(
    'queue counters match appointments (no drift)',
    drift[0].n === 0,
    `${drift[0].n} sessions drifted`,
  )
  const { rows: over } = await db.superuser.query(
    `select count(*)::int as n from public.queue_states q where q.hospital_id = $1 and q.issued_count > q.capacity`,
    [h.hospitalId],
  )
  check('no session over capacity', over[0].n === 0, `${over[0].n} sessions over capacity`)
  const { rows: auditGap } = await db.superuser.query(
    `select count(*)::int as n from public.appointments a where a.hospital_id = $1
       and not exists (select 1 from public.audit_logs l where l.entity_id = a.id::text and l.action = 'appointment.booked')`,
    [h.hospitalId],
  )
  check('every booking has an audit entry', auditGap[0].n === 0, `${auditGap[0].n} missing`)

  await db.superuser.query('vacuum analyze')
  const sizeAfter = (await db.superuser.query(`select pg_database_size(current_database()) as b`))
    .rows[0].b
  const { rows: tableSizes } = await db.superuser.query(
    `select c.relname as table, c.reltuples::bigint as rows, pg_total_relation_size(c.oid) as bytes
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'app') and c.relkind = 'r' and c.relname in
       ('appointments', 'audit_logs', 'notifications', 'queue_states', 'rate_limits', 'payments', 'payment_events')
     order by bytes desc`,
  )
  console.table(
    tableSizes.map((t) => ({
      ...t,
      kb: Math.round(Number(t.bytes) / 1024),
      bytes_per_row: t.rows > 0 ? Math.round(Number(t.bytes) / Number(t.rows)) : null,
    })),
  )
  const retained = tableSizes
    .filter((t) => ['appointments', 'audit_logs', 'queue_states'].includes(t.table))
    .reduce((a, t) => a + Number(t.bytes), 0)
  const { rows: counts } = await db.superuser.query(
    `select (select count(*) from public.appointments where hospital_id = $1)::int as appointments,
            (select count(*) from public.audit_logs where hospital_id = $1)::int as audit_rows,
            (select count(*) from public.notifications where hospital_id = $1)::int as notifications`,
    [h.hospitalId],
  )
  const growthMb = (Number(sizeAfter) - Number(sizeBefore)) / 1024 / 1024
  const summary = rec.summary()
  printTable(summary)
  console.table(checks)
  const totals = {
    visitors: VISITORS,
    concurrency: CONCURRENCY,
    simulated_day_seconds: +(dayMs / 1000).toFixed(1),
    bookings: bookings.length,
    ...counts[0],
    db_growth_mb: +growthMb.toFixed(2),
    // appointments + audit + queue state are kept long-term; notifications and rate-limit rows are purged by housekeeping
    retained_kb_per_booking: +(retained / 1024 / bookings.length).toFixed(2),
    projected_retained_mb_per_year: +((retained / 1024 / 1024) * 365).toFixed(0),
  }
  console.table([totals])
  writeFileSync(
    'load-results-day.json',
    JSON.stringify({ when: new Date().toISOString(), totals, summary, checks }, null, 2),
  )
  console.log('wrote load-results-day.json')
} finally {
  await db.close()
}
