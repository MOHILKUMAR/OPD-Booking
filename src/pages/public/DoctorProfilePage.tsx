import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Info, MapPin } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { fetchDoctor, fetchSessions } from '@/api/public'
import { DoctorAvatar, SessionSummary } from '@/components/doctor'
import { CardSkeletons, EmptyState, ErrorState, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useHospital, useToday } from '@/hooks/useHospital'
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { addDays, formatMoney, relativeDayLabel } from '@/lib/format'

const messages = defineMessages({
  en: {
    notFound: 'Doctor not found',
    allDoctors: 'All doctors',
    sessions: 'OPD sessions',
    noSessions: 'No OPD sessions in the booking window',
    noSessionsBody: 'Check again later or contact the hospital.',
    about: 'About',
    rules: 'Booking rules',
    ruleWindowToday: 'Online booking is open for today.',
    ruleWindowDays: 'Online booking is open for today and the next {days} day(s).',
    ruleOneToken: 'One active token per mobile number for each doctor and session.',
    ruleSameDay:
      'Same-day online booking closes shortly before the session ends; the reception desk can still issue walk-in tokens.',
    ruleCancel: 'Cancel online up to {minutes} minutes before the session starts.',
    ruleFee: 'Consultation fee {fee}, paid at the hospital.',
    ruleOrder: 'Token numbers are an order of arrival, not an exact appointment time.',
    where: 'Where',
  },
  hi: {
    notFound: 'डॉक्टर नहीं मिले',
    allDoctors: 'सभी डॉक्टर',
    sessions: 'ओपीडी सत्र',
    noSessions: 'बुकिंग की अवधि में कोई ओपीडी सत्र नहीं है',
    noSessionsBody: 'बाद में फिर देखें या अस्पताल से संपर्क करें।',
    about: 'परिचय',
    rules: 'बुकिंग के नियम',
    ruleWindowToday: 'ऑनलाइन बुकिंग आज के लिए खुली है।',
    ruleWindowDays: 'ऑनलाइन बुकिंग आज और अगले {days} दिन के लिए खुली है।',
    ruleOneToken: 'हर डॉक्टर और सत्र के लिए एक मोबाइल नंबर पर एक ही सक्रिय टोकन।',
    ruleSameDay:
      'उसी दिन की ऑनलाइन बुकिंग सत्र खत्म होने से कुछ समय पहले बंद हो जाती है; रिसेप्शन डेस्क फिर भी वॉक-इन टोकन दे सकता है।',
    ruleCancel: 'सत्र शुरू होने से {minutes} मिनट पहले तक ऑनलाइन रद्द कर सकते हैं।',
    ruleFee: 'परामर्श शुल्क {fee}, अस्पताल में देना होगा।',
    ruleOrder: 'टोकन नंबर केवल बारी का क्रम है, अपॉइंटमेंट का सटीक समय नहीं।',
    where: 'कहाँ',
  },
})

export function DoctorProfilePage() {
  const t = useT(messages)
  const c = useT(common)
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
        title={t('notFound')}
        action={
          <Button asChild>
            <Link to="/doctors">{t('allDoctors')}</Link>
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
          <ArrowLeft /> {t('allDoctors')}
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
            {t('sessions')}
          </h2>
          {sessions.isPending ? (
            <CardSkeletons count={2} />
          ) : sessions.isError ? (
            <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />
          ) : byDate.size === 0 ? (
            <EmptyState title={t('noSessions')} description={t('noSessionsBody')} />
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
                <CardTitle className="text-base">{t('about')}</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-line text-sm">{d.bio}</CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="size-4" /> {t('rules')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1.5 pl-5 text-sm">
                <li>
                  {hospital && hospital.booking_window_days > 0
                    ? t('ruleWindowDays', { days: hospital.booking_window_days })
                    : t('ruleWindowToday')}
                </li>
                <li>{t('ruleOneToken')}</li>
                <li>{t('ruleSameDay')}</li>
                {hospital && hospital.cancel_cutoff_minutes > 0 && (
                  <li>{t('ruleCancel', { minutes: hospital.cancel_cutoff_minutes })}</li>
                )}
                {d.consultation_fee_paise > 0 && (
                  <li>{t('ruleFee', { fee: formatMoney(d.consultation_fee_paise) })}</li>
                )}
                <li>{t('ruleOrder')}</li>
              </ul>
            </CardContent>
          </Card>
          {hospital && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="size-4" /> {t('where')}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                <p className="font-medium">
                  {hospital.name}
                  {d.room_no && <> · {c('room', { room: d.room_no })}</>}
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
