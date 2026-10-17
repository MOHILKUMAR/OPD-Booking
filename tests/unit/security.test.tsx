// Turnstile token plumbing for the anonymous sign-in, and staff two-factor authentication (TOTP).
// supabase-js is replaced by a small fake that keeps one session and notifies auth listeners,
// so AuthProvider, the login page and RequireStaff run unmodified.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Hospital } from '@/types/database'

interface FakeSession {
  access_token: string
  aal: 'aal1' | 'aal2'
  user: {
    id: string
    email: string
    is_anonymous: boolean
    factors: { id: string; factor_type: 'totp'; status: 'verified' | 'unverified' }[]
  }
}

const h = vi.hoisted(() => {
  type Listener = (event: string, session: unknown) => void
  const listeners = new Set<Listener>()
  const state: { session: unknown; roles: unknown[] } = { session: null, roles: [] }
  const emit = (event: string, session: unknown) => {
    state.session = session
    listeners.forEach((cb) => cb(event, session))
  }
  return {
    state,
    emit,
    invokeFunction: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session }, error: null })),
      onAuthStateChange: vi.fn((cb: Listener) => {
        listeners.add(cb)
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
      }),
      signInAnonymously: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(async () => {
        emit('SIGNED_OUT', null)
        return { error: null }
      }),
      refreshSession: vi.fn(async () => ({ data: {}, error: null })),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(),
        listFactors: vi.fn(),
        enroll: vi.fn(),
        challenge: vi.fn(),
        verify: vi.fn(),
        unenroll: vi.fn(),
      },
    },
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: h.auth,
    rpc: h.rpc,
    from: () => ({ select: () => ({ eq: async () => ({ data: h.state.roles, error: null }) }) }),
  },
}))
vi.mock('@/api/functions', () => ({ invokeFunction: h.invokeFunction }))
vi.mock('@/hooks/useHospital', () => ({
  useHospital: () => ({ data: { id: 'h1', name: 'Test Hospital' } as Hospital }),
  useToday: () => '2026-10-16',
  useDebounced: <T,>(v: T) => v,
  useNow: () => new Date(),
}))

const { bookToken, ensurePatientSession } = await import('@/api/bookings')
const { createPaymentOrder } = await import('@/api/payments')
const { AuthProvider } = await import('@/auth/AuthProvider')
const { RequireStaff } = await import('@/auth/RequireStaff')
const { TwoFactorButton } = await import('@/components/layout/TwoFactorButton')
const { default: StaffLoginPage } = await import('@/pages/staff/StaffLoginPage')
const { env } = await import('@/lib/env')

function staffSession(
  aal: 'aal1' | 'aal2',
  factors: FakeSession['user']['factors'] = [],
): FakeSession {
  return {
    access_token: `token-${aal}-${Math.random()}`,
    aal,
    user: { id: 'u1', email: 'admin@hospital.test', is_anonymous: false, factors },
  }
}
const verifiedFactor = { id: 'f1', factor_type: 'totp' as const, status: 'verified' as const }

beforeEach(() => {
  vi.clearAllMocks()
  h.state.session = null
  h.state.roles = [{ id: 'r1', user_id: 'u1', hospital_id: 'h1', role: 'admin', doctor_id: null }]
  // Same rule as supabase-js: next level is aal2 once the user has a verified factor.
  h.auth.mfa.getAuthenticatorAssuranceLevel.mockImplementation(async () => {
    const s = h.state.session as FakeSession | null
    const current = s?.aal ?? null
    const next = s?.user.factors.some((f) => f.status === 'verified') ? 'aal2' : current
    return { data: { currentLevel: current, nextLevel: next }, error: null }
  })
  h.auth.signInAnonymously.mockResolvedValue({ data: {}, error: null })
  h.auth.mfa.challenge.mockResolvedValue({ data: { id: 'c1' }, error: null })
  h.auth.mfa.unenroll.mockResolvedValue({ data: {}, error: null })
})

describe('Turnstile token on the anonymous sign-in', () => {
  it('signs in exactly as before when there is no token (VITE_TURNSTILE_SITE_KEY unset)', async () => {
    await ensurePatientSession()
    await ensurePatientSession(null)
    expect(h.auth.signInAnonymously).toHaveBeenCalledTimes(2)
    expect(h.auth.signInAnonymously).toHaveBeenNthCalledWith(1)
    expect(h.auth.signInAnonymously).toHaveBeenNthCalledWith(2)
  })

  it('passes the token as captchaToken', async () => {
    await ensurePatientSession('turnstile-token')
    expect(h.auth.signInAnonymously).toHaveBeenCalledWith({
      options: { captchaToken: 'turnstile-token' },
    })
  })

  it('does not sign in again when the device already has a session', async () => {
    h.state.session = { user: { id: 'anon', is_anonymous: true } }
    await ensurePatientSession('turnstile-token')
    expect(h.auth.signInAnonymously).not.toHaveBeenCalled()
  })

  it('explains a rejected or expired security check', async () => {
    h.auth.signInAnonymously.mockResolvedValue({
      data: {},
      error: { code: 'captcha_failed', message: 'captcha protection: request disallowed' },
    })
    await expect(ensurePatientSession('stale-token')).rejects.toMatchObject({
      code: 'CAPTCHA_FAILED',
    })
  })

  it('bookToken uses the token for the sign-in only, never in the booking RPC', async () => {
    h.rpc.mockResolvedValue({ data: { booking_reference: 'MQ-ABCDEFGH' }, error: null })
    await bookToken({
      shiftId: 's1',
      sessionDate: '2026-10-16',
      patientName: 'Ravi Kumar',
      patientPhone: '9876543210',
      patientAge: 41,
      requestId: 'req-1',
      captchaToken: 'turnstile-token',
    })
    expect(h.auth.signInAnonymously).toHaveBeenCalledWith({
      options: { captchaToken: 'turnstile-token' },
    })
    expect(JSON.stringify(h.rpc.mock.calls[0])).not.toContain('turnstile-token')
  })

  it('the payment path signs in with the token and keeps it out of the Edge Function body', async () => {
    h.invokeFunction.mockResolvedValue({ status: 'ORDER_CREATED' })
    await createPaymentOrder({
      shift_id: 's1',
      session_date: '2026-10-16',
      patient_name: 'Ravi Kumar',
      patient_phone: '9876543210',
      patient_age: 41,
      idempotency_key: 'req-1',
      captchaToken: 'turnstile-token',
    })
    expect(h.auth.signInAnonymously).toHaveBeenCalledWith({
      options: { captchaToken: 'turnstile-token' },
    })
    expect(h.invokeFunction).toHaveBeenCalledWith('payments-create-order', {
      shift_id: 's1',
      session_date: '2026-10-16',
      patient_name: 'Ravi Kumar',
      patient_phone: '9876543210',
      patient_age: 41,
      idempotency_key: 'req-1',
    })
  })
})

function Where() {
  const loc = useLocation()
  return <p data-testid="location">{loc.pathname + loc.search}</p>
}

function renderApp(path: string, extra: { path: string; element: ReactNode }[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/staff/login', element: <StaffLoginPage /> },
      {
        path: '/admin',
        element: (
          <RequireStaff roles={['admin']}>
            <p>Admin dashboard</p>
          </RequireStaff>
        ),
      },
      ...extra,
      { path: '*', element: <Where /> },
    ],
    { initialEntries: [path] },
  )
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

async function signInWithPassword(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Email'), 'admin@hospital.test')
  await user.type(screen.getByLabelText('Password'), 'correct horse battery')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('staff sign-in with two-factor authentication', () => {
  it('asks for the authenticator code after the password (aal1 → aal2) before opening admin pages', async () => {
    const user = userEvent.setup()
    h.auth.signInWithPassword.mockImplementation(async () => {
      h.emit('SIGNED_IN', staffSession('aal1', [verifiedFactor]))
      return { data: {}, error: null }
    })
    h.auth.mfa.listFactors.mockResolvedValue({ data: { all: [verifiedFactor] }, error: null })
    h.auth.mfa.verify.mockImplementation(async () => {
      h.emit('MFA_CHALLENGE_VERIFIED', staffSession('aal2', [verifiedFactor]))
      return { data: {}, error: null }
    })

    renderApp('/admin')
    await signInWithPassword(user)

    expect(await screen.findByRole('textbox', { name: 'Authentication code' })).toBeInTheDocument()
    expect(screen.queryByText('Admin dashboard')).toBeNull()

    await user.type(screen.getByLabelText('Authentication code'), '123 456')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument()
    expect(h.auth.mfa.challenge).toHaveBeenCalledWith({ factorId: 'f1' })
    expect(h.auth.mfa.verify).toHaveBeenCalledWith({
      factorId: 'f1',
      challengeId: 'c1',
      code: '123456',
    })
  })

  it('stays on the code step when the code is wrong', async () => {
    const user = userEvent.setup()
    h.state.session = staffSession('aal1', [verifiedFactor])
    h.auth.mfa.listFactors.mockResolvedValue({ data: { all: [verifiedFactor] }, error: null })
    h.auth.mfa.verify.mockResolvedValue({
      data: null,
      error: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' },
    })

    renderApp('/staff/login?next=%2Fadmin')
    await user.type(await screen.findByLabelText('Authentication code'), '000000')
    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText(/That code is not correct/)).toBeInTheDocument()
    expect(screen.getByLabelText('Authentication code')).toHaveValue('')
    expect(screen.queryByText('Admin dashboard')).toBeNull()
  })

  it('sends a password-only session of an enrolled account back to the code step', async () => {
    h.state.session = staffSession('aal1', [verifiedFactor])
    renderApp('/admin')
    expect(await screen.findByLabelText('Authentication code')).toBeInTheDocument()
    expect(screen.queryByText('Admin dashboard')).toBeNull()
  })

  it('does not ask for a code when the account has no authenticator app', async () => {
    const user = userEvent.setup()
    h.auth.signInWithPassword.mockImplementation(async () => {
      h.emit('SIGNED_IN', staffSession('aal1'))
      return { data: {}, error: null }
    })
    renderApp('/admin')
    await signInWithPassword(user)
    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument()
    expect(h.auth.mfa.verify).not.toHaveBeenCalled()
    // No CAPTCHA configured: the call is exactly what it was before Turnstile support.
    expect(h.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@hospital.test',
      password: 'correct horse battery',
    })
  })

  it('sends the Turnstile token with the password when CAPTCHA is configured', async () => {
    const user = userEvent.setup()
    env.VITE_TURNSTILE_SITE_KEY = 'test-site-key'
    window.turnstile = {
      render: (_el, opts) => {
        opts.callback('staff-turnstile-token')
        return 'w1'
      },
      remove: () => {},
    }
    h.auth.signInWithPassword.mockImplementation(async () => {
      h.emit('SIGNED_IN', staffSession('aal1'))
      return { data: {}, error: null }
    })
    try {
      renderApp('/admin')
      await signInWithPassword(user)
      expect(await screen.findByText('Admin dashboard')).toBeInTheDocument()
      expect(h.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'admin@hospital.test',
        password: 'correct horse battery',
        options: { captchaToken: 'staff-turnstile-token' },
      })
    } finally {
      env.VITE_TURNSTILE_SITE_KEY = null
      delete window.turnstile
    }
  })
})

describe('Two-factor authentication dialog', () => {
  function renderDialog() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TwoFactorButton />
        </AuthProvider>
      </QueryClientProvider>,
    )
  }

  it('enrols an authenticator app: shows the QR code and key, then verifies a code', async () => {
    const user = userEvent.setup()
    h.state.session = staffSession('aal1')
    const leftover = { id: 'old', factor_type: 'totp', status: 'unverified' }
    const added = { id: 'f-new', factor_type: 'totp', status: 'verified', created_at: '2026-10-16' }
    h.auth.mfa.listFactors
      .mockResolvedValueOnce({ data: { all: [] }, error: null }) // dialog opens
      .mockResolvedValueOnce({ data: { all: [leftover] }, error: null }) // enrol clean-up
      .mockResolvedValue({ data: { all: [added] }, error: null }) // after verify
    h.auth.mfa.enroll.mockResolvedValue({
      data: {
        id: 'f-new',
        type: 'totp',
        totp: {
          qr_code: 'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg"/>',
          secret: 'JBSWY3DPEHPK3PXP',
          uri: 'otpauth://totp/MediQueue:admin@hospital.test?secret=JBSWY3DPEHPK3PXP',
        },
      },
      error: null,
    })
    h.auth.mfa.verify.mockResolvedValue({ data: {}, error: null })

    renderDialog()
    await user.click(screen.getByRole('button', { name: /2FA/ }))
    expect(await screen.findByText(/is off for your account/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Set up authenticator app' }))

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    expect(screen.getByAltText('QR code for your authenticator app')).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/svg\+xml/),
    )
    expect(h.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'old' })
    expect(h.auth.mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }))

    await user.type(screen.getByLabelText(/Enter the 6-digit code/), '654321')
    await user.click(screen.getByRole('button', { name: 'Verify and turn on' }))

    expect(await screen.findByText('Two-factor authentication is on')).toBeInTheDocument()
    expect(h.auth.mfa.challenge).toHaveBeenCalledWith({ factorId: 'f-new' })
    expect(h.auth.mfa.verify).toHaveBeenCalledWith({
      factorId: 'f-new',
      challengeId: 'c1',
      code: '654321',
    })
  })

  it('removes an authenticator app after confirmation', async () => {
    const user = userEvent.setup()
    h.state.session = staffSession('aal2', [verifiedFactor])
    h.auth.mfa.listFactors
      .mockResolvedValueOnce({
        data: { all: [{ ...verifiedFactor, created_at: '2026-10-01' }] },
        error: null,
      })
      .mockResolvedValue({ data: { all: [] }, error: null })

    renderDialog()
    await user.click(screen.getByRole('button', { name: /2FA/ }))
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: /Yes, remove/ }))

    expect(await screen.findByText(/is off for your account/)).toBeInTheDocument()
    expect(h.auth.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f1' })
    expect(h.auth.refreshSession).toHaveBeenCalled()
  })
})
