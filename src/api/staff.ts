// Staff operations: queue console, walk-ins, session control, appointment search.
import { unwrap } from '@/lib/errors'
import type { QueueAction } from '@/lib/queue-transitions'
import { supabase } from '@/lib/supabase'
import type { BookingResult, QueuePublic, QueueStats, StaffAppointment } from '@/types/database'

const APPOINTMENT_COLUMNS =
  'id, queue_state_id, doctor_id, shift_id, session_date, token_no, booking_reference, patient_name, patient_phone, patient_age, source, status, payment_mode, fee_paise, skip_count, version, arrived_at, called_at, consultation_started_at, completed_at, cancel_reason, created_at'

export async function fetchQueueAppointments(queueStateId: string): Promise<StaffAppointment[]> {
  return unwrap(
    await supabase
      .from('appointments')
      .select(APPOINTMENT_COLUMNS)
      .eq('queue_state_id', queueStateId)
      .neq('status', 'PAYMENT_PENDING')
      .order('token_no', { ascending: true }),
  ) as StaffAppointment[]
}

export interface AppointmentSearch {
  date?: string
  query?: string
  limit?: number
  offset?: number
}

/** Server-side search; RLS limits results to doctors the staff member can access. */
export async function searchAppointments(
  s: AppointmentSearch,
): Promise<{ rows: StaffAppointment[]; total: number }> {
  let q = supabase
    .from('appointments')
    .select(`${APPOINTMENT_COLUMNS}, doctor:doctors(full_name)`, { count: 'exact' })
    .order('session_date', { ascending: false })
    .order('token_no', { ascending: true })
    .range(s.offset ?? 0, (s.offset ?? 0) + (s.limit ?? 25) - 1)
  if (s.date) q = q.eq('session_date', s.date)
  const text = s.query?.trim()
  if (text) {
    const digits = text.replace(/\D/g, '')
    if (/^MQ-/i.test(text)) q = q.eq('booking_reference', text.toUpperCase())
    else if (digits.length >= 4 && digits.length === text.replace(/[\s+-]/g, '').length)
      q = q.like('patient_phone', `%${digits.slice(-10)}%`)
    else q = q.ilike('patient_name', `%${text.replace(/[%_\\]/g, '')}%`)
  }
  const { data, error, count } = await q
  if (error) unwrap({ data, error })
  return { rows: (data ?? []) as unknown as StaffAppointment[], total: count ?? 0 }
}

export async function queueAction(
  appointmentId: string,
  action: QueueAction,
  opts: { reason?: string; expectedVersion?: number } = {},
) {
  return unwrap(
    await supabase.rpc('queue_update_status', {
      p_appointment_id: appointmentId,
      p_action: action,
      p_reason: opts.reason ?? null,
      p_expected_version: opts.expectedVersion ?? null,
    }),
  ) as {
    appointment_id: string
    status: string
    version: number
    token_no: number
    queue: QueuePublic
  }
}

export async function callNext(queueStateId: string) {
  return unwrap(await supabase.rpc('queue_call_next', { p_queue_state_id: queueStateId })) as {
    token_no: number
    queue: QueuePublic
  }
}

export type SessionAction =
  'OPEN' | 'PAUSE' | 'RESUME' | 'CLOSE' | 'CANCEL' | 'BOOKING_OPEN' | 'BOOKING_CLOSE' | 'SET_DELAY'

export async function sessionControl(input: {
  shiftId: string
  sessionDate: string
  action: SessionAction
  note?: string | null
  delayMinutes?: number | null
  force?: boolean
}): Promise<QueuePublic> {
  return unwrap(
    await supabase.rpc('session_control', {
      p_shift_id: input.shiftId,
      p_session_date: input.sessionDate,
      p_action: input.action,
      p_note: input.note ?? null,
      p_delay_minutes: input.delayMinutes ?? null,
      p_force: input.force ?? false,
    }),
  ) as QueuePublic
}

export async function createWalkin(input: {
  shiftId: string
  patientName: string
  patientPhone: string
  patientAge: number | null
  requestId: string
}): Promise<BookingResult> {
  return unwrap(
    await supabase.rpc('create_walkin_token', {
      p_shift_id: input.shiftId,
      p_patient_name: input.patientName,
      p_patient_phone: input.patientPhone,
      p_patient_age: input.patientAge,
      p_mark_arrived: true,
      p_client_request_id: input.requestId,
    }),
  ) as BookingResult
}

export async function fetchQueueStats(queueStateId: string): Promise<QueueStats> {
  return unwrap(await supabase.rpc('queue_stats', { p_queue_state_id: queueStateId })) as QueueStats
}
