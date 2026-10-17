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
import { toAppError } from '@/lib/errors'
import { formatDate, formatTimeRange } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { BookingResult } from '@/types/database'

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
        ctx.addIssue({ code: 'custom', message: 'Enter a valid age (0–120)' })
        return z.NEVER
      }
      return n
    }),
})

export default function WalkInPage() {
  const scope = useStaffScope()
  const today = useToday()
  const queryClient = useQueryClient()
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

  const onSubmit = form.handleSubmit(async (v) => {
    if (!shiftId) return toast.error('Choose a session')
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
      <PageHeader
        title="Walk-in token"
        description="Issue a token for a patient at the desk. Walk-ins are checked in immediately."
      />
      {open.length === 0 ? (
        <EmptyState title="No session available for walk-ins today" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Patient</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-medium">Session</legend>
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
                              {Math.max(left, 0)} tokens left
                            </span>
                          </span>
                        </span>
                        <SessionStatusBadge status={s.session_status} />
                      </label>
                    )
                  })}
                </fieldset>
                <div className="space-y-1.5">
                  <Label htmlFor="w-name">Patient name</Label>
                  <Input id="w-name" autoComplete="off" {...form.register('patient_name')} />
                  {errors.patient_name && (
                    <p className="text-sm text-destructive">{errors.patient_name.message}</p>
                  )}
                </div>
                <div className="grid grid-cols-[2fr_1fr] gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="w-phone">Mobile</Label>
                    <Input
                      id="w-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      {...form.register('patient_phone')}
                    />
                    {errors.patient_phone && (
                      <p className="text-sm text-destructive">{errors.patient_phone.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-age">Age</Label>
                    <Input
                      id="w-age"
                      type="number"
                      inputMode="numeric"
                      {...form.register('patient_age')}
                    />
                    {errors.patient_age && (
                      <p className="text-sm text-destructive">{errors.patient_age.message}</p>
                    )}
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={form.formState.isSubmitting || !shiftId}
                >
                  {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Issue token
                </Button>
              </form>
            </CardContent>
          </Card>

          {issued && (
            <Card className="print-slip h-fit border-primary">
              <CardHeader>
                <CardTitle className="text-base">Token issued</CardTitle>
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
                  <Printer /> Print slip
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
