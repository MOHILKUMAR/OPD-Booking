// Concurrency stress test: simultaneous bookings, duplicate submissions, competing staff
// actions, payment retries and duplicate webhooks. Verifies invariants and reports latency.
//   npm run load:booking            (uses an embedded PostgreSQL 17; no Docker)
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import {
  createHospital,
  createUsers,
  openDatabase,
  pool,
  printTable,
  randomPhone,
  Recorder,
  rpc,
} from './lib.mjs'

const CONNECTIONS = Number(process.env.LOAD_CONNECTIONS ?? 40)
const db = await openDatabase({ connections: CONNECTIONS })
const rec = new Recorder()
const checks = []
const check = (name, pass, detail) => {
  checks.push({ check: name, result: pass ? 'PASS' : 'FAIL', detail })
  if (!pass) process.exitCode = 1
}

try {
  // ---------------------------------------------------------------- 1. booking burst
  const h = await createHospital(db, { doctors: 2, maxTokens: 220, walkinReserved: 20 }) // 200 online tokens
  const target = h.sessions[0]
  const attempts = 300
  const patients = await createUsers(db, attempts)
  const t0 = performance.now()
  await Promise.all(
    patients.map((p) =>
      rec.time(
        'book_token (300 simultaneous, 200 seats)',
        () =>
          rpc(db, { role: 'authenticated', userId: p, anonymous: true }, 'book_token', {
            p_shift_id: target.shiftId,
            p_session_date: h.today,
            p_patient_name: 'Load Patient',
            p_patient_phone: randomPhone(),
            p_patient_age: 30,
            p_client_request_id: randomUUID(),
          }),
        { expectedErrors: ['MQ_SESSION_UNAVAILABLE'] },
      ),
    ),
  )
  const burstSeconds = (performance.now() - t0) / 1000
  const { rows: tokens } = await db.superuser.query(
    `select token_no from public.appointments a join public.queue_states q on q.id = a.queue_state_id
     where q.shift_id = $1 and a.status <> 'CANCELLED' order by token_no`,
    [target.shiftId],
  )
  const nums = tokens.map((t) => t.token_no)
  check(
    'exactly 200 tokens issued for 200 online seats',
    nums.length === 200,
    `${nums.length} issued`,
  )
  check(
    'token numbers unique and gapless 1..200',
    nums.every((n, i) => n === i + 1),
    `max ${nums.at(-1)}`,
  )
  check(
    '300 simultaneous attempts finished',
    true,
    `${burstSeconds.toFixed(2)} s wall clock, ${CONNECTIONS} DB connections`,
  )

  // ---------------------------------------------------------------- 2. duplicate storm
  const phone = randomPhone()
  const dupUsers = await createUsers(db, 40)
  await Promise.all(
    dupUsers.map((u) =>
      rec.time(
        'book_token (40× same phone)',
        () =>
          rpc(db, { role: 'authenticated', userId: u, anonymous: true }, 'book_token', {
            p_shift_id: h.sessions[1].shiftId,
            p_session_date: h.today,
            p_patient_name: 'Same Phone',
            p_patient_phone: phone,
            p_patient_age: 30,
            p_client_request_id: randomUUID(),
          }),
        { expectedErrors: ['MQ_DUPLICATE_BOOKING'] },
      ),
    ),
  )
  const { rows: dup } = await db.superuser.query(
    `select count(*)::int as n from public.appointments where patient_phone = $1`,
    [phone],
  )
  check('40 simultaneous bookings with one phone → 1 token', dup[0].n === 1, `${dup[0].n} rows`)

  // ---------------------------------------------------------------- 3. competing staff actions
  const { rows: qs } = await db.superuser.query(
    `select id from public.queue_states where shift_id = $1 and session_date = $2`,
    [target.shiftId, h.today],
  )
  const queueId = qs[0].id
  await rpc(db, { role: 'authenticated', userId: h.admin }, 'session_control', {
    p_shift_id: target.shiftId,
    p_session_date: h.today,
    p_action: 'OPEN',
  })
  const { rows: toArrive } = await db.superuser.query(
    `select id from public.appointments where queue_state_id = $1 and token_no <= 60 order by token_no`,
    [queueId],
  )
  await pool(
    toArrive.map(
      (a) => () =>
        rec.time('queue ARRIVE (60, concurrent desk)', () =>
          rpc(db, { role: 'authenticated', userId: h.receptionist }, 'queue_update_status', {
            p_appointment_id: a.id,
            p_action: 'ARRIVE',
          }),
        ),
    ),
    10,
  )
  // 30 rounds: three desks press "call next" at once, then the doctor starts + completes
  let doubleCalls = 0
  for (let round = 0; round < 30; round++) {
    const callers = [h.receptionist, h.admin, h.doctorUsers[0]]
    const results = await Promise.all(
      callers.map((u) =>
        rec.time(
          'queue_call_next (3 desks at once)',
          () =>
            rpc(db, { role: 'authenticated', userId: u }, 'queue_call_next', {
              p_queue_state_id: queueId,
            }),
          {
            expectedErrors: ['MQ_ALREADY_CALLED'],
          },
        ),
      ),
    )
    const winners = results.filter(Boolean)
    if (winners.length !== 1) doubleCalls++
    const called = winners[0]
    if (called) {
      await rec.time('queue START', () =>
        rpc(db, { role: 'authenticated', userId: h.doctorUsers[0] }, 'queue_update_status', {
          p_appointment_id: called.appointment_id,
          p_action: 'START',
        }),
      )
      await rec.time('queue COMPLETE', () =>
        rpc(db, { role: 'authenticated', userId: h.doctorUsers[0] }, 'queue_update_status', {
          p_appointment_id: called.appointment_id,
          p_action: 'COMPLETE',
        }),
      )
    }
  }
  check(
    'each simultaneous "call next" round called exactly one patient',
    doubleCalls === 0,
    `${doubleCalls} bad rounds of 30`,
  )
  const { rows: qstate } = await db.superuser.query(
    `select completed_count, waiting_count, current_token_no, next_token_no from public.queue_states where id = $1`,
    [queueId],
  )
  check(
    'queue state consistent after 30 rounds',
    qstate[0].completed_count === 30 &&
      qstate[0].waiting_count === 30 &&
      qstate[0].current_token_no === 30 &&
      qstate[0].next_token_no === 31,
    JSON.stringify(qstate[0]),
  )

  // ---------------------------------------------------------------- 4. payment retries + duplicate webhooks
  const paid = await createHospital(db, { doctors: 1, maxTokens: 120, walkinReserved: 0 })
  await db.superuser.query(
    `update public.hospitals set default_booking_fee_paise = 5000, online_payments_enabled = true where id = $1`,
    [paid.hospitalId],
  )
  const payers = await createUsers(db, 50)
  const svc = { role: 'service_role' }
  const holds = []
  await Promise.all(
    payers.map(async (u) => {
      const key = randomUUID()
      const args = {
        p_user_id: u,
        p_shift_id: paid.sessions[0].shiftId,
        p_session_date: paid.today,
        p_patient_name: 'Paying Patient',
        p_patient_phone: randomPhone(),
        p_patient_age: 40,
        p_idempotency_key: key,
        p_gateway_mode: 'test',
      }
      // the browser retries create-order 3 times concurrently (double clicks / flaky network)
      const results = await Promise.all(
        [0, 1, 2].map(() =>
          rec.time('svc_hold_paid_booking (3× retry)', () =>
            rpc(db, svc, 'svc_hold_paid_booking', args),
          ),
        ),
      )
      const first = results.find(Boolean)
      if (first) holds.push(first)
    }),
  )
  check(
    '50 checkouts × 3 retries → 50 holds',
    holds.length === 50 && new Set(holds.map((x) => x.appointment_id)).size === 50,
    `${holds.length} holds`,
  )
  await Promise.all(
    holds.map((hd, i) =>
      rec.time('svc_attach_order', () =>
        rpc(db, svc, 'svc_attach_order', {
          p_payment_id: hd.payment_id,
          p_gateway_order_id: `order_LOAD${i}`,
        }),
      ),
    ),
  )
  // verify call + 3 duplicate webhook deliveries + an order.paid event, all concurrently
  await Promise.all(
    holds.map((hd, i) =>
      Promise.all([
        rec.time('svc_confirm_payment (checkout)', () =>
          rpc(db, svc, 'svc_confirm_payment', {
            p_gateway_order_id: `order_LOAD${i}`,
            p_gateway_payment_id: `pay_LOAD${i}`,
            p_amount_paise: 5000,
            p_via: 'CHECKOUT_SIGNATURE',
          }),
        ),
        ...[0, 1, 2].map(() =>
          rec.time('svc_process_payment_event (dup webhook)', () =>
            rpc(db, svc, 'svc_process_payment_event', {
              p_event_id: `evt_LOAD${i}`,
              p_event_type: 'payment.captured',
              p_gateway_order_id: `order_LOAD${i}`,
              p_gateway_payment_id: `pay_LOAD${i}`,
              p_amount_paise: 5000,
            }),
          ),
        ),
        rec.time('svc_process_payment_event (order.paid)', () =>
          rpc(db, svc, 'svc_process_payment_event', {
            p_event_id: `evt_LOAD_ORDER${i}`,
            p_event_type: 'order.paid',
            p_gateway_order_id: `order_LOAD${i}`,
            p_gateway_payment_id: `pay_LOAD${i}`,
            p_amount_paise: 5000,
          }),
        ),
      ]),
    ),
  )
  const { rows: paidRows } = await db.superuser.query(
    `select count(*)::int as n, count(distinct token_no)::int as d, max(token_no) as mx from public.appointments a
     join public.queue_states q on q.id = a.queue_state_id where q.shift_id = $1 and a.status = 'CONFIRMED'`,
    [paid.sessions[0].shiftId],
  )
  const { rows: events } = await db.superuser.query(
    `select count(*)::int as n from public.payment_events where gateway_event_id like 'evt_LOAD%'`,
  )
  check(
    '50 payments confirmed once each despite 4 concurrent confirmations',
    paidRows[0].n === 50 && paidRows[0].d === 50 && paidRows[0].mx === 50,
    JSON.stringify(paidRows[0]),
  )
  check(
    'duplicate webhook deliveries stored once',
    events[0].n === 100,
    `${events[0].n} event rows for 100 unique event ids`,
  )

  const summary = rec.summary()
  printTable(summary)
  console.table(checks)
  writeFileSync(
    'load-results-booking-burst.json',
    JSON.stringify(
      { when: new Date().toISOString(), connections: CONNECTIONS, summary, checks },
      null,
      2,
    ),
  )
  console.log('wrote load-results-booking-burst.json')
} finally {
  await db.close()
}
