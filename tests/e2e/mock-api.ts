// A small in-memory stand-in for the Supabase REST/Auth endpoints the UI calls. It returns the
// same JSON shapes the real database functions return (see tests/db for the real behaviour).
// Realtime websockets are left unmocked on purpose: they fail, which exercises the polling fallback.
import type { Page, Request } from '@playwright/test'

export const API = 'http://127.0.0.1:54399'
export const KEY = 'c'.repeat(32)
export const REF = 'MQ-7K3P9XQ2'

const hospital = {
  id: 'h1',
  slug: 'demo-hospital',
  name: 'MediQueue Demo Hospital',
  tagline: 'Demo data for development - not a real hospital',
  address_line: '1 Example Road, Demo Nagar',
  city: 'Bengaluru',
  state: 'Karnataka',
  postal_code: '560001',
  phone: '+91 80 0000 0000',
  emergency_phone: '108',
  email: 'opd@example.com',
  map_url: null,
  logo_url: null,
  timezone: 'Asia/Kolkata',
  operating_hours: [{ label: 'OPD, Mon - Sat', hours: '09:00 - 13:00, 17:00 - 20:00' }],
  visit_instructions: 'Arrive 15 minutes before your expected turn.',
  booking_window_days: 1,
  cancel_cutoff_minutes: 60,
  duplicate_policy: 'PHONE',
  max_bookings_per_phone_per_day: 3,
  require_patient_age: true,
  default_booking_fee_paise: 0,
  online_payments_enabled: false,
  payment_hold_minutes: 15,
  is_active: true,
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

function session(
  doctorId: string,
  shiftId: string,
  date: string,
  over: Record<string, unknown> = {},
) {
  return {
    shift_id: shiftId,
    doctor_id: doctorId,
    session_date: date,
    shift_name: 'Morning OPD',
    start_time: '09:00:00',
    end_time: '13:00:00',
    queue_state_id: `q-${shiftId}-${date}`,
    session_status: date === today ? 'OPEN' : 'SCHEDULED',
    capacity: 40,
    online_capacity: 30,
    issued_count: 12,
    remaining_online: 18,
    bookable: true,
    unavailable_reason: null,
    unavailable_message: null,
    current_token_no: date === today ? 7 : null,
    next_token_no: date === today ? 8 : null,
    waiting_count: date === today ? 4 : 0,
    delay_minutes: 0,
    public_note: null,
    booking_fee_paise: 0,
    payment_required: false,
    avg_consult_minutes: 8,
    version: 3,
    ...over,
  }
}

const doctors = [
  {
    id: 'd1',
    full_name: 'Dr. Asha Rao (Demo)',
    specialty: 'General Physician',
    department: { id: 'dep1', name: 'General Medicine' },
    shift: 's1',
  },
  {
    id: 'd2',
    full_name: 'Dr. Meera Nair (Demo)',
    specialty: 'Paediatrician',
    department: { id: 'dep2', name: 'Paediatrics' },
    shift: 's2',
  },
]

const booking = (status = 'CONFIRMED') => ({
  booking_reference: REF,
  token_no: 13,
  status,
  source: 'ONLINE',
  session_date: today,
  created_at: new Date().toISOString(),
  patient_name_masked: 'R*** K****',
  patient_phone_masked: 'XXXXXX3210',
  doctor: {
    id: 'd1',
    full_name: 'Dr. Asha Rao (Demo)',
    specialty: 'General Physician',
    room_no: '101',
    department: 'General Medicine',
  },
  shift: { id: 's1', name: 'Morning OPD', start_time: '09:00:00', end_time: '13:00:00' },
  hospital: {
    name: hospital.name,
    address_line: hospital.address_line,
    city: hospital.city,
    state: hospital.state,
    postal_code: '560001',
    phone: hospital.phone,
    map_url: null,
    visit_instructions: hospital.visit_instructions,
  },
  fee_paise: 0,
  payment_mode: 'FREE',
  payment: null,
  refund: null,
  hold_expires_at: null,
  cancel_reason: null,
  queue: {
    queue_state_id: `q-s1-${today}`,
    doctor_id: 'd1',
    shift_id: 's1',
    session_date: today,
    status: 'OPEN',
    booking_open: true,
    start_time: '09:00:00',
    end_time: '13:00:00',
    capacity: 40,
    online_capacity: 30,
    issued_count: 13,
    waiting_count: 4,
    completed_count: 6,
    current_token_no: 7,
    next_token_no: 8,
    delay_minutes: 0,
    public_note: null,
    version: 9,
    updated_at: new Date().toISOString(),
  },
  patients_ahead: 5,
  estimated_wait_minutes: 40,
  can_cancel: true,
  cancel_block_reason: null,
  notifications: [
    {
      kind: 'BOOKED',
      title: 'Token 13 confirmed',
      body: 'Token 13 with Dr. Asha Rao (Demo).',
      created_at: new Date().toISOString(),
    },
  ],
})

function fakeJwt(sub: string) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 3600
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', is_anonymous: true, exp, aud: 'authenticated' })}.sig`
}

export interface MockState {
  calls: { method: string; url: string; body: unknown }[]
  bookingStatus: string
}

export async function mockSupabase(
  page: Page,
  opts: { bookingStatus?: string } = {},
): Promise<MockState> {
  const state: MockState = { calls: [], bookingStatus: opts.bookingStatus ?? 'CONFIRMED' }
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })

  await page.route(`${API}/**`, async (route) => {
    const req: Request = route.request()
    const url = new URL(req.url())
    const body = req.postData() ? JSON.parse(req.postData()!) : null
    state.calls.push({ method: req.method(), url: req.url(), body })
    const path = url.pathname

    if (req.method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      })
    const cors = { 'access-control-allow-origin': '*' }
    const reply = (b: unknown, status = 200) => route.fulfill({ ...json(b, status), headers: cors })

    if (path === '/auth/v1/signup') {
      const sub = '11111111-1111-4111-8111-111111111111'
      return reply({
        access_token: fakeJwt(sub),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'refresh-token',
        user: {
          id: sub,
          aud: 'authenticated',
          role: 'authenticated',
          is_anonymous: true,
          app_metadata: {},
          user_metadata: {},
          created_at: new Date().toISOString(),
        },
      })
    }
    if (path === '/rest/v1/hospitals') return reply([hospital])
    if (path === '/rest/v1/departments')
      return reply(
        doctors.map((d, i) => ({
          ...d.department,
          hospital_id: 'h1',
          description: null,
          is_active: true,
          sort_order: i,
        })),
      )
    if (path === '/rest/v1/hospital_announcements') {
      return reply([
        {
          id: 'a1',
          hospital_id: 'h1',
          kind: 'GENERAL',
          title: 'Demo environment',
          body: 'Fictional doctors. Do not enter real patient information.',
          doctor_id: null,
          is_published: true,
          show_on_display: true,
          published_at: new Date().toISOString(),
          expires_at: null,
          author_id: null,
          created_at: new Date().toISOString(),
        },
      ])
    }
    if (path === '/rest/v1/doctors') {
      const id = url.searchParams.get('id')?.replace('eq.', '')
      if (id) {
        const d = doctors.find((x) => x.id === id)
        return reply(
          d
            ? [
                {
                  ...d,
                  hospital_id: 'h1',
                  department_id: d.department.id,
                  qualifications: null,
                  bio: null,
                  photo_url: null,
                  room_no: '101',
                  consultation_fee_paise: 30000,
                  accepting_bookings: true,
                  can_self_manage_session: false,
                  is_active: true,
                  sort_order: 0,
                },
              ]
            : [],
        )
      }
      return reply(doctors.map((d) => ({ specialty: d.specialty })))
    }
    if (path === '/rest/v1/rpc/search_doctors') {
      const date = body?.p_date ?? today
      return reply({
        total: doctors.length,
        date,
        items: doctors.map((d) => ({
          id: d.id,
          full_name: d.full_name,
          specialty: d.specialty,
          qualifications: null,
          photo_url: null,
          room_no: '101',
          consultation_fee_paise: 30000,
          accepting_bookings: true,
          department: d.department,
          sessions: [session(d.id, d.shift, date)],
        })),
      })
    }
    if (path === '/rest/v1/rpc/get_sessions') {
      const ids: string[] = body?.p_doctor_ids ?? doctors.map((d) => d.id)
      return reply(
        doctors
          .filter((d) => ids.includes(d.id))
          .flatMap((d) => [
            session(d.id, d.shift, today),
            session(d.id, `${d.shift}-eve`, today, {
              shift_name: 'Evening OPD',
              start_time: '17:00:00',
              end_time: '20:00:00',
              bookable: false,
              remaining_online: 0,
              issued_count: 30,
              unavailable_reason: 'FULL',
              unavailable_message: 'All tokens for this session have been booked.',
            }),
            session(d.id, d.shift, tomorrow),
          ]),
      )
    }
    if (path === '/rest/v1/rpc/book_token') {
      return reply({
        appointment_id: 'appt-1',
        booking_reference: REF,
        access_key: KEY,
        token_no: 13,
        status: 'CONFIRMED',
        source: 'ONLINE',
        session_date: body.p_session_date,
        patient_name: body.p_patient_name,
        doctor_name: 'Dr. Asha Rao (Demo)',
        department: 'General Medicine',
        room_no: '101',
        shift_name: 'Morning OPD',
        start_time: '09:00:00',
        end_time: '13:00:00',
        fee_paise: 0,
        payment_mode: 'FREE',
        hold_expires_at: null,
        queue_state_id: `q-s1-${today}`,
        replayed: false,
      })
    }
    if (path === '/rest/v1/rpc/get_booking') {
      return reply(
        body?.p_access_key === KEY || body?.p_access_key == null
          ? booking(state.bookingStatus)
          : null,
      )
    }
    if (path === '/rest/v1/rpc/cancel_booking') {
      state.bookingStatus = 'CANCELLED'
      return reply({ booking_reference: REF, status: 'CANCELLED', refund_requested: false })
    }
    if (path === '/rest/v1/rpc/get_my_appointments') return reply([booking(state.bookingStatus)])
    if (path === '/rest/v1/rpc/get_display_board') {
      return reply({
        date: today,
        generated_at: new Date().toISOString(),
        sessions: doctors.map((d, i) => ({
          doctor_name: d.full_name,
          department: d.department.name,
          room_no: `10${i + 1}`,
          shift_name: 'Morning OPD',
          start_time: '09:00:00',
          end_time: '13:00:00',
          status: 'OPEN',
          current_token_no: 7 + i * 5,
          next_token_no: 8 + i * 5,
          waiting_count: 4,
          delay_minutes: i === 1 ? 15 : 0,
          public_note: null,
          version: 1,
        })),
        announcements: [
          {
            id: 'a1',
            kind: 'GENERAL',
            title: 'Demo environment',
            body: 'Fictional doctors.',
            published_at: new Date().toISOString(),
          },
        ],
      })
    }
    return reply({ message: `mock: unhandled ${req.method()} ${path}` }, 404)
  })
  return state
}

export { today, tomorrow }
