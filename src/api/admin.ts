// Administrator data access. Every write is also enforced by RLS (admin-only) and audited by
// database triggers; nothing here is trusted on its own.
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type {
  Announcement,
  AuditLog,
  DashboardStats,
  Department,
  Doctor,
  DoctorSchedule,
  Hospital,
  Payment,
  Profile,
  Refund,
  Shift,
  ShiftException,
  UserRole,
} from '@/types/database'
import { invokeFunction } from './functions'

export async function fetchDashboard(
  hospitalId: string,
  from: string,
  to: string,
): Promise<DashboardStats> {
  return unwrap(
    await supabase.rpc('admin_dashboard', { p_hospital_id: hospitalId, p_from: from, p_to: to }),
  ) as DashboardStats
}

// --- hospital settings ------------------------------------------------------
export type HospitalSettings = Omit<Hospital, 'id' | 'slug' | 'is_active' | 'timezone'>

export async function updateHospital(id: string, patch: Partial<HospitalSettings>) {
  return unwrap(await supabase.from('hospitals').update(patch).eq('id', id).select('id').single())
}

// --- departments ------------------------------------------------------------
export async function fetchAllDepartments(hospitalId: string): Promise<Department[]> {
  return unwrap(
    await supabase
      .from('departments')
      .select('*')
      .eq('hospital_id', hospitalId)
      .order('sort_order')
      .order('name'),
  ) as Department[]
}

export async function saveDepartment(
  d: Partial<Department> & { hospital_id: string; name: string },
) {
  const { id, ...rest } = d
  return id
    ? unwrap(await supabase.from('departments').update(rest).eq('id', id).select('id').single())
    : unwrap(await supabase.from('departments').insert(rest).select('id').single())
}

// --- doctors ----------------------------------------------------------------
export async function fetchAllDoctors(hospitalId: string): Promise<Doctor[]> {
  return unwrap(
    await supabase
      .from('doctors')
      .select('*, department:departments(id, name)')
      .eq('hospital_id', hospitalId)
      .order('sort_order')
      .order('full_name'),
  ) as Doctor[]
}

export type DoctorInput = Omit<Doctor, 'id' | 'department'> & { id?: string }

export async function saveDoctor(d: DoctorInput): Promise<{ id: string }> {
  const { id, ...rest } = d
  return id
    ? (unwrap(await supabase.from('doctors').update(rest).eq('id', id).select('id').single()) as {
        id: string
      })
    : (unwrap(await supabase.from('doctors').insert(rest).select('id').single()) as { id: string })
}

// --- shifts + weekly schedules ---------------------------------------------
export interface ShiftWithDays extends Shift {
  weekdays: number[]
}

export async function fetchDoctorShifts(doctorId: string): Promise<ShiftWithDays[]> {
  const shifts = unwrap(
    await supabase.from('shifts').select('*').eq('doctor_id', doctorId).order('start_time'),
  ) as Shift[]
  const schedules = unwrap(
    await supabase
      .from('doctor_schedules')
      .select('*')
      .eq('doctor_id', doctorId)
      .eq('is_active', true),
  ) as DoctorSchedule[]
  return shifts.map((s) => ({
    ...s,
    weekdays: schedules
      .filter((d) => d.shift_id === s.id)
      .map((d) => d.weekday)
      .sort(),
  }))
}

export type ShiftInput = Omit<Shift, 'id'> & { id?: string; weekdays: number[] }

/**
 * Saves a shift and syncs its weekdays. The database rejects overlapping shifts
 * (MQ_SHIFT_OVERLAP), so a conflicting edit fails cleanly.
 */
export async function saveShift(input: ShiftInput, today: string): Promise<void> {
  const { id, weekdays, ...shift } = input
  const saved = id
    ? (unwrap(await supabase.from('shifts').update(shift).eq('id', id).select('id').single()) as {
        id: string
      })
    : (unwrap(await supabase.from('shifts').insert(shift).select('id').single()) as { id: string })

  const existing = unwrap(
    await supabase
      .from('doctor_schedules')
      .select('id, weekday, is_active')
      .eq('shift_id', saved.id),
  ) as Pick<DoctorSchedule, 'id' | 'weekday' | 'is_active'>[]
  const removed = existing.filter((e) => e.is_active && !weekdays.includes(e.weekday))
  if (removed.length) {
    unwrap(
      await supabase
        .from('doctor_schedules')
        .delete()
        .in(
          'id',
          removed.map((r) => r.id),
        ),
    )
  }
  const activeDays = new Set(existing.filter((e) => e.is_active).map((e) => e.weekday))
  const added = weekdays.filter((w) => !activeDays.has(w))
  if (added.length) {
    unwrap(
      await supabase.from('doctor_schedules').upsert(
        added.map((weekday) => ({
          hospital_id: shift.hospital_id,
          doctor_id: shift.doctor_id,
          shift_id: saved.id,
          weekday,
          effective_from: today,
          is_active: true,
        })),
        { onConflict: 'shift_id,weekday,effective_from' },
      ),
    )
  }
}

// --- exceptions -------------------------------------------------------------
export async function fetchExceptions(
  hospitalId: string,
  fromDate: string,
): Promise<ShiftException[]> {
  return unwrap(
    await supabase
      .from('shift_exceptions')
      .select('*')
      .eq('hospital_id', hospitalId)
      .gte('exception_date', fromDate)
      .order('exception_date')
      .limit(200),
  ) as ShiftException[]
}

export async function createException(e: Omit<ShiftException, 'id' | 'created_at'>) {
  return unwrap(await supabase.from('shift_exceptions').insert(e).select('id').single())
}

export async function deleteException(id: string) {
  return unwrap(await supabase.from('shift_exceptions').delete().eq('id', id))
}

// --- announcements ----------------------------------------------------------
export async function fetchAllAnnouncements(hospitalId: string): Promise<Announcement[]> {
  return unwrap(
    await supabase
      .from('hospital_announcements')
      .select('*')
      .eq('hospital_id', hospitalId)
      .order('created_at', { ascending: false })
      .limit(100),
  ) as Announcement[]
}

export type AnnouncementInput = Pick<
  Announcement,
  | 'hospital_id'
  | 'kind'
  | 'title'
  | 'body'
  | 'doctor_id'
  | 'is_published'
  | 'show_on_display'
  | 'expires_at'
> & { id?: string }

export async function saveAnnouncement(a: AnnouncementInput) {
  const { id, ...rest } = a
  return id
    ? unwrap(
        await supabase
          .from('hospital_announcements')
          .update(rest)
          .eq('id', id)
          .select('id')
          .single(),
      )
    : unwrap(await supabase.from('hospital_announcements').insert(rest).select('id').single())
}

export async function deleteAnnouncement(id: string) {
  return unwrap(await supabase.from('hospital_announcements').delete().eq('id', id))
}

// --- staff ------------------------------------------------------------------
export interface StaffMember {
  user_id: string
  profile: Profile | null
  roles: UserRole[]
}

export async function fetchStaff(hospitalId: string): Promise<StaffMember[]> {
  const roles = unwrap(
    await supabase.from('user_roles').select('*').eq('hospital_id', hospitalId).order('created_at'),
  ) as UserRole[]
  const ids = [...new Set(roles.map((r) => r.user_id))]
  const profiles = ids.length
    ? (unwrap(
        await supabase.from('profiles').select('id, full_name, email').in('id', ids),
      ) as Profile[])
    : []
  return ids.map((user_id) => ({
    user_id,
    profile: profiles.find((p) => p.id === user_id) ?? null,
    roles: roles.filter((r) => r.user_id === user_id),
  }))
}

export async function createStaff(input: {
  hospital_id: string
  email: string
  password: string
  full_name: string
  role: UserRole['role']
  doctor_id?: string | null
}) {
  return invokeFunction<{ user_id: string; created: boolean }>('admin-create-staff', input)
}

export async function addRole(r: Pick<UserRole, 'user_id' | 'hospital_id' | 'role' | 'doctor_id'>) {
  return unwrap(await supabase.from('user_roles').insert(r).select('id').single())
}

export async function removeRole(roleId: string) {
  return unwrap(await supabase.from('user_roles').delete().eq('id', roleId))
}

// --- payments / refunds -----------------------------------------------------
export interface PaymentRow extends Payment {
  appointment: { booking_reference: string; session_date: string; status: string } | null
}

export async function fetchPayments(hospitalId: string, offset = 0, limit = 25) {
  const { data, error, count } = await supabase
    .from('payments')
    .select('*, appointment:appointments(booking_reference, session_date, status)', {
      count: 'exact',
    })
    .eq('hospital_id', hospitalId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) unwrap({ data, error })
  return { rows: (data ?? []) as unknown as PaymentRow[], total: count ?? 0 }
}

export interface RefundRow extends Refund {
  appointment: { booking_reference: string } | null
}

export async function fetchRefunds(hospitalId: string): Promise<RefundRow[]> {
  return unwrap(
    await supabase
      .from('refunds')
      .select('*, appointment:appointments(booking_reference)')
      .eq('hospital_id', hospitalId)
      .order('requested_at', { ascending: false })
      .limit(100),
  ) as RefundRow[]
}

export async function processRefund(refundId: string) {
  return invokeFunction<{ refund_id: string; status: string }>('payments-refund', {
    refund_id: refundId,
  })
}

export async function rejectRefund(refundId: string, reason: string) {
  return unwrap(await supabase.rpc('reject_refund', { p_refund_id: refundId, p_reason: reason }))
}

// --- audit ------------------------------------------------------------------
export async function fetchAuditLogs(
  hospitalId: string,
  opts: { action?: string; offset?: number; limit?: number },
) {
  let q = supabase
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .eq('hospital_id', hospitalId)
    .order('id', { ascending: false })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 50) - 1)
  if (opts.action) q = q.like('action', `${opts.action.replace(/[%_\\]/g, '')}%`)
  const { data, error, count } = await q
  if (error) unwrap({ data, error })
  return { rows: (data ?? []) as AuditLog[], total: count ?? 0 }
}
