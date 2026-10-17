import { randomInt, randomUUID } from 'node:crypto'
import pg from 'pg'
import { expect, inject } from 'vitest'

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting).
pg.types.setTypeParser(1082, (v: string) => v)

/** Authenticator assurance level of a user token; null leaves the claim out. Default: 'aal1'. */
export type Aal = 'aal1' | 'aal2' | null

export type Caller =
  | { role: 'anon'; ip?: string }
  | { role: 'authenticated'; userId: string; isAnonymous?: boolean; aal?: Aal; ip?: string }
  | { role: 'service_role' }

export const anon: Caller = { role: 'anon' }
export const service: Caller = { role: 'service_role' }
export const user = (
  userId: string,
  extra: { isAnonymous?: boolean; aal?: Aal; ip?: string } = {},
): Caller => ({
  role: 'authenticated',
  userId,
  ...extra,
})

/**
 * Talks to the test cluster the way PostgREST does: connects as `authenticator`, then per
 * request runs `SET LOCAL ROLE` + `request.jwt.claims` inside a transaction.
 */
export class Db {
  readonly superuser: pg.Pool
  readonly api: pg.Pool

  constructor(maxApiConnections = 10) {
    const cfg = inject('db')
    this.superuser = new pg.Pool({ ...cfg, user: 'postgres', password: 'postgres', max: 4 })
    this.api = new pg.Pool({
      ...cfg,
      user: 'authenticator',
      password: 'authenticator',
      max: maxApiConnections,
    })
  }

  async sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.superuser.query(text, params)
    return res.rows as T[]
  }

  async as<T>(caller: Caller, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.api.connect()
    try {
      await client.query('begin')
      await client.query(`set local role ${caller.role}`)
      const aal =
        caller.role !== 'authenticated' ? null : caller.aal === undefined ? 'aal1' : caller.aal
      const claims =
        caller.role === 'authenticated'
          ? {
              sub: caller.userId,
              role: 'authenticated',
              is_anonymous: caller.isAnonymous ?? false,
              ...(aal ? { aal } : {}),
            }
          : { role: caller.role }
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify(claims),
      ])
      const ip = 'ip' in caller ? caller.ip : undefined
      await client.query(`select set_config('request.headers', $1, true)`, [
        JSON.stringify(ip ? { 'cf-connecting-ip': ip } : {}),
      ])
      const result = await fn(client)
      await client.query('commit')
      return result
    } catch (err) {
      await client.query('rollback').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  /** Calls public.<name>(arg => value, ...) and returns the scalar result. */
  async rpc<T = any>(caller: Caller, name: string, args: Record<string, unknown> = {}): Promise<T> {
    const keys = Object.keys(args)
    const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`
    return this.as(
      caller,
      async (c) => (await c.query(`select ${call} as result`, Object.values(args))).rows[0].result,
    )
  }

  /** Calls a set-returning public function. */
  async rpcRows<T = any>(
    caller: Caller,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T[]> {
    const keys = Object.keys(args)
    const call = `public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`
    return this.as(
      caller,
      async (c) => (await c.query(`select * from ${call}`, Object.values(args))).rows as T[],
    )
  }

  async query<T = any>(caller: Caller, text: string, params: unknown[] = []): Promise<T[]> {
    return this.as(caller, async (c) => (await c.query(text, params)).rows as T[])
  }

  async close() {
    await Promise.all([this.superuser.end(), this.api.end()])
  }
}

export async function expectMqError(promise: Promise<unknown>, code: string) {
  let error: unknown
  try {
    await promise
  } catch (err) {
    error = err
  }
  expect(error, `expected ${code}`).toBeDefined()
  expect((error as Error).message).toBe(code)
  return error as Error & { hint?: string; detail?: string }
}

export async function expectPermissionDenied(promise: Promise<unknown>) {
  let error: unknown
  try {
    await promise
  } catch (err) {
    error = err
  }
  expect(error, 'expected permission denied').toBeDefined()
  expect((error as { code?: string }).code).toBe('42501')
}

export const randomPhone = () => `9${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`

export async function createAuthUser(db: Db, opts: { anonymous?: boolean } = {}) {
  const id = randomUUID()
  await db.sql(`insert into auth.users (id, email, is_anonymous) values ($1, $2, $3)`, [
    id,
    opts.anonymous ? null : `${id}@test.local`,
    opts.anonymous ?? false,
  ])
  return id
}

/** Adds an authenticator-app factor, as Supabase Auth does on enrol ('unverified') and verify. */
export async function addMfaFactor(
  db: Db,
  userId: string,
  status: 'verified' | 'unverified' = 'verified',
) {
  await db.sql(
    `insert into auth.mfa_factors (user_id, friendly_name, factor_type, status)
     values ($1, 'Authenticator app', 'totp', $2)`,
    [userId, status],
  )
}

export interface Fixture {
  hospitalId: string
  departmentId: string
  doctorId: string
  doctor2Id: string
  /** all-day shift for doctor 1, scheduled every day, booking open until 23:59:59 */
  shiftId: string
  /** all-day shift for doctor 2 */
  shift2Id: string
  today: string
  tomorrow: string
  yesterday: string
  users: {
    admin: string
    receptionist: string
    receptionistDoctor2: string
    doctor: string
    doctor2: string
    patientA: string
    patientB: string
  }
}

export interface FixtureOptions {
  maxTokens?: number
  walkinReserved?: number
  hospital?: Record<string, unknown>
}

let fixtureCounter = 0

export async function createFixture(db: Db, opts: FixtureOptions = {}): Promise<Fixture> {
  fixtureCounter += 1
  const slug = `test-${process.pid}-${fixtureCounter}-${randomInt(0, 1_000_000)}`
  const hospital = {
    booking_window_days: 1,
    cancel_cutoff_minutes: 0,
    require_patient_age: false,
    ...opts.hospital,
  }
  const hospitalCols = Object.keys(hospital)
  const [{ id: hospitalId }] = await db.sql<{ id: string }>(
    `insert into public.hospitals (slug, name, address_line, city, state, ${hospitalCols.join(', ')})
     values ($1, 'Test Hospital', '1 Test Road', 'Testpur', 'Teststate', ${hospitalCols.map((_, i) => `$${i + 2}`).join(', ')})
     returning id`,
    [slug, ...Object.values(hospital)],
  )
  const [{ id: departmentId }] = await db.sql<{ id: string }>(
    `insert into public.departments (hospital_id, name) values ($1, 'General Medicine') returning id`,
    [hospitalId],
  )
  const doctorIds: string[] = []
  for (const name of ['Dr. Test One', 'Dr. Test Two']) {
    const [{ id }] = await db.sql<{ id: string }>(
      `insert into public.doctors (hospital_id, department_id, full_name, specialty, room_no)
       values ($1, $2, $3, 'General Physician', '1') returning id`,
      [hospitalId, departmentId, name],
    )
    doctorIds.push(id)
  }
  const shiftIds: string[] = []
  for (const doctorId of doctorIds) {
    const [{ id }] = await db.sql<{ id: string }>(
      `insert into public.shifts (hospital_id, doctor_id, name, start_time, end_time, max_tokens, walkin_reserved, booking_cutoff_minutes)
       values ($1, $2, 'All-day OPD', '00:00', '23:59:59', $3, $4, 0) returning id`,
      [hospitalId, doctorId, opts.maxTokens ?? 30, opts.walkinReserved ?? 0],
    )
    shiftIds.push(id)
    await db.sql(
      `insert into public.doctor_schedules (hospital_id, doctor_id, shift_id, weekday, effective_from)
       select $1, $2, $3, wd, current_date - 30 from generate_series(0, 6) wd`,
      [hospitalId, doctorId, id],
    )
  }
  const [{ today, tomorrow, yesterday }] = await db.sql<{
    today: string
    tomorrow: string
    yesterday: string
  }>(
    `select app.hospital_today($1) as today, app.hospital_today($1) + 1 as tomorrow, app.hospital_today($1) - 1 as yesterday`,
    [hospitalId],
  )

  const users = {
    admin: await createAuthUser(db),
    receptionist: await createAuthUser(db),
    receptionistDoctor2: await createAuthUser(db),
    doctor: await createAuthUser(db),
    doctor2: await createAuthUser(db),
    patientA: await createAuthUser(db, { anonymous: true }),
    patientB: await createAuthUser(db, { anonymous: true }),
  }
  await db.sql(
    `insert into public.user_roles (user_id, hospital_id, role, doctor_id) values
       ($1, $6, 'admin', null),
       ($2, $6, 'receptionist', null),
       ($3, $6, 'receptionist', $8),
       ($4, $6, 'doctor', $7),
       ($5, $6, 'doctor', $8)`,
    [
      users.admin,
      users.receptionist,
      users.receptionistDoctor2,
      users.doctor,
      users.doctor2,
      hospitalId,
      doctorIds[0],
      doctorIds[1],
    ],
  )

  return {
    hospitalId,
    departmentId,
    doctorId: doctorIds[0]!,
    doctor2Id: doctorIds[1]!,
    shiftId: shiftIds[0]!,
    shift2Id: shiftIds[1]!,
    today,
    tomorrow,
    yesterday,
    users,
  }
}

export interface BookingResult {
  appointment_id: string
  booking_reference: string
  access_key: string
  token_no: number | null
  status: string
  queue_state_id: string
  replayed: boolean
  [key: string]: unknown
}

export function book(
  db: Db,
  patientId: string,
  args: {
    shiftId: string
    date: string
    name?: string
    phone?: string
    age?: number | null
    requestId?: string
  },
  extra: { ip?: string } = {},
) {
  return db.rpc<BookingResult>(user(patientId, { isAnonymous: true, ...extra }), 'book_token', {
    p_shift_id: args.shiftId,
    p_session_date: args.date,
    p_patient_name: args.name ?? 'Test Patient',
    p_patient_phone: args.phone ?? randomPhone(),
    p_patient_age: args.age ?? 30,
    p_client_request_id: args.requestId ?? null,
  })
}

export function openSession(db: Db, f: Fixture, shiftId = f.shiftId, by = f.users.admin) {
  return db.rpc(user(by), 'session_control', {
    p_shift_id: shiftId,
    p_session_date: f.today,
    p_action: 'OPEN',
  })
}

export function queueAction(
  db: Db,
  by: string,
  appointmentId: string,
  action: string,
  reason?: string,
) {
  return db.rpc(user(by), 'queue_update_status', {
    p_appointment_id: appointmentId,
    p_action: action,
    p_reason: reason ?? null,
  })
}
