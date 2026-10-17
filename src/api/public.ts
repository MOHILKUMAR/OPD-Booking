// Public, read-only data: hospital, departments, doctors, sessions, announcements, display board.
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type {
  Announcement,
  Department,
  DisplayBoard,
  Doctor,
  DoctorSearchResult,
  Hospital,
  SessionRow,
} from '@/types/database'

const HOSPITAL_COLUMNS =
  'id, slug, name, tagline, address_line, city, state, postal_code, phone, emergency_phone, email, map_url, logo_url, timezone, operating_hours, visit_instructions, booking_window_days, cancel_cutoff_minutes, duplicate_policy, max_bookings_per_phone_per_day, require_patient_age, default_booking_fee_paise, online_payments_enabled, payment_hold_minutes, is_active'

export async function fetchHospital(slug: string): Promise<Hospital | null> {
  return unwrap(
    await supabase.from('hospitals').select(HOSPITAL_COLUMNS).eq('slug', slug).maybeSingle(),
  ) as Hospital | null
}

export async function fetchDepartments(hospitalId: string): Promise<Department[]> {
  return unwrap(
    await supabase
      .from('departments')
      .select('id, hospital_id, name, description, is_active, sort_order')
      .eq('hospital_id', hospitalId)
      .eq('is_active', true)
      .order('sort_order')
      .order('name'),
  ) as Department[]
}

export async function fetchSpecialties(hospitalId: string): Promise<string[]> {
  const rows = unwrap(
    await supabase
      .from('doctors')
      .select('specialty')
      .eq('hospital_id', hospitalId)
      .eq('is_active', true),
  ) as { specialty: string }[]
  return [...new Set(rows.map((r) => r.specialty))].sort()
}

export interface DoctorSearchParams {
  hospitalId: string
  search?: string
  departmentId?: string
  specialty?: string
  availableOnly?: boolean
  date?: string
  limit?: number
  offset?: number
}

export async function searchDoctors(p: DoctorSearchParams): Promise<DoctorSearchResult> {
  return unwrap(
    await supabase.rpc('search_doctors', {
      p_hospital_id: p.hospitalId,
      p_search: p.search || null,
      p_department_id: p.departmentId || null,
      p_specialty: p.specialty || null,
      p_available_only: p.availableOnly ?? false,
      p_date: p.date ?? null,
      p_limit: p.limit ?? 12,
      p_offset: p.offset ?? 0,
    }),
  ) as DoctorSearchResult
}

export async function fetchDoctor(doctorId: string): Promise<Doctor | null> {
  return unwrap(
    await supabase
      .from('doctors')
      .select(
        'id, hospital_id, department_id, full_name, specialty, qualifications, bio, photo_url, room_no, consultation_fee_paise, accepting_bookings, can_self_manage_session, is_active, sort_order, department:departments(id, name)',
      )
      .eq('id', doctorId)
      .maybeSingle(),
  ) as Doctor | null
}

export async function fetchSessions(
  hospitalId: string,
  from: string,
  to: string,
  doctorIds?: string[],
): Promise<SessionRow[]> {
  return unwrap(
    await supabase.rpc('get_sessions', {
      p_hospital_id: hospitalId,
      p_from: from,
      p_to: to,
      p_doctor_ids: doctorIds ?? null,
    }),
  ) as SessionRow[]
}

export async function fetchAnnouncements(hospitalId: string, limit = 5): Promise<Announcement[]> {
  return unwrap(
    await supabase
      .from('hospital_announcements')
      .select(
        'id, hospital_id, kind, title, body, doctor_id, is_published, show_on_display, published_at, expires_at, author_id, created_at',
      )
      .eq('hospital_id', hospitalId)
      .eq('is_published', true)
      .order('published_at', { ascending: false })
      .limit(limit),
  ) as Announcement[]
}

export async function fetchDisplayBoard(
  hospitalId: string,
  departmentId?: string,
): Promise<DisplayBoard | null> {
  return unwrap(
    await supabase.rpc('get_display_board', {
      p_hospital_id: hospitalId,
      p_department_id: departmentId ?? null,
    }),
  ) as DisplayBoard | null
}
