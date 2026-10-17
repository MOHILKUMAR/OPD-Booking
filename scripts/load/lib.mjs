// Shared helpers for the database load tests. Calls go through the same role switching
// PostgREST performs (authenticator → anon/authenticated/service_role + JWT claims), so the
// measured work is exactly what a browser or Edge Function request triggers in PostgreSQL.
// Network latency to a hosted Supabase project is NOT included — see docs/09-load-test-report.md.
import { randomInt, randomUUID } from 'node:crypto'
import pg from 'pg'
import { startCluster } from '../pg-cluster.mjs'

pg.types.setTypeParser(1082, (v) => v)

export async function openDatabase({ port = 54349, connections = 60 } = {}) {
  if (process.env.LOAD_DATABASE_URL) {
    throw new Error(
      'LOAD_DATABASE_URL is not supported for safety; run against the embedded cluster or a disposable copy.',
    )
  }
  // durable: fsync + synchronous_commit stay on so write latency is realistic
  const cluster = await startCluster({ port, database: 'mediqueue_load', durable: true })
  const cfg = cluster.config
  const superuser = new pg.Pool({ ...cfg, user: 'postgres', password: 'postgres', max: 5 })
  const api = new pg.Pool({
    ...cfg,
    user: 'authenticator',
    password: 'authenticator',
    max: connections,
  })
  return {
    superuser,
    api,
    async close() {
      await Promise.all([superuser.end(), api.end()])
      await cluster.stop()
    },
  }
}

/** One "HTTP request": a transaction with role + claims, like PostgREST. Returns { ms, result }. */
export async function call(db, caller, sql, params = []) {
  const started = performance.now()
  const client = await db.api.connect()
  try {
    await client.query('begin')
    await client.query(`set local role ${caller.role}`)
    const claims =
      caller.role === 'authenticated'
        ? { sub: caller.userId, role: 'authenticated', is_anonymous: !!caller.anonymous }
        : { role: caller.role }
    await client.query(
      `select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true)`,
      [JSON.stringify(claims), JSON.stringify(caller.ip ? { 'cf-connecting-ip': caller.ip } : {})],
    )
    const res = await client.query(sql, params)
    await client.query('commit')
    return { ms: performance.now() - started, result: res.rows[0]?.r ?? res.rows }
  } catch (err) {
    await client.query('rollback').catch(() => {})
    err.ms = performance.now() - started
    throw err
  } finally {
    client.release()
  }
}

export const rpc = (db, caller, name, args) => {
  const keys = Object.keys(args)
  return call(
    db,
    caller,
    `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`,
    Object.values(args),
  )
}

export const rpcRows = (db, caller, name, args) => {
  const keys = Object.keys(args)
  return call(
    db,
    caller,
    `select * from public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`,
    Object.values(args),
  )
}

export const randomPhone = () => `9${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`
export const randomIp = () => `100.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`

export async function createUsers(db, n, anonymous = true) {
  const ids = Array.from({ length: n }, () => randomUUID())
  await db.superuser.query(
    `insert into auth.users (id, is_anonymous) select unnest($1::uuid[]), $2`,
    [ids, anonymous],
  )
  return ids
}

/** A hospital with `doctors` doctors, each with one all-day shift scheduled every day. */
export async function createHospital(
  db,
  { doctors = 6, maxTokens = 60, walkinReserved = 10 } = {},
) {
  const q = (sql, params) => db.superuser.query(sql, params).then((r) => r.rows)
  const [{ id: hospitalId }] = await q(
    `insert into public.hospitals (slug, name, address_line, city, state, booking_window_days, cancel_cutoff_minutes, require_patient_age)
     values ($1, 'Load Test Hospital', '1 Load Road', 'Testpur', 'Teststate', 1, 0, false) returning id`,
    [`load-${randomInt(0, 1e9)}`],
  )
  const [{ id: departmentId }] = await q(
    `insert into public.departments (hospital_id, name) values ($1, 'General') returning id`,
    [hospitalId],
  )
  const out = []
  for (let i = 0; i < doctors; i++) {
    const [{ id: doctorId }] = await q(
      `insert into public.doctors (hospital_id, department_id, full_name, specialty, sort_order) values ($1, $2, $3, 'General Physician', $4) returning id`,
      [hospitalId, departmentId, `Dr. Load ${i + 1}`, i],
    )
    const [{ id: shiftId }] = await q(
      `insert into public.shifts (hospital_id, doctor_id, name, start_time, end_time, max_tokens, walkin_reserved, booking_cutoff_minutes, avg_consult_minutes)
       values ($1, $2, 'All-day OPD', '00:00', '23:59:59', $3, $4, 0, 8) returning id`,
      [hospitalId, doctorId, maxTokens, walkinReserved],
    )
    await q(
      `insert into public.doctor_schedules (hospital_id, doctor_id, shift_id, weekday, effective_from)
       select $1, $2, $3, wd, current_date - 7 from generate_series(0, 6) wd`,
      [hospitalId, doctorId, shiftId],
    )
    out.push({ doctorId, shiftId })
  }
  const [{ today }] = await q(`select app.hospital_today($1) as today`, [hospitalId])
  const [admin, receptionist, ...doctorUsers] = await createUsers(db, 2 + doctors, false)
  await q(
    `insert into public.user_roles (user_id, hospital_id, role) values ($1, $3, 'admin'), ($2, $3, 'receptionist')`,
    [admin, receptionist, hospitalId],
  )
  for (let i = 0; i < doctors; i++) {
    await q(
      `insert into public.user_roles (user_id, hospital_id, role, doctor_id) values ($1, $2, 'doctor', $3)`,
      [doctorUsers[i], hospitalId, out[i].doctorId],
    )
  }
  return { hospitalId, today, admin, receptionist, doctorUsers, sessions: out }
}

export class Recorder {
  constructor() {
    this.ops = new Map()
  }
  add(name, ms, ok, code) {
    const op = this.ops.get(name) ?? { name, samples: [], ok: 0, rejected: 0, errors: {} }
    op.samples.push(ms)
    if (ok && !code) op.ok += 1
    else if (ok)
      op.rejected += 1 // expected business rejection (e.g. FULL, duplicate)
    else op.errors[code] = (op.errors[code] ?? 0) + 1
    this.ops.set(name, op)
  }
  async time(name, fn, { expectedErrors = [] } = {}) {
    try {
      const { ms, result } = await fn()
      this.add(name, ms, true)
      return result
    } catch (err) {
      const code = err.message?.startsWith('MQ_') ? err.message : (err.code ?? 'ERROR')
      this.add(name, err.ms ?? 0, expectedErrors.includes(code), code)
      if (!err.message?.startsWith('MQ_')) throw err
      return null
    }
  }
  summary() {
    return [...this.ops.values()].map((op) => {
      const s = [...op.samples].sort((a, b) => a - b)
      const pct = (p) =>
        s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0
      return {
        operation: op.name,
        calls: s.length,
        ok: op.ok,
        rejected_as_expected: op.rejected,
        errors: op.errors,
        p50_ms: +pct(50).toFixed(1),
        p95_ms: +pct(95).toFixed(1),
        p99_ms: +pct(99).toFixed(1),
        max_ms: +(s.at(-1) ?? 0).toFixed(1),
      }
    })
  }
}

export function printTable(rows) {
  console.table(
    rows.map((r) => ({
      ...r,
      errors:
        Object.entries(r.errors)
          .map(([k, v]) => `${k}:${v}`)
          .join(' ') || '-',
    })),
  )
}

/** Runs `tasks` (functions returning promises) with at most `limit` in flight. */
export async function pool(tasks, limit) {
  const results = new Array(tasks.length)
  let next = 0
  async function worker() {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]().then(
        (v) => ({ status: 'fulfilled', value: v }),
        (e) => ({ status: 'rejected', reason: e }),
      )
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}
