import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookingView, Hospital, SessionRow } from '@/types/database'

const mocks = vi.hoisted(() => ({
  bookToken: vi.fn(),
  getBooking: vi.fn(),
  cancelBooking: vi.fn(),
  fetchDoctor: vi.fn(),
  fetchSessions: vi.fn(),
  auth: { session: null as unknown, loading: false },
}))

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => mocks.auth }))
vi.mock('@/lib/supabase', () => {
  const channel = { on: () => channel, subscribe: () => channel }
  return { supabase: { channel: () => channel, removeChannel: async () => 'ok' } }
})
vi.mock('@/api/bookings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/bookings')>()),
  bookToken: mocks.bookToken,
  getBooking: mocks.getBooking,
  cancelBooking: mocks.cancelBooking,
}))
vi.mock('@/api/public', () => ({
  fetchDoctor: mocks.fetchDoctor,
  fetchSessions: mocks.fetchSessions,
}))

const hospital = {
  id: 'h1',
  name: 'Test Hospital',
  booking_window_days: 1,
  require_patient_age: true,
  cancel_cutoff_minutes: 60,
} as Hospital
vi.mock('@/hooks/useHospital', () => ({
  useHospital: () => ({ data: hospital, isPending: false, isError: false }),
  useToday: () => '2026-10-16',
  useDebounced: <T,>(v: T) => v,
  useNow: () => new Date(),
}))

const { BookPage } = await import('@/pages/public/BookPage')
const { TrackPage } = await import('@/pages/public/TrackPage')
const { env } = await import('@/lib/env')

function Where() {
  const loc = useLocation()
  return <p data-testid="location">{loc.pathname + loc.hash}</p>
}

function renderAt(path: string, routes: { path: string; element: ReactNode }[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter([...routes, { path: '*', element: <Where /> }], {
    initialEntries: [path],
  })
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

const session: SessionRow = {
  shift_id: 'shift-1',
  doctor_id: 'doc-1',
  session_date: '2026-10-16',
  shift_name: 'Morning OPD',
  start_time: '09:00:00',
  end_time: '13:00:00',
  queue_state_id: 'q1',
  session_status: 'OPEN',
  capacity: 40,
  online_capacity: 30,
  issued_count: 12,
  remaining_online: 18,
  bookable: true,
  unavailable_reason: null,
  unavailable_message: null,
  current_token_no: 5,
  next_token_no: 6,
  waiting_count: 3,
  delay_minutes: 0,
  public_note: null,
  booking_fee_paise: 0,
  payment_required: false,
  avg_consult_minutes: 8,
  version: 3,
}

describe('BookPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth = { session: null, loading: false }
    mocks.fetchDoctor.mockResolvedValue({
      id: 'doc-1',
      full_name: 'Dr. Asha Rao',
      specialty: 'General Physician',
      photo_url: null,
    })
    mocks.fetchSessions.mockResolvedValue([
      session,
      {
        ...session,
        shift_id: 'shift-2',
        shift_name: 'Evening OPD',
        bookable: false,
        unavailable_message: 'All tokens for this session have been booked.',
      },
    ])
  })

  it('validates on the client, then books once and opens the confirmation with the key in the fragment', async () => {
    const user = userEvent.setup()
    mocks.bookToken.mockResolvedValue({
      booking_reference: 'MQ-ABCDEFGH',
      access_key: 'f'.repeat(32),
      token_no: 13,
    })
    renderAt('/book/doc-1?shift=shift-1&date=2026-10-16', [
      { path: '/book/:doctorId', element: <BookPage /> },
    ])

    expect(await screen.findByText(/Evening OPD/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Evening OPD/ })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /Morning OPD/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.type(screen.getByLabelText('Patient name'), 'Ravi Kumar')
    await user.type(screen.getByLabelText('Mobile number'), '12345')
    await user.type(screen.getByLabelText('Age'), '41')
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(await screen.findByText(/valid 10-digit Indian mobile/)).toBeInTheDocument()
    expect(screen.getByText(/Please confirm before booking/)).toBeInTheDocument()
    expect(mocks.bookToken).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText('Mobile number'))
    await user.type(screen.getByLabelText('Mobile number'), '+91 98765 43210')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        `/booking/MQ-ABCDEFGH#k=${'f'.repeat(32)}`,
      ),
    )
    expect(mocks.bookToken).toHaveBeenCalledTimes(1)
    expect(mocks.bookToken).toHaveBeenCalledWith(
      expect.objectContaining({
        shiftId: 'shift-1',
        sessionDate: '2026-10-16',
        patientName: 'Ravi Kumar',
        patientPhone: '9876543210',
        patientAge: 41,
      }),
    )
  })

  it('shows the server explanation when the session filled up meanwhile', async () => {
    const user = userEvent.setup()
    mocks.bookToken.mockRejectedValue({
      message: 'MQ_SESSION_UNAVAILABLE',
      hint: 'All tokens for this session have been booked.',
      details: 'FULL',
    })
    renderAt('/book/doc-1?shift=shift-1&date=2026-10-16', [
      { path: '/book/:doctorId', element: <BookPage /> },
    ])
    await screen.findByText(/Morning OPD/)
    await user.type(screen.getByLabelText('Patient name'), 'Ravi Kumar')
    await user.type(screen.getByLabelText('Mobile number'), '9876543210')
    await user.type(screen.getByLabelText('Age'), '41')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(await screen.findByText('Booking not completed')).toBeInTheDocument()
    expect(
      screen.getAllByText('All tokens for this session have been booked.').length,
    ).toBeGreaterThan(0)
  })
})

describe('BookPage with Cloudflare Turnstile (VITE_TURNSTILE_SITE_KEY set)', () => {
  let issueToken = true
  const turnstile = {
    render: vi.fn((_el: HTMLElement, opts: { callback: (token: string) => void }) => {
      const n = turnstile.render.mock.calls.length
      if (issueToken) opts.callback(`turnstile-token-${n}`)
      return `widget-${n}`
    }),
    remove: vi.fn(),
  }
  const result = { booking_reference: 'MQ-ABCDEFGH', access_key: 'f'.repeat(32), token_no: 13 }

  beforeEach(() => {
    vi.clearAllMocks()
    issueToken = true
    mocks.auth = { session: null, loading: false }
    env.VITE_TURNSTILE_SITE_KEY = 'test-site-key'
    window.turnstile = turnstile
    mocks.fetchDoctor.mockResolvedValue({
      id: 'doc-1',
      full_name: 'Dr. Asha Rao',
      specialty: 'General Physician',
      photo_url: null,
    })
    mocks.fetchSessions.mockResolvedValue([session])
  })
  afterEach(() => {
    env.VITE_TURNSTILE_SITE_KEY = null
    delete window.turnstile
  })

  async function fillForm(user: ReturnType<typeof userEvent.setup>) {
    renderAt('/book/doc-1?shift=shift-1&date=2026-10-16', [
      { path: '/book/:doctorId', element: <BookPage /> },
    ])
    await screen.findByText(/Morning OPD/)
    await user.type(screen.getByLabelText('Patient name'), 'Ravi Kumar')
    await user.type(screen.getByLabelText('Mobile number'), '9876543210')
    await user.type(screen.getByLabelText('Age'), '41')
    await user.click(screen.getByRole('checkbox'))
  }

  it('renders the widget for a first booking and passes its token to the anonymous sign-in', async () => {
    const user = userEvent.setup()
    mocks.bookToken.mockResolvedValue(result)
    await fillForm(user)
    expect(turnstile.render).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ sitekey: 'test-site-key', action: 'booking' }),
    )
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/booking/MQ-ABCDEFGH'),
    )
    expect(mocks.bookToken).toHaveBeenCalledWith(
      expect.objectContaining({ captchaToken: 'turnstile-token-1', patientName: 'Ravi Kumar' }),
    )
  })

  it('asks the patient to finish the security check before booking', async () => {
    const user = userEvent.setup()
    issueToken = false
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(await screen.findByText(/complete the security check/)).toBeInTheDocument()
    expect(mocks.bookToken).not.toHaveBeenCalled()
  })

  it('gets a fresh token after a failed attempt, because each token works once', async () => {
    const user = userEvent.setup()
    mocks.bookToken
      .mockRejectedValueOnce({
        message: 'MQ_SESSION_UNAVAILABLE',
        hint: 'All tokens for this session have been booked.',
      })
      .mockResolvedValue(result)
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(await screen.findByText('Booking not completed')).toBeInTheDocument()
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2))
    expect(turnstile.remove).toHaveBeenCalledWith('widget-1')

    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
    await waitFor(() => expect(mocks.bookToken).toHaveBeenCalledTimes(2))
    expect(mocks.bookToken).toHaveBeenLastCalledWith(
      expect.objectContaining({ captchaToken: 'turnstile-token-2' }),
    )
  })

  it('shows no widget to a returning patient who already has a session', async () => {
    const user = userEvent.setup()
    mocks.auth = { session: { user: { id: 'anon-1', is_anonymous: true } }, loading: false }
    mocks.bookToken.mockResolvedValue(result)
    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
    await waitFor(() => expect(mocks.bookToken).toHaveBeenCalledTimes(1))
    expect(mocks.bookToken).toHaveBeenCalledWith(expect.objectContaining({ captchaToken: null }))
    expect(turnstile.render).not.toHaveBeenCalled()
  })
})

const booking: BookingView = {
  booking_reference: 'MQ-ABCDEFGH',
  token_no: 13,
  status: 'CONFIRMED',
  source: 'ONLINE',
  session_date: '2026-10-16',
  created_at: '2026-10-16T03:00:00Z',
  patient_name_masked: 'R*** K****',
  patient_phone_masked: 'XXXXXX3210',
  doctor: {
    id: 'doc-1',
    full_name: 'Dr. Asha Rao',
    specialty: 'General Physician',
    room_no: '101',
    department: 'General Medicine',
  },
  shift: { id: 'shift-1', name: 'Morning OPD', start_time: '09:00:00', end_time: '13:00:00' },
  hospital: {
    name: 'Test Hospital',
    address_line: '1 Road',
    city: 'City',
    state: 'State',
    postal_code: '560001',
    phone: null,
    map_url: null,
    visit_instructions: null,
  },
  fee_paise: 0,
  payment_mode: 'FREE',
  payment: null,
  refund: null,
  hold_expires_at: null,
  cancel_reason: null,
  queue: {
    queue_state_id: 'q1',
    doctor_id: 'doc-1',
    shift_id: 'shift-1',
    session_date: '2026-10-16',
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
    updated_at: '2026-10-16T05:00:00Z',
  },
  patients_ahead: 5,
  estimated_wait_minutes: 40,
  can_cancel: true,
  cancel_block_reason: null,
  notifications: [],
}

describe('TrackPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the token, live queue and masked identity, using the key from the fragment', async () => {
    mocks.getBooking.mockResolvedValue(booking)
    renderAt(`/track/MQ-ABCDEFGH#k=${'a'.repeat(32)}`, [
      { path: '/track/:reference', element: <TrackPage /> },
    ])
    expect(await screen.findByText('13')).toBeInTheDocument()
    expect(mocks.getBooking).toHaveBeenCalledWith('MQ-ABCDEFGH', 'a'.repeat(32))
    expect(screen.getByText('R*** K****')).toBeInTheDocument()
    expect(screen.getByText('XXXXXX3210')).toBeInTheDocument()
    expect(screen.getByText('Now serving').nextSibling).toHaveTextContent('7')
    expect(screen.getByText('Ahead of you').nextSibling).toHaveTextContent('5')
    expect(screen.getByRole('button', { name: 'Cancel this booking' })).toBeInTheDocument()
  })

  it('reveals nothing for an unknown or unauthorized reference', async () => {
    mocks.getBooking.mockResolvedValue(null)
    renderAt('/track/MQ-ABCDEFGH', [{ path: '/track/:reference', element: <TrackPage /> }])
    expect(await screen.findByText('Booking not found')).toBeInTheDocument()
  })

  it('hides cancellation when the policy does not allow it', async () => {
    mocks.getBooking.mockResolvedValue({
      ...booking,
      can_cancel: false,
      cancel_block_reason: 'Online cancellation closes 60 minutes before the OPD starts.',
    })
    renderAt(`/track/MQ-ABCDEFGH#k=${'a'.repeat(32)}`, [
      { path: '/track/:reference', element: <TrackPage /> },
    ])
    expect(await screen.findByText(/Online cancellation closes 60 minutes/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel this booking' })).toBeNull()
  })
})
