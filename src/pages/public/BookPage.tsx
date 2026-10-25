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
import { defineMessages, useT } from '@/i18n'
import { sessionUnavailableText } from '@/i18n/server-text'
import { env } from '@/lib/env'
import { AppError, toAppError } from '@/lib/errors'
import { addDays, formatMoney, formatTimeRange, relativeDayLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SessionRow } from '@/types/database'

const messages = defineMessages({
  en: {
    // validation (the first five come from the shared schemas in @shared/schemas.ts)
    nameRequired: 'Enter the patient’s full name',
    nameTooLong: 'Name is too long',
    nameLettersOnly: 'Use letters only (no numbers or symbols)',
    phoneRequired: 'Enter a mobile number',
    phoneInvalid: 'Enter a valid 10-digit Indian mobile number',
    ageRequired: 'Enter age in years',
    ageInvalid: 'Enter a valid age (0–120)',
    confirmRequired: 'Please confirm before booking',

    captchaRequired: 'Please complete the security check above, then press the button again.',
    paymentsUnavailable:
      'This session requires online payment, which is not available yet. Please contact the reception desk.',
    paymentDismissed:
      'Payment not completed. Your slot is held for a few minutes — you can retry from the tracking page.',
    refundRequired:
      'Payment received, but the slot was no longer available. A refund request has been recorded.',
    doctorNotFound: 'Doctor not found',
    backToProfile: 'Back to profile',
    title: 'Book a token',
    chooseSession: '1. Choose a session',
    windowToday: 'Booking is open for today.',
    windowTomorrow: 'Booking is open for today and tomorrow.',
    loadingSessions: 'Loading sessions',
    noSessions: 'This doctor has no OPD sessions in the booking window.',
    sessionGroup: 'OPD session',
    tokensLeft: '{count} tokens left',
    noneBookable:
      'No session is open for online booking. The reception desk can issue a walk-in token.',
    patientDetails: '2. Patient details',
    patientDetailsNote: 'Only hospital staff can see these details.',
    patientName: 'Patient name',
    mobile: 'Mobile number',
    age: 'Age',
    ageOptional: 'Age (optional)',
    aboutTitle: 'About this booking',
    aboutBody:
      'Your mobile number is not verified by OTP. Please bring a photo ID; the reception desk confirms the patient’s identity at check-in. Anyone with your tracking link can see your token, so share it only with people you trust.',
    agree: 'The details are correct and I agree to the hospital’s booking rules.',
    notCompleted: 'Booking not completed',
    trackExisting: 'Track your existing token',
    retrySafe: 'Pressing “{button}” again is safe — it will not create a second token.',
    openingPayment: 'Opening payment…',
    verifyingPayment: 'Verifying payment…',
    booking: 'Booking…',
    chooseAbove: 'Choose a session above',
    payAndBook: 'Pay {amount} and book',
    confirmBooking: 'Confirm booking',
    feeAtCounter: 'Booking fee {fee} is payable at the hospital counter.',
  },
  hi: {
    nameRequired: 'मरीज़ का पूरा नाम लिखें',
    nameTooLong: 'नाम बहुत लंबा है',
    nameLettersOnly: 'केवल अक्षर लिखें (अंक या चिह्न नहीं)',
    phoneRequired: 'मोबाइल नंबर लिखें',
    phoneInvalid: 'सही 10 अंकों का भारतीय मोबाइल नंबर लिखें',
    ageRequired: 'उम्र सालों में लिखें',
    ageInvalid: 'सही उम्र लिखें (0–120)',
    confirmRequired: 'बुक करने से पहले कृपया पुष्टि करें',

    captchaRequired: 'कृपया ऊपर दी गई सुरक्षा जाँच पूरी करें, फिर बटन दोबारा दबाएँ।',
    paymentsUnavailable:
      'इस सत्र के लिए ऑनलाइन भुगतान ज़रूरी है, जो अभी उपलब्ध नहीं है। कृपया रिसेप्शन डेस्क से संपर्क करें।',
    paymentDismissed:
      'भुगतान पूरा नहीं हुआ। आपका स्लॉट कुछ मिनट के लिए रोका गया है — आप ट्रैकिंग पेज से फिर कोशिश कर सकते हैं।',
    refundRequired:
      'भुगतान मिल गया, लेकिन स्लॉट अब उपलब्ध नहीं था। रिफ़ंड का अनुरोध दर्ज कर लिया गया है।',
    doctorNotFound: 'डॉक्टर नहीं मिले',
    backToProfile: 'प्रोफ़ाइल पर वापस',
    title: 'टोकन बुक करें',
    chooseSession: '1. सत्र चुनें',
    windowToday: 'बुकिंग आज के लिए खुली है।',
    windowTomorrow: 'बुकिंग आज और कल के लिए खुली है।',
    loadingSessions: 'सत्र लोड हो रहे हैं',
    noSessions: 'बुकिंग की अवधि में इन डॉक्टर का कोई ओपीडी सत्र नहीं है।',
    sessionGroup: 'ओपीडी सत्र',
    tokensLeft: '{count} टोकन बाकी',
    noneBookable:
      'कोई भी सत्र ऑनलाइन बुकिंग के लिए खुला नहीं है। रिसेप्शन डेस्क से वॉक-इन टोकन लिया जा सकता है।',
    patientDetails: '2. मरीज़ की जानकारी',
    patientDetailsNote: 'यह जानकारी केवल अस्पताल का स्टाफ़ देख सकता है।',
    patientName: 'मरीज़ का नाम',
    mobile: 'मोबाइल नंबर',
    age: 'उम्र',
    ageOptional: 'उम्र (वैकल्पिक)',
    aboutTitle: 'इस बुकिंग के बारे में',
    aboutBody:
      'आपका मोबाइल नंबर OTP से सत्यापित नहीं किया जाता। कृपया फ़ोटो पहचान पत्र साथ लाएँ; चेक-इन के समय रिसेप्शन डेस्क मरीज़ की पहचान की पुष्टि करता है। जिसके पास भी आपका ट्रैकिंग लिंक होगा, वह आपका टोकन देख सकता है, इसलिए इसे केवल भरोसेमंद लोगों के साथ ही साझा करें।',
    agree: 'जानकारी सही है और मैं अस्पताल के बुकिंग नियमों से सहमत हूँ।',
    notCompleted: 'बुकिंग पूरी नहीं हुई',
    trackExisting: 'अपना मौजूदा टोकन ट्रैक करें',
    retrySafe: '“{button}” दोबारा दबाना सुरक्षित है — इससे दूसरा टोकन नहीं बनेगा।',
    openingPayment: 'भुगतान खुल रहा है…',
    verifyingPayment: 'भुगतान की पुष्टि हो रही है…',
    booking: 'बुक हो रहा है…',
    chooseAbove: 'ऊपर एक सत्र चुनें',
    payAndBook: '{amount} का भुगतान करें और बुक करें',
    confirmBooking: 'बुकिंग पक्की करें',
    feeAtCounter: 'बुकिंग शुल्क {fee} अस्पताल काउंटर पर देना होगा।',
  },
})

type Key = keyof typeof messages.en

// Validation messages arrive in English (the shared schemas are also used by the Edge
// Functions); show the translation of a known message, anything else as it is.
const KEY_BY_ENGLISH = new Map((Object.keys(messages.en) as Key[]).map((k) => [messages.en[k], k]))

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
            ctx.addIssue({ code: 'custom', message: messages.en.ageRequired })
            return z.NEVER
          }
          return null
        }
        const n = Number(s)
        if (!Number.isInteger(n) || n < 0 || n > 120) {
          ctx.addIssue({ code: 'custom', message: messages.en.ageInvalid })
          return z.NEVER
        }
        return n
      }),
    confirm: z.boolean().refine((v) => v, messages.en.confirmRequired),
  })
}

type Phase = 'idle' | 'booking' | 'paying' | 'verifying'

export function BookPage() {
  const t = useT(messages)
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

  const fieldError = (message: string | undefined) => {
    const key = message ? KEY_BY_ENGLISH.get(message) : undefined
    return key ? t(key) : message
  }

  const select = (s: SessionRow) => {
    setError(null)
    setParams({ shift: s.shift_id, date: s.session_date }, { replace: true })
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (!selected || !hospital) return
    setError(null)
    if (captcha.missing) {
      setError(new AppError('CAPTCHA_REQUIRED', t('captchaRequired')))
      return
    }
    const captchaToken = captcha.token
    try {
      if (selected.payment_required) {
        if (!env.VITE_PAYMENTS_ENABLED) {
          throw new AppError('PAYMENTS_DISABLED', t('paymentsUnavailable'))
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
              toast.info(t('paymentDismissed'))
              navigate(`/booking/${ref}#k=${key}`)
              return
            }
            throw err
          }
          setPhase('verifying')
          const result = await verifyPayment(checkout)
          if (result.outcome === 'REFUND_REQUIRED') {
            toast.warning(t('refundRequired'))
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
  if (!doctor.data) return <EmptyState title={t('doctorNotFound')} />

  const busy = phase !== 'idle'
  const errors = form.formState.errors

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={`/doctors/${doctorId}`}>
          <ArrowLeft /> {t('backToProfile')}
        </Link>
      </Button>

      <div className="flex items-center gap-3">
        <DoctorAvatar
          name={doctor.data.full_name}
          photoUrl={doctor.data.photo_url}
          className="size-12"
        />
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">
            {doctor.data.full_name} · {doctor.data.specialty}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('chooseSession')}</CardTitle>
          <CardDescription>
            {hospital.booking_window_days > 0 ? t('windowTomorrow') : t('windowToday')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sessions.isPending ? (
            <PageSpinner label={t('loadingSessions')} />
          ) : sessions.isError ? (
            <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
          ) : (sessions.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noSessions')}</p>
          ) : (
            <div role="radiogroup" aria-label={t('sessionGroup')} className="grid gap-2">
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
                          ? ` · ${t('tokensLeft', { count: s.remaining_online })}`
                          : ` · ${sessionUnavailableText(s.unavailable_reason, s.unavailable_message)}`}
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
            <p className="mt-3 text-sm text-muted-foreground">{t('noneBookable')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('patientDetails')}</CardTitle>
          <CardDescription>{t('patientDetailsNote')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="patient_name">{t('patientName')}</Label>
              <Input
                id="patient_name"
                autoComplete="name"
                aria-invalid={!!errors.patient_name}
                {...form.register('patient_name')}
              />
              {errors.patient_name && (
                <p className="text-sm text-destructive">
                  {fieldError(errors.patient_name.message)}
                </p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="patient_phone">{t('mobile')}</Label>
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
                  <p className="text-sm text-destructive">
                    {fieldError(errors.patient_phone.message)}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="patient_age">
                  {hospital.require_patient_age ? t('age') : t('ageOptional')}
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
                  <p className="text-sm text-destructive">
                    {fieldError(errors.patient_age.message)}
                  </p>
                )}
              </div>
            </div>

            <Alert>
              <ShieldCheck aria-hidden />
              <AlertTitle>{t('aboutTitle')}</AlertTitle>
              <AlertDescription>
                <p>{t('aboutBody')}</p>
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
                {t('agree')}
              </Label>
            </div>
            {errors.confirm && (
              <p className="text-sm text-destructive">{fieldError(errors.confirm.message)}</p>
            )}

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
                <AlertTitle>{t('notCompleted')}</AlertTitle>
                <AlertDescription>
                  <p>{error.message}</p>
                  {error.code === 'MQ_DUPLICATE_BOOKING' && (
                    <Link to="/track" className="font-medium underline">
                      {t('trackExisting')}
                    </Link>
                  )}
                  {error.code === 'NETWORK' && (
                    <p>{t('retrySafe', { button: t('confirmBooking') })}</p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              size="lg"
              variant="cta"
              className="w-full"
              disabled={!selected || !selected.bookable || busy}
            >
              {busy && <Loader2 className="animate-spin" />}
              {phase === 'paying'
                ? t('openingPayment')
                : phase === 'verifying'
                  ? t('verifyingPayment')
                  : phase === 'booking'
                    ? t('booking')
                    : !selected
                      ? t('chooseAbove')
                      : selected.payment_required
                        ? t('payAndBook', { amount: formatMoney(selected.booking_fee_paise) })
                        : t('confirmBooking')}
            </Button>
            {selected && selected.booking_fee_paise > 0 && !selected.payment_required && (
              <p className="text-center text-sm text-muted-foreground">
                {t('feeAtCounter', { fee: formatMoney(selected.booking_fee_paise) })}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
