// Row and RPC shapes used by the app. Hand-written to match supabase/migrations; regenerate
// with `npx supabase gen types typescript` once a project is linked if you prefer generated types.

export type AppRole = 'admin' | 'receptionist' | 'doctor'

export type AppointmentStatus =
  | 'BOOKED'
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'ARRIVED'
  | 'WAITING'
  | 'CALLED'
  | 'IN_CONSULTATION'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'NO_SHOW'

export type SessionStatus = 'SCHEDULED' | 'OPEN' | 'PAUSED' | 'CLOSED' | 'CANCELLED'
export type PaymentMode = 'FREE' | 'PAY_AT_HOSPITAL' | 'ONLINE'
export type PaymentStatus =
  'CREATED' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED'
export type RefundStatus = 'REQUESTED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'REJECTED'
export type ExceptionKind = 'HOLIDAY' | 'CLOSED' | 'MODIFIED_HOURS' | 'CAPACITY_CHANGE'
export type AnnouncementKind =
  'GENERAL' | 'DOCTOR_DELAY' | 'OPD_CANCELLED' | 'HOLIDAY' | 'SCHEDULE_CHANGE'
export type DuplicatePolicy = 'PHONE' | 'PHONE_AND_NAME'

export interface Hospital {
  id: string
  slug: string
  name: string
  tagline: string | null
  address_line: string
  city: string
  state: string
  postal_code: string | null
  phone: string | null
  emergency_phone: string | null
  email: string | null
  map_url: string | null
  logo_url: string | null
  timezone: string
  operating_hours: { label: string; hours: string }[]
  visit_instructions: string | null
  booking_window_days: number
  cancel_cutoff_minutes: number
  duplicate_policy: DuplicatePolicy
  max_bookings_per_phone_per_day: number
  require_patient_age: boolean
  default_booking_fee_paise: number
  online_payments_enabled: boolean
  payment_hold_minutes: number
  /** Send eligible refunds to Razorpay without waiting for an administrator. */
  auto_refund_enabled: boolean
  /** Refunds above this (paise) still wait for an administrator; null = no limit. */
  auto_refund_max_paise: number | null
  /** "Your turn is near" when at most this many patients are ahead; 0 = off. */
  turn_alert_ahead: number
  /** Visit reminder this many minutes before the OPD starts; 0 = off. */
  visit_reminder_minutes: number
  /** Queue SMS copies of alerts (needs a paid provider; off by default). */
  sms_alerts_enabled: boolean
  is_active: boolean
}

export interface Department {
  id: string
  hospital_id: string
  name: string
  description: string | null
  is_active: boolean
  sort_order: number
}

export interface Doctor {
  id: string
  hospital_id: string
  department_id: string
  full_name: string
  specialty: string
  qualifications: string | null
  bio: string | null
  photo_url: string | null
  room_no: string | null
  consultation_fee_paise: number
  accepting_bookings: boolean
  can_self_manage_session: boolean
  is_active: boolean
  sort_order: number
  department?: Pick<Department, 'id' | 'name'> | null
}

export interface Shift {
  id: string
  hospital_id: string
  doctor_id: string
  name: string
  start_time: string
  end_time: string
  max_tokens: number
  walkin_reserved: number
  booking_cutoff_minutes: number
  avg_consult_minutes: number
  booking_fee_paise: number | null
  is_active: boolean
}

export interface DoctorSchedule {
  id: string
  hospital_id: string
  doctor_id: string
  shift_id: string
  weekday: number
  effective_from: string
  effective_to: string | null
  is_active: boolean
}

export interface ShiftException {
  id: string
  hospital_id: string
  doctor_id: string | null
  shift_id: string | null
  exception_date: string
  kind: ExceptionKind
  start_time: string | null
  end_time: string | null
  max_tokens: number | null
  reason: string
  created_at: string
}

/** One row of get_sessions(): an effective OPD session for a shift and date. */
export interface SessionRow {
  shift_id: string
  doctor_id: string
  session_date: string
  shift_name: string
  start_time: string
  end_time: string
  queue_state_id: string | null
  session_status: SessionStatus
  capacity: number
  online_capacity: number
  issued_count: number
  remaining_online: number
  bookable: boolean
  unavailable_reason: string | null
  unavailable_message: string | null
  current_token_no: number | null
  next_token_no: number | null
  waiting_count: number
  delay_minutes: number
  public_note: string | null
  booking_fee_paise: number
  payment_required: boolean
  avg_consult_minutes: number
  version: number
}

export interface DoctorSearchItem {
  id: string
  full_name: string
  specialty: string
  qualifications: string | null
  photo_url: string | null
  room_no: string | null
  consultation_fee_paise: number
  accepting_bookings: boolean
  department: { id: string; name: string }
  sessions: SessionRow[]
}

export interface DoctorSearchResult {
  total: number
  date: string
  items: DoctorSearchItem[]
}

export interface QueuePublic {
  queue_state_id: string
  doctor_id: string
  shift_id: string
  session_date: string
  status: SessionStatus
  booking_open: boolean
  start_time: string
  end_time: string
  capacity: number
  online_capacity: number
  issued_count: number
  waiting_count: number
  completed_count: number
  current_token_no: number | null
  next_token_no: number | null
  delay_minutes: number
  public_note: string | null
  version: number
  updated_at: string
}

export interface BookingResult {
  appointment_id: string
  booking_reference: string
  access_key: string
  token_no: number | null
  status: AppointmentStatus
  source: 'ONLINE' | 'WALK_IN'
  session_date: string
  patient_name: string
  doctor_name: string
  department: string
  room_no: string | null
  shift_name: string
  start_time: string
  end_time: string
  fee_paise: number
  payment_mode: PaymentMode
  hold_expires_at: string | null
  queue_state_id: string
  replayed: boolean
}

export interface BookingView {
  booking_reference: string
  token_no: number | null
  status: AppointmentStatus
  source: 'ONLINE' | 'WALK_IN'
  session_date: string
  created_at: string
  patient_name_masked: string
  patient_phone_masked: string
  doctor: {
    id: string
    full_name: string
    specialty: string
    room_no: string | null
    department: string
  }
  shift: { id: string; name: string; start_time: string; end_time: string }
  hospital: {
    name: string
    address_line: string
    city: string
    state: string
    postal_code: string | null
    phone: string | null
    map_url: string | null
    visit_instructions: string | null
  }
  fee_paise: number
  payment_mode: PaymentMode
  payment: { status: PaymentStatus; amount_paise: number; verified_at: string | null } | null
  refund: { status: RefundStatus; amount_paise: number; processed_at: string | null } | null
  hold_expires_at: string | null
  cancel_reason: string | null
  queue: QueuePublic
  patients_ahead: number | null
  estimated_wait_minutes: number | null
  can_cancel: boolean
  cancel_block_reason: string | null
  notifications: BookingNotification[]
}

/** In-app notification on a booking. `data` holds template values for translated display. */
export interface BookingNotification {
  id: string
  kind: string
  title: string
  body: string
  data?: Record<string, unknown>
  created_at: string
}

/** Staff view of an appointment (RLS-protected table select). */
export interface StaffAppointment {
  id: string
  queue_state_id: string
  doctor_id: string
  shift_id: string
  session_date: string
  token_no: number | null
  booking_reference: string
  patient_name: string
  patient_phone: string
  patient_age: number | null
  source: 'ONLINE' | 'WALK_IN'
  status: AppointmentStatus
  payment_mode: PaymentMode
  fee_paise: number
  skip_count: number
  version: number
  arrived_at: string | null
  called_at: string | null
  consultation_started_at: string | null
  completed_at: string | null
  cancel_reason: string | null
  created_at: string
}

export interface DisplaySession {
  doctor_name: string
  department: string
  room_no: string | null
  shift_name: string
  start_time: string
  end_time: string
  status: SessionStatus
  current_token_no: number | null
  next_token_no: number | null
  waiting_count: number
  delay_minutes: number
  public_note: string | null
  version: number
}

export interface DisplayBoard {
  date: string
  generated_at: string
  sessions: DisplaySession[]
  announcements: {
    id: string
    kind: AnnouncementKind
    title: string
    body: string
    published_at: string
  }[]
}

export interface Announcement {
  id: string
  hospital_id: string
  kind: AnnouncementKind
  title: string
  body: string
  doctor_id: string | null
  is_published: boolean
  show_on_display: boolean
  published_at: string | null
  expires_at: string | null
  author_id: string | null
  created_at: string
}

export interface UserRole {
  id: string
  user_id: string
  hospital_id: string
  role: AppRole
  doctor_id: string | null
  created_at: string
}

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
}

export interface Payment {
  id: string
  appointment_id: string
  gateway_mode: 'test' | 'live'
  gateway_order_id: string | null
  gateway_payment_id: string | null
  amount_paise: number
  currency: string
  status: PaymentStatus
  verified_via: string | null
  verified_at: string | null
  failure_reason: string | null
  created_at: string
  receipt: string
}

export interface Refund {
  id: string
  payment_id: string
  appointment_id: string
  amount_paise: number
  status: RefundStatus
  reason: string
  gateway_refund_id: string | null
  requested_at: string
  processed_at: string | null
  failure_reason: string | null
  /** Who started the gateway refund: an administrator or the automatic policy. */
  initiated_via: 'ADMIN' | 'AUTO' | null
}

export interface AuditLog {
  id: number
  actor_user_id: string | null
  actor_role: string
  action: string
  entity_type: string
  entity_id: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface QueueStats {
  queue: QueuePublic
  by_status: Partial<Record<AppointmentStatus, number>>
  avg_consult_minutes: number | null
  avg_wait_minutes: number | null
}

export interface DashboardStats {
  today: string
  range: { from: string; to: string }
  today_counts: {
    total: number
    confirmed: number
    waiting: number
    serving: number
    completed: number
    cancelled: number
    no_show: number
    skipped: number
    payment_pending: number
    walk_in: number
    online: number
  }
  active_doctors: number
  sessions_in_progress: number
  conversion: {
    online_created: number
    online_confirmed: number
    payment_holds: number
    payment_holds_confirmed: number
    cancelled: number
    completed: number
    no_show: number
  }
  by_day: { date: string; bookings: number; cancelled: number; completed: number }[]
  by_department: { department: string; bookings: number }[]
  by_doctor: { doctor: string; patients: number; completed: number }[]
  peak_hours: { hour: number; bookings: number }[]
}
