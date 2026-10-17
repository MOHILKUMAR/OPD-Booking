import { afterAll, describe, expect, it } from 'vitest'
import {
  anon,
  book,
  createAuthUser,
  createFixture,
  Db,
  expectMqError,
  expectPermissionDenied,
  service,
  user,
} from './helpers'

const db = new Db()
afterAll(() => db.close())

describe('doctor directory and sessions', () => {
  it('search_doctors filters on the server and paginates', async () => {
    const f = await createFixture(db)
    const [{ id: dep2 }] = await db.sql<{ id: string }>(
      `insert into public.departments (hospital_id, name) values ($1, 'Paediatrics') returning id`,
      [f.hospitalId],
    )
    await db.sql(
      `update public.doctors set department_id = $1, specialty = 'Paediatrician' where id = $2`,
      [dep2, f.doctor2Id],
    )

    const all = await db.rpc(anon, 'search_doctors', { p_hospital_id: f.hospitalId })
    expect(all.total).toBe(2)
    expect(all.items[0].sessions).toHaveLength(1)
    expect(all.items[0].sessions[0]).toMatchObject({ bookable: true, session_status: 'SCHEDULED' })

    expect(
      (await db.rpc(anon, 'search_doctors', { p_hospital_id: f.hospitalId, p_department_id: dep2 }))
        .total,
    ).toBe(1)
    expect(
      (
        await db.rpc(anon, 'search_doctors', {
          p_hospital_id: f.hospitalId,
          p_specialty: 'paediatrician',
        })
      ).total,
    ).toBe(1)
    expect(
      (await db.rpc(anon, 'search_doctors', { p_hospital_id: f.hospitalId, p_search: 'Two' }))
        .items[0].id,
    ).toBe(f.doctor2Id)
    // wildcard characters are treated literally
    expect(
      (await db.rpc(anon, 'search_doctors', { p_hospital_id: f.hospitalId, p_search: '%' })).total,
    ).toBe(0)

    const page1 = await db.rpc(anon, 'search_doctors', {
      p_hospital_id: f.hospitalId,
      p_limit: 1,
      p_offset: 0,
    })
    const page2 = await db.rpc(anon, 'search_doctors', {
      p_hospital_id: f.hospitalId,
      p_limit: 1,
      p_offset: 1,
    })
    expect(page1.total).toBe(2)
    expect(page1.items).toHaveLength(1)
    expect(page2.items[0].id).not.toBe(page1.items[0].id)
  })

  it('available-only hides doctors who cannot be booked that day', async () => {
    const f = await createFixture(db)
    await db.sql(
      `insert into public.shift_exceptions (hospital_id, doctor_id, exception_date, kind, reason) values ($1, $2, $3, 'CLOSED', 'On leave')`,
      [f.hospitalId, f.doctorId, f.tomorrow],
    )
    const res = await db.rpc(anon, 'search_doctors', {
      p_hospital_id: f.hospitalId,
      p_available_only: true,
      p_date: f.tomorrow,
    })
    expect(res.items.map((d: { id: string }) => d.id)).toEqual([f.doctor2Id])
    const sessions = await db.rpcRows(anon, 'get_sessions', {
      p_hospital_id: f.hospitalId,
      p_from: f.tomorrow,
      p_doctor_ids: [f.doctorId],
    })
    expect(sessions[0]).toMatchObject({ bookable: false, unavailable_reason: 'CLOSED' })
    expect(sessions[0].unavailable_message).toContain('On leave')
  })

  it('get_sessions reports live capacity and is consistent with booking', async () => {
    const f = await createFixture(db, { maxTokens: 3, walkinReserved: 1 })
    await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today })
    let [s] = await db.rpcRows(anon, 'get_sessions', {
      p_hospital_id: f.hospitalId,
      p_doctor_ids: [f.doctorId],
    })
    expect(s).toMatchObject({
      capacity: 3,
      online_capacity: 2,
      issued_count: 1,
      remaining_online: 1,
      bookable: true,
    })
    await book(db, f.users.patientA, { shiftId: f.shiftId, date: f.today })
    ;[s] = await db.rpcRows(anon, 'get_sessions', {
      p_hospital_id: f.hospitalId,
      p_doctor_ids: [f.doctorId],
    })
    expect(s).toMatchObject({ remaining_online: 0, bookable: false, unavailable_reason: 'FULL' })
    await expectMqError(
      db.rpcRows(anon, 'get_sessions', {
        p_hospital_id: f.hospitalId,
        p_from: f.today,
        p_to: '2030-01-01',
      }),
      'MQ_INVALID_RANGE',
    )
  })

  it('rejects overlapping shifts for the same doctor and weekday', async () => {
    const f = await createFixture(db)
    const [{ id: shiftId }] = await db.sql<{ id: string }>(
      `insert into public.shifts (hospital_id, doctor_id, name, start_time, end_time, max_tokens) values ($1, $2, 'Overlap', '10:00', '11:00', 10) returning id`,
      [f.hospitalId, f.doctorId],
    )
    await expect(
      db.query(
        user(f.users.admin),
        `insert into public.doctor_schedules (hospital_id, doctor_id, shift_id, weekday) values ($1, $2, $3, 1)`,
        [f.hospitalId, f.doctorId, shiftId],
      ),
    ).rejects.toThrow('MQ_SHIFT_OVERLAP')
    // the same hours on another doctor are fine
    const [{ id: other }] = await db.sql<{ id: string }>(
      `insert into public.shifts (hospital_id, doctor_id, name, start_time, end_time, max_tokens) values ($1, $2, 'Short', '10:00', '11:00', 10) returning id`,
      [f.hospitalId, f.doctor2Id],
    )
    await db.sql(`update public.doctor_schedules set is_active = false where doctor_id = $1`, [
      f.doctor2Id,
    ])
    await db.query(
      user(f.users.admin),
      `insert into public.doctor_schedules (hospital_id, doctor_id, shift_id, weekday) values ($1, $2, $3, 1)`,
      [f.hospitalId, f.doctor2Id, other],
    )
  })
})

describe('staff provisioning (service functions)', () => {
  it('grants roles only when the actor is an administrator; audited with the actor', async () => {
    const f = await createFixture(db)
    const newUser = await createAuthUser(db)
    expect(
      await db.rpc(service, 'svc_is_admin', {
        p_user_id: f.users.admin,
        p_hospital_id: f.hospitalId,
      }),
    ).toBe(true)
    expect(
      await db.rpc(service, 'svc_is_admin', {
        p_user_id: f.users.receptionist,
        p_hospital_id: f.hospitalId,
      }),
    ).toBe(false)

    await expectMqError(
      db.rpc(service, 'svc_grant_staff_role', {
        p_actor_user_id: f.users.receptionist,
        p_user_id: newUser,
        p_hospital_id: f.hospitalId,
        p_role: 'admin',
        p_doctor_id: null,
        p_full_name: 'Sneaky',
        p_email: 'x@example.com',
      }),
      'MQ_FORBIDDEN',
    )
    const res = await db.rpc(service, 'svc_grant_staff_role', {
      p_actor_user_id: f.users.admin,
      p_user_id: newUser,
      p_hospital_id: f.hospitalId,
      p_role: 'receptionist',
      p_doctor_id: f.doctorId,
      p_full_name: 'Desk Two',
      p_email: 'Desk2@Example.com',
    })
    expect(res.already_had_role).toBe(false)
    const [log] = await db.sql<{ actor_user_id: string; action: string }>(
      `select actor_user_id, action from public.audit_logs where action = 'staff.role_granted' and hospital_id = $1`,
      [f.hospitalId],
    )
    expect(log).toEqual({ actor_user_id: f.users.admin, action: 'staff.role_granted' })
    expect(
      await db.rpc(service, 'svc_find_user_by_email', {
        p_email: `${newUser.toUpperCase()}@TEST.local`,
      }),
    ).toBe(newUser)
    expect(
      await db.rpc(service, 'svc_find_user_by_email', { p_email: 'nobody@example.com' }),
    ).toBeNull()
  })

  it('is not callable by browsers', async () => {
    const f = await createFixture(db)
    await expectPermissionDenied(
      db.rpc(user(f.users.admin), 'svc_is_admin', {
        p_user_id: f.users.admin,
        p_hospital_id: f.hospitalId,
      }),
    )
    await expectPermissionDenied(db.rpc(anon, 'svc_find_user_by_email', { p_email: 'a@b.c' }))
  })
})
