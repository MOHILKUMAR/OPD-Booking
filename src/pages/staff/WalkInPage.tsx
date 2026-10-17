import { zodResolver } from '@hookform/resolvers/zod'
import { patientNameSchema, patientPhoneSchema } from '@shared/schemas.ts'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Printer } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { fetchSessions } from '@/api/public'
import { createWalkin } from '@/api/staff'
import { SessionStatusBadge } from '@/components/badges'
import { EmptyState, ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToday } from '@/hooks/useHospital'
import { useStaffScope } from '@/hooks/useStaffScope'
import { defineMessages, useT } from '@/i18n'
import { toAppError } from '@/lib/errors'
import { formatDate, formatTimeRange } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { BookingResult } from '@/types/database'

const messages = defineMessages({
  en: {
    title: 'Walk-in token',
    description: 'Issue a token for a patient at the desk. Walk-ins are checked in immediately.',
    noSession: 'No session available for walk-ins today',
    patient: 'Patient',
    session: 'Session',
    tokensLeft: '{count} tokens left',
    patientName: 'Patient name',
    mobile: 'Mobile',
    age: 'Age',
    issue: 'Issue token',
    issued: 'Token issued',
    printSlip: 'Print slip',
    chooseSession: 'Choose a session',
    // Validation: the English text must equal the messages in @shared/schemas.ts.
    nameRequired: 'Enter the patient’s full name',
    nameTooLong: 'Name is too long',
    nameLetters: 'Use letters only (no numbers or symbols)',
    phoneRequired: 'Enter a mobile number',
    phoneInvalid: 'Enter a valid 10-digit Indian mobile number',
    ageInvalid: 'Enter a valid age (0–120)',
  },
  hi: {
    title: 'वॉक-इन टोकन',
    description:
      'डेस्क पर आए मरीज़ के लिए टोकन जारी करें। वॉक-इन मरीज़ों का चेक-इन तुरंत हो जाता है।',
    noSession: 'आज वॉक-इन के लिए कोई सत्र उपलब्ध नहीं है',
    patient: 'मरीज़',
    session: 'सत्र',
    tokensLeft: '{count} टोकन बाकी',
    patientName: 'मरीज़ का नाम',
    mobile: 'मोबाइल',
    age: 'उम्र',
    issue: 'टोकन जारी करें',
    issued: 'टोकन जारी हुआ',
    printSlip: 'पर्ची प्रिंट करें',
    chooseSession: 'सत्र चुनें',
    nameRequired: 'मरीज़ का पूरा नाम लिखें',
    nameTooLong: 'नाम बहुत लंबा है',
    nameLetters: 'केवल अक्षर लिखें (अंक या चिह्न नहीं)',
    phoneRequired: 'मोबाइल नंबर लिखें',
    phoneInvalid: 'सही 10 अंकों का भारतीय मोबाइल नंबर लिखें',
    ageInvalid: 'सही उम्र लिखें (0–120)',
  },
})
type Key = keyof typeof messages.en

const VALIDATION_KEYS: Key[] = [
  'nameRequired',
  'nameTooLong',
  'nameLetters',
  'phoneRequired',
  'phoneInvalid',
  'ageInvalid',
]

const schema = z.object({
  patient_name: patientNameSchema,
  patient_phone: patientPhoneSchema,
  patient_age: z
    .string()
    .trim()
    .transform((s, ctx) => {
      if (!s) return null
      const n = Number(s)
      if (!Number.isInteger(n) || n < 0 || n > 120) {
        ctx.addIssue({ code: 'custom', message: messages.en.ageInvalid })
        return z.NEVER
      }
      return n
    }),
})

export default function WalkInPage() {
  const scope = useStaffScope()
  const today = useToday()
  const queryClient = useQueryClient()
  const t = useT(messages)
  const deskDoctors = scope.doctors.filter((d) => {
    const r = scope.rolesFor(d.id)
    return r.includes('admin') || r.includes('receptionist')
  })
  const ids = deskDoctors.map((d) => d.id)
  const sessions = useQuery({
    queryKey: ['staff-sessions', scope.hospital?.id, today, ids.join(',')],
    queryFn: () => fetchSessions(scope.hospital!.id, today, today, ids),
    enabled: !!scope.hospital && ids.length > 0,
    refetchInterval: 30_000,
  })
  const open = (sessions.data ?? []).filter(
    (s) =>
      s.unavailable_reason !== 'NOT_SCHEDULED' &&
      s.session_status !== 'CLOSED' &&
      s.session_status !== 'CANCELLED',
  )
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [issued, setIssued] = useState<BookingResult | null>(null)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { patient_name: '', patient_phone: '', patient_age: '' },
  })
  const errors = form.formState.errors
  // The shared schemas give English text; show the translation when we know the message.
  const fieldError = (message?: string) => {
    const key = VALIDATION_KEYS.find((k) => messages.en[k] === message)
    return key ? t(key) : message
  }

  const onSubmit = form.handleSubmit(async (v) => {
    if (!shiftId) return toast.error(t('chooseSession'))
    try {
      const res = await createWalkin({
        shiftId,
        patientName: v.patient_name,
        patientPhone: v.patient_phone,
        patientAge: v.patient_age,
        requestId,
      })
      setIssued(res)
      setRequestId(crypto.randomUUID())
      form.reset()
      void queryClient.invalidateQueries({ queryKey: ['staff-sessions'] })
      void queryClient.invalidateQueries({ queryKey: ['queue'] })
    } catch (err) {
      const e = toAppError(err)
      if (e.code !== 'NETWORK') setRequestId(crypto.randomUUID())
      toast.error(e.message)
    }
  })

  if (scope.doctorsQuery.isPending || sessions.isPending) return <PageSpinner />
  if (sessions.isError)
    return <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      {open.length === 0 ? (
        <EmptyState title={t('noSession')} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('patient')}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-medium">{t('session')}</legend>
                  {open.map((s) => {
                    const doc = deskDoctors.find((d) => d.id === s.doctor_id)
                    const left = s.capacity - s.issued_count
                    return (
                      <label
                        key={s.shift_id}
                        className={cn(
                          'flex cursor-pointer items-center justify-between gap-2 rounded-lg border p-3',
                          shiftId === s.shift_id && 'border-primary bg-accent',
                          left <= 0 && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="shift"
                            value={s.shift_id}
                            disabled={left <= 0}
                            checked={shiftId === s.shift_id}
                            onChange={() => setShiftId(s.shift_id)}
                          />
                          <span>
                            <span className="font-medium">{doc?.full_name}</span>
                            <span className="block text-sm text-muted-foreground">
                              {s.shift_name}, {formatTimeRange(s.start_time, s.end_time)} ·{' '}
                              {t('tokensLeft', { count: Math.max(left, 0) })}
                            </span>
                          </span>
                        </span>
                        <SessionStatusBadge status={s.session_status} />
                      </label>
                    )
                  })}
                </fieldset>
                <div className="space-y-1.5">
                  <Label htmlFor="w-name">{t('patientName')}</Label>
                  <Input id="w-name" autoComplete="off" {...form.register('patient_name')} />
                  {errors.patient_name && (
                    <p className="text-sm text-destructive">
                      {fieldError(errors.patient_name.message)}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-[2fr_1fr] gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="w-phone">{t('mobile')}</Label>
                    <Input
                      id="w-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      {...form.register('patient_phone')}
                    />
                    {errors.patient_phone && (
                      <p className="text-sm text-destructive">
                        {fieldError(errors.patient_phone.message)}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-age">{t('age')}</Label>
                    <Input
                      id="w-age"
                      type="number"
                      inputMode="numeric"
                      {...form.register('patient_age')}
                    />
                    {errors.patient_age && (
                      <p className="text-sm text-destructive">
                        {fieldError(errors.patient_age.message)}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={form.formState.isSubmitting || !shiftId}
                >
                  {form.formState.isSubmitting && <Loader2 className="animate-spin" />} {t('issue')}
                </Button>
              </form>
            </CardContent>
          </Card>

          {issued && (
            <Card className="print-slip h-fit border-primary">
              <CardHeader>
                <CardTitle className="text-base">{t('issued')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-center">
                <p className="text-7xl font-bold tabular">{issued.token_no}</p>
                <p className="font-medium">{issued.doctor_name}</p>
                <p className="text-sm text-muted-foreground">
                  {issued.shift_name}, {formatTimeRange(issued.start_time, issued.end_time)} ·{' '}
                  {formatDate(issued.session_date)}
                </p>
                <p className="font-mono text-sm">{issued.booking_reference}</p>
                <p className="text-sm">{issued.patient_name}</p>
                <Button variant="outline" onClick={() => window.print()} className="mt-2">
                  <Printer /> {t('printSlip')}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
