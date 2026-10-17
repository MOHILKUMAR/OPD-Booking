import { zodResolver } from '@hookform/resolvers/zod'
import { patientNameSchema, patientPhoneSchema } from '@shared/schemas.ts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, ArrowLeft, Loader2, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { bookToken } from '@/api/bookings'
import { createPaymentOrder, openCheckout, verifyPayment } from '@/api/payments'
import { fetchDoctor, fetchSessions } from '@/api/public'
import { useAuth } from '@/auth/AuthProvider'
import { DoctorAvatar } from '@/components/doctor'
import { SessionStatusBadge } from '@/components/badges'
import { EmptyState, ErrorState, PageSpinner } from '@/components/states'
import { Turnstile } from '@/components/turnstile'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useHospital, useToday } from '@/hooks/useHospital'
import { useTurnstile } from '@/hooks/useTurnstile'
import { env } from '@/lib/env'
import { AppError, toAppError } from '@/lib/errors'
import { addDays, formatMoney, formatTimeRange, relativeDayLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SessionRow } from '@/types/database'

function makeSchema(requireAge: boolean) {
  return z.object({
    patient_name: patientNameSchema,
    patient_phone: patientPhoneSchema,
    patient_age: z
      .string()
      .trim()
      .transform((s, ctx) => {
        if (!s) {
          if (requireAge) {
            ctx.addIssue({ code: 'custom', message: 'Enter age in years' })
            return z.NEVER
          }
          return null
        }
        const n = Number(s)
        if (!Number.isInteger(n) || n < 0 || n > 120) {
          ctx.addIssue({ code: 'custom', message: 'Enter a valid age (0–120)' })
          return z.NEVER
        }
        return n
      }),
    confirm: z.boolean().refine((v) => v, 'Please confirm before booking'),
  })
}

type Phase = 'idle' | 'booking' | 'paying' | 'verifying'

export function BookPage() {
  const { doctorId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const auth = useAuth()
  const { data: hospital } = useHospital()
  const today = useToday()
  const lastDay = addDays(today, hospital?.booking_window_days ?? 1)

  const doctor = useQuery({ queryKey: ['doctor', doctorId], queryFn: () => fetchDoctor(doctorId) })
  const sessions = useQuery({
    queryKey: ['sessions', hospital?.id, doctorId, today, lastDay],
    queryFn: () => fetchSessions(hospital!.id, today, lastDay, [doctorId]),
    enabled: !!hospital,
    refetchInterval: 30_000,
  })

  const selectedKey = `${params.get('shift') ?? ''}|${params.get('date') ?? ''}`
  const selected =
    sessions.data?.find((s) => `${s.shift_id}|${s.session_date}` === selectedKey) ?? null
  const bookable = useMemo(() => (sessions.data ?? []).filter((s) => s.bookable), [sessions.data])

  const schema = useMemo(
    () => makeSchema(hospital?.require_patient_age ?? true),
    [hospital?.require_patient_age],
  )
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { patient_name: '', patient_phone: '', patient_age: '', confirm: false },
    mode: 'onTouched',
  })

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<AppError | null>(null)
  // One id per booking attempt. It is kept after a network error (unknown outcome) so a retry
  // returns the original booking instead of creating a second token, and renewed otherwise.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  // Turnstile is needed only for the first booking on a device, when the anonymous session is
  // created (and only when VITE_TURNSTILE_SITE_KEY is set).
  const captcha = useTurnstile(!auth.loading && !auth.session)

  const select = (s: SessionRow) => {
    setError(null)
    setParams({ shift: s.shift_id, date: s.session_date }, { replace: true })
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (!selected || !hospital) return
    setError(null)
    if (captcha.missing) {
      setError(
        new AppError(
          'CAPTCHA_REQUIRED',
          'Please complete the security check above, then press the button again.',
        ),
      )
      return
    }
    const captchaToken = captcha.token
    try {
      if (selected.payment_required) {
        if (!env.VITE_PAYMENTS_ENABLED) {
          throw new AppError(
            'PAYMENTS_DISABLED',
            'This session requires online payment, which is not available yet. Please contact the reception desk.',
          )
        }
        setPhase('paying')
        const order = await createPaymentOrder({
          shift_id: selected.shift_id,
          session_date: selected.session_date,
          patient_name: values.patient_name,
          patient_phone: values.patient_phone,
          patient_age: values.patient_age,
          idempotency_key: requestId,
          captchaToken,
        })
        const ref = order.booking.booking_reference
        const key = order.booking.access_key
        if (order.status !== 'ALREADY_PAID') {
          let checkout
          try {
            checkout = await openCheckout(order, hospital.name, {
              name: values.patient_name,
              contact: values.patient_phone,
            })
          } catch (err) {
            if ((err as Error).message === 'CHECKOUT_DISMISSED') {
              toast.info(
                'Payment not completed. Your slot is held for a few minutes — you can retry from the tracking page.',
              )
              navigate(`/booking/${ref}#k=${key}`)
              return
            }
            throw err
          }
          setPhase('verifying')
          const result = await verifyPayment(checkout)
          if (result.outcome === 'REFUND_REQUIRED') {
            toast.warning(
              'Payment received, but the slot was no longer available. A refund request has been recorded.',
            )
          }
        }
        setRequestId(crypto.randomUUID())
        void queryClient.invalidateQueries({ queryKey: ['sessions'] })
        navigate(`/booking/${ref}#k=${key}`)
        return
      }

      setPhase('booking')
      const res = await bookToken({
        shiftId: selected.shift_id,
        sessionDate: selected.session_date,
        patientName: values.patient_name,
        patientPhone: values.patient_phone,
        patientAge: values.patient_age,
        requestId,
        captchaToken,
      })
      setRequestId(crypto.randomUUID())
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })
      // The secret key travels only in the URL fragment, which browsers never send to servers.
      navigate(`/booking/${res.booking_reference}#k=${res.access_key}`)
    } catch (err) {
      const appErr = toAppError(err)
      if (appErr.code !== 'NETWORK') setRequestId(crypto.randomUUID())
      if (captchaToken) captcha.renew()
      setError(appErr)
      if (appErr.code === 'MQ_SESSION_UNAVAILABLE') void sessions.refetch()
    } finally {
      setPhase('idle')
    }
  })

  if (doctor.isPending || !hospital) return <PageSpinner />
  if (doctor.isError) return <ErrorState error={doctor.error} onRetry={() => doctor.refetch()} />
  if (!doctor.data) return <EmptyState title="Doctor not found" />

  const busy = phase !== 'idle'
  const errors = form.formState.errors

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={`/doctors/${doctorId}`}>
          <ArrowLeft /> Back to profile
        </Link>
      </Button>

      <div className="flex items-center gap-3">
        <DoctorAvatar
          name={doctor.data.full_name}
          photoUrl={doctor.data.photo_url}
          className="size-12"
        />
        <div>
          <h1 className="text-xl font-semibold">Book a token</h1>
          <p className="text-sm text-muted-foreground">
            {doctor.data.full_name} · {doctor.data.specialty}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Choose a session</CardTitle>
          <CardDescription>
            Booking is open for today{hospital.booking_window_days > 0 ? ' and tomorrow' : ''}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.isPending ? (
            <PageSpinner label="Loading sessions" />
          ) : sessions.isError ? (
            <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
          ) : (sessions.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This doctor has no OPD sessions in the booking window.
            </p>
          ) : (
            <div role="radiogroup" aria-label="OPD session" className="grid gap-2">
              {sessions.data!.map((s) => {
                const key = `${s.shift_id}|${s.session_date}`
                const isSelected = key === selectedKey
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={!s.bookable}
                    onClick={() => select(s)}
                    className={cn(
                      'flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between',
                      isSelected
                        ? 'border-primary bg-accent ring-2 ring-primary/30'
                        : 'hover:bg-muted/60',
                    )}
                  >
                    <span>
                      <span className="font-medium">
                        {relativeDayLabel(s.session_date, today)} · {s.shift_name}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {formatTimeRange(s.start_time, s.end_time)}
                        {s.bookable
                          ? ` · ${s.remaining_online} tokens left`
                          : ` · ${s.unavailable_message}`}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {s.booking_fee_paise > 0 && (
                        <span className="text-sm">{formatMoney(s.booking_fee_paise)}</span>
                      )}
                      <SessionStatusBadge status={s.session_status} />
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {bookable.length === 0 && sessions.data && sessions.data.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              No session is open for online booking. The reception desk can issue a walk-in token.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Patient details</CardTitle>
          <CardDescription>Only hospital staff can see these details.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="patient_name">Patient name</Label>
              <Input
                id="patient_name"
                autoComplete="name"
                aria-invalid={!!errors.patient_name}
                {...form.register('patient_name')}
              />
              {errors.patient_name && (
                <p className="text-sm text-destructive">{errors.patient_name.message}</p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="patient_phone">Mobile number</Label>
                <Input
                  id="patient_phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="98765 43210"
                  aria-invalid={!!errors.patient_phone}
                  {...form.register('patient_phone')}
                />
                {errors.patient_phone && (
                  <p className="text-sm text-destructive">{errors.patient_phone.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="patient_age">
                  Age{hospital.require_patient_age ? '' : ' (optional)'}
                </Label>
                <Input
                  id="patient_age"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={120}
                  aria-invalid={!!errors.patient_age}
                  {...form.register('patient_age')}
                />
                {errors.patient_age && (
                  <p className="text-sm text-destructive">{errors.patient_age.message}</p>
                )}
              </div>
            </div>

            <Alert>
              <ShieldCheck aria-hidden />
              <AlertTitle>About this booking</AlertTitle>
              <AlertDescription>
                <p>
                  Your mobile number is not verified by OTP. Please bring a photo ID; the reception
                  desk confirms the patient’s identity at check-in. Anyone with your tracking link
                  can see your token, so share it only with people you trust.
                </p>
              </AlertDescription>
            </Alert>

            <div className="flex items-start gap-2">
              <Controller
                control={form.control}
                name="confirm"
                render={({ field }) => (
                  <Checkbox
                    id="confirm"
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(v === true)}
                    aria-invalid={!!errors.confirm}
                  />
                )}
              />
              <Label htmlFor="confirm" className="leading-snug font-normal">
                The details are correct and I agree to the hospital’s booking rules.
              </Label>
            </div>
            {errors.confirm && <p className="text-sm text-destructive">{errors.confirm.message}</p>}

            {captcha.siteKey && (
              <Turnstile
                key={captcha.round}
                siteKey={captcha.siteKey}
                action="booking"
                onToken={captcha.setToken}
              />
            )}

            {error && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertTitle>Booking not completed</AlertTitle>
                <AlertDescription>
                  <p>{error.message}</p>
                  {error.code === 'MQ_DUPLICATE_BOOKING' && (
                    <Link to="/track" className="font-medium underline">
                      Track your existing token
                    </Link>
                  )}
                  {error.code === 'NETWORK' && (
                    <p>
                      Pressing “Confirm booking” again is safe — it will not create a second token.
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={!selected || !selected.bookable || busy}
            >
              {busy && <Loader2 className="animate-spin" />}
              {phase === 'paying'
                ? 'Opening payment…'
                : phase === 'verifying'
                  ? 'Verifying payment…'
                  : phase === 'booking'
                    ? 'Booking…'
                    : !selected
                      ? 'Choose a session above'
                      : selected.payment_required
                        ? `Pay ${formatMoney(selected.booking_fee_paise)} and book`
                        : 'Confirm booking'}
            </Button>
            {selected && selected.booking_fee_paise > 0 && !selected.payment_required && (
              <p className="text-center text-sm text-muted-foreground">
                Booking fee {formatMoney(selected.booking_fee_paise)} is payable at the hospital
                counter.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
