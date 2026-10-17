import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Info, MapPin } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { fetchDoctor, fetchSessions } from '@/api/public'
import { DoctorAvatar, SessionSummary } from '@/components/doctor'
import { CardSkeletons, EmptyState, ErrorState, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useHospital, useToday } from '@/hooks/useHospital'
import { addDays, formatMoney, relativeDayLabel } from '@/lib/format'

export function DoctorProfilePage() {
  const { doctorId = '' } = useParams()
  const { data: hospital } = useHospital()
  const today = useToday()
  const lastDay = addDays(today, hospital?.booking_window_days ?? 1)

  const doctor = useQuery({ queryKey: ['doctor', doctorId], queryFn: () => fetchDoctor(doctorId) })
  const sessions = useQuery({
    queryKey: ['sessions', hospital?.id, doctorId, today, lastDay],
    queryFn: () => fetchSessions(hospital!.id, today, lastDay, [doctorId]),
    enabled: !!hospital && !!doctor.data,
    refetchInterval: 30_000,
  })

  if (doctor.isPending) return <PageSpinner />
  if (doctor.isError) return <ErrorState error={doctor.error} onRetry={() => doctor.refetch()} />
  if (!doctor.data)
    return (
      <EmptyState
        title="Doctor not found"
        action={
          <Button asChild>
            <Link to="/doctors">All doctors</Link>
          </Button>
        }
      />
    )

  const d = doctor.data
  const byDate = new Map<string, NonNullable<typeof sessions.data>>()
  for (const s of sessions.data ?? [])
    byDate.set(s.session_date, [...(byDate.get(s.session_date) ?? []), s])

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/doctors">
          <ArrowLeft /> All doctors
        </Link>
      </Button>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <DoctorAvatar name={d.full_name} photoUrl={d.photo_url} className="size-20" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{d.full_name}</h1>
          <p className="text-muted-foreground">
            {d.specialty} · {d.department?.name}
          </p>
          {d.qualifications && <p className="text-sm">{d.qualifications}</p>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="sessions-heading" className="space-y-4">
          <h2 id="sessions-heading" className="text-lg font-semibold">
            OPD sessions
          </h2>
          {sessions.isPending ? (
            <CardSkeletons count={2} />
          ) : sessions.isError ? (
            <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
          ) : byDate.size === 0 ? (
            <EmptyState
              title="No OPD sessions in the booking window"
              description="Check again later or contact the hospital."
            />
          ) : (
            [...byDate.entries()].map(([date, list]) => (
              <div key={date} className="space-y-2">
                <h3 className="font-medium">{relativeDayLabel(date, today)}</h3>
                {list.map((s) => (
                  <SessionSummary key={s.shift_id} session={s} doctorId={d.id} />
                ))}
              </div>
            ))
          )}
        </section>

        <aside className="space-y-4">
          {d.bio && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">About</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-line text-sm">{d.bio}</CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="size-4" /> Booking rules
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-5 text-sm">
                <li>
                  Online booking is open for today
                  {hospital && hospital.booking_window_days > 0
                    ? ` and the next ${hospital.booking_window_days} day(s)`
                    : ''}
                  .
                </li>
                <li>One active token per mobile number for each doctor and session.</li>
                <li>
                  Same-day online booking closes shortly before the session ends; the reception desk
                  can still issue walk-in tokens.
                </li>
                {hospital && hospital.cancel_cutoff_minutes > 0 && (
                  <li>
                    Cancel online up to {hospital.cancel_cutoff_minutes} minutes before the session
                    starts.
                  </li>
                )}
                {d.consultation_fee_paise > 0 && (
                  <li>
                    Consultation fee {formatMoney(d.consultation_fee_paise)}, paid at the hospital.
                  </li>
                )}
                <li>Token numbers are an order of arrival, not an exact appointment time.</li>
              </ul>
            </CardContent>
          </Card>
          {hospital && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="size-4" /> Where
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="font-medium">
                  {hospital.name}
                  {d.room_no && <> · Room {d.room_no}</>}
                </p>
                <address className="not-italic text-muted-foreground">
                  {hospital.address_line}, {hospital.city}
                </address>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}
