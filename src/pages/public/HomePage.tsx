import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Clock,
  MapPin,
  Phone,
  Radar,
  Search,
  Siren,
  Stethoscope,
  Ticket,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { fetchAnnouncements, fetchDepartments, searchDoctors } from '@/api/public'
import { AnnouncementList } from '@/components/announcements'
import { DoctorAvatar } from '@/components/doctor'
import { SessionStatusBadge } from '@/components/badges'
import { CardSkeletons, EmptyState, ErrorState, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useHospital, useToday } from '@/hooks/useHospital'
import { defineMessages, useT } from '@/i18n'
import { formatDate, formatTimeRange } from '@/lib/format'
import { cn } from '@/lib/utils'

const messages = defineMessages({
  en: {
    hospitalNotFound: 'Hospital not found',
    hospitalNotFoundBody: 'Check VITE_HOSPITAL_SLUG and the seed data.',
    running: '{count} OPD session is running now|{count} OPD sessions are running now',
    noneRunning: 'No OPD session is running right now',
    openToday: '{count} session open for booking today|{count} sessions open for booking today',
    searchLabel: 'Search doctors or specialties',
    searchPlaceholder: 'Search doctor, specialty or department',
    search: 'Search',
    bookToken: 'Book a token',
    trackToken: 'Track my token',
    byDepartment: 'Browse by department',
    availableToday: 'Doctors available today',
    allDoctors: 'All doctors',
    noSessionsToday: 'No sessions open for booking today',
    noSessionsTodayBody: "Try tomorrow's sessions from the doctor directory.",
    onlineLeft: '{count} online tokens left',
    book: 'Book',
    visitingInfo: 'Visiting information',
    operatingHours: 'Operating hours',
    addressContact: 'Address & contact',
    openInMaps: 'Open in maps',
    glanceTitle: 'Today at a glance',
    statDoctors: 'Doctors with OPD today',
    statRunning: 'OPD running now',
    statTokens: 'Online tokens left',
    emergency: 'Emergency: {phone}',
  },
  hi: {
    hospitalNotFound: 'अस्पताल नहीं मिला',
    hospitalNotFoundBody: 'VITE_HOSPITAL_SLUG और सीड डेटा जाँचें।',
    running: 'अभी {count} ओपीडी सत्र चल रहा है|अभी {count} ओपीडी सत्र चल रहे हैं',
    noneRunning: 'अभी कोई ओपीडी सत्र नहीं चल रहा है',
    openToday: 'आज बुकिंग के लिए {count} सत्र खुला है|आज बुकिंग के लिए {count} सत्र खुले हैं',
    searchLabel: 'डॉक्टर या विशेषज्ञता खोजें',
    searchPlaceholder: 'डॉक्टर, विशेषज्ञता या विभाग खोजें',
    search: 'खोजें',
    bookToken: 'टोकन बुक करें',
    trackToken: 'मेरा टोकन ट्रैक करें',
    byDepartment: 'विभाग के अनुसार देखें',
    availableToday: 'आज उपलब्ध डॉक्टर',
    allDoctors: 'सभी डॉक्टर',
    noSessionsToday: 'आज बुकिंग के लिए कोई सत्र खुला नहीं है',
    noSessionsTodayBody: 'डॉक्टरों की सूची में कल के सत्र देखें।',
    onlineLeft: '{count} ऑनलाइन टोकन बाकी',
    book: 'बुक करें',
    visitingInfo: 'अस्पताल आने की जानकारी',
    operatingHours: 'खुलने का समय',
    addressContact: 'पता और संपर्क',
    openInMaps: 'मैप में खोलें',
    glanceTitle: 'आज की झलक',
    statDoctors: 'आज ओपीडी वाले डॉक्टर',
    statRunning: 'अभी चल रही ओपीडी',
    statTokens: 'बचे ऑनलाइन टोकन',
    emergency: 'आपातकाल: {phone}',
  },
})

// Department chips cycle through the brand palette (text ≥ 4.5:1 on each tint).
const DEPARTMENT_TONES = [
  'border-brand/25 bg-white text-brand hover:bg-brand/5',
  'border-steel/40 bg-steel/10 text-brand-deep hover:bg-steel/20',
  'border-sky bg-sky/25 text-brand-deep hover:bg-sky/40',
  'border-cream-dark bg-cream text-cream-ink hover:bg-cream-dark',
]

export function HomePage() {
  const t = useT(messages)
  const hospitalQuery = useHospital()
  const hospital = hospitalQuery.data
  const today = useToday()
  const navigate = useNavigate()
  const location = useLocation()
  const [search, setSearch] = useState('')

  const departments = useQuery({
    queryKey: ['departments', hospital?.id],
    queryFn: () => fetchDepartments(hospital!.id),
    enabled: !!hospital,
    staleTime: 10 * 60_000,
  })
  const available = useQuery({
    queryKey: ['doctors', 'home', hospital?.id, today],
    queryFn: () => searchDoctors({ hospitalId: hospital!.id, date: today, limit: 50 }),
    enabled: !!hospital,
  })
  const announcements = useQuery({
    queryKey: ['announcements', hospital?.id],
    queryFn: () => fetchAnnouncements(hospital!.id),
    enabled: !!hospital,
  })

  // "View all" in the announcement bar links to /#announcements
  useEffect(() => {
    if (location.hash === '#announcements' && announcements.data?.length) {
      document.getElementById('announcements')?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [location.hash, announcements.data])

  if (hospitalQuery.isPending) return <PageSpinner />
  if (hospitalQuery.isError)
    return <ErrorState error={hospitalQuery.error} onRetry={() => hospitalQuery.refetch()} />
  if (!hospital)
    return <EmptyState title={t('hospitalNotFound')} description={t('hospitalNotFoundBody')} />

  const sessionsToday =
    available.data?.items.flatMap((d) => d.sessions.map((s) => ({ doctor: d, session: s }))) ?? []
  const running = sessionsToday.filter((x) => x.session.session_status === 'OPEN').length
  const bookable = sessionsToday.filter((x) => x.session.bookable)
  const doctorsToday = new Set(sessionsToday.map((x) => x.doctor.id)).size
  const tokensLeft = bookable.reduce((sum, x) => sum + x.session.remaining_online, 0)

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-lg bg-gradient-to-br from-brand via-brand to-steel px-5 py-8 text-white shadow-lg shadow-brand/20 sm:px-10 sm:py-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-sky/20 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-28 left-1/3 size-80 rounded-full bg-cream/10 blur-3xl"
        />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-md bg-white/15 px-3 py-1 text-sm font-medium">
              <CalendarDays className="size-4" aria-hidden /> {formatDate(today)}
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">{hospital.name}</h1>
            {hospital.tagline && <p className="mt-2 max-w-2xl text-accent">{hospital.tagline}</p>}
            <div className="mt-5 flex flex-wrap gap-2 text-sm">
              <span className="inline-flex items-center gap-2 rounded-md bg-white/15 px-3 py-1 font-medium">
                <span
                  aria-hidden
                  className={cn(
                    'size-2 rounded-full',
                    running > 0 ? 'animate-pulse bg-sky' : 'bg-white/60',
                  )}
                />
                {running > 0 ? t('running', { count: running }) : t('noneRunning')}
              </span>
              <span className="inline-flex items-center gap-2 rounded-md bg-white/15 px-3 py-1 font-medium">
                <Ticket className="size-4" aria-hidden />{' '}
                {t('openToday', { count: bookable.length })}
              </span>
            </div>
            <form
              className="mt-6 flex max-w-xl gap-2"
              role="search"
              onSubmit={(e) => {
                e.preventDefault()
                navigate(
                  `/doctors${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`,
                )
              }}
            >
              <label htmlFor="home-search" className="sr-only">
                {t('searchLabel')}
              </label>
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-500"
                  aria-hidden
                />
                <Input
                  id="home-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="h-12 rounded-md border-0 bg-white pl-10 text-slate-900 shadow-md placeholder:text-slate-500"
                />
              </div>
              <Button
                type="submit"
                size="lg"
                variant="ghost"
                className="h-12 rounded-md bg-brand-deep/60 px-4 text-white hover:bg-brand-deep/80 hover:text-white"
                aria-label={t('search')}
              >
                <Search />
              </Button>
            </form>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                asChild
                size="lg"
                variant="highlight"
                className="h-12 rounded-md px-6 text-base"
              >
                <Link to="/doctors?available=1">
                  <Ticket /> {t('bookToken')}
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-12 rounded-md border-white/50 bg-white/10 px-6 text-base text-white shadow-none hover:bg-white/20 hover:text-white"
              >
                <Link to="/track">
                  <Radar /> {t('trackToken')}
                </Link>
              </Button>
            </div>
          </div>
          <aside
            aria-label={t('glanceTitle')}
            className="hidden rounded-lg border border-white/15 bg-brand-deep/60 p-5 backdrop-blur-sm lg:block"
          >
            <p className="text-sm font-semibold tracking-wide text-sky uppercase">
              {t('glanceTitle')}
            </p>
            <dl className="mt-4 space-y-3">
              {[
                { icon: Stethoscope, label: t('statDoctors'), value: doctorsToday },
                { icon: Activity, label: t('statRunning'), value: running },
                { icon: Ticket, label: t('statTokens'), value: tokensLeft },
              ].map(({ icon: Icon, label, value }) => (
                <div
                  key={label}
                  className="flex items-center gap-3 rounded-md bg-white/10 px-3 py-2.5"
                >
                  <span className="flex size-9 items-center justify-center rounded-md bg-sky/20 text-sky">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <dt className="flex-1 text-sm text-accent">{label}</dt>
                  <dd className="text-2xl font-bold tabular">{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </section>

      {announcements.data && <AnnouncementList items={announcements.data} />}

      <section aria-labelledby="specialties-heading">
        <h2 id="specialties-heading" className="mb-3 text-lg font-semibold">
          {t('byDepartment')}
        </h2>
        {departments.isPending ? (
          <CardSkeletons count={4} className="grid-cols-2 sm:grid-cols-4" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {departments.data?.map((d, i) => (
              <Link
                key={d.id}
                to={`/doctors?department=${d.id}`}
                className={cn(
                  'inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
                  DEPARTMENT_TONES[i % DEPARTMENT_TONES.length],
                )}
              >
                <Stethoscope className="size-4" aria-hidden /> {d.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="today-heading">
        <div className="mb-3 flex items-end justify-between gap-2">
          <h2 id="today-heading" className="text-lg font-semibold">
            {t('availableToday')}
          </h2>
          <Link
            to="/doctors"
            className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {t('allDoctors')} <ArrowRight className="size-4" />
          </Link>
        </div>
        {available.isPending ? (
          <CardSkeletons count={3} className="sm:grid-cols-3" />
        ) : available.isError ? (
          <ErrorState error={available.error} onRetry={() => available.refetch()} />
        ) : bookable.length === 0 ? (
          <EmptyState title={t('noSessionsToday')} description={t('noSessionsTodayBody')} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {bookable.slice(0, 6).map(({ doctor, session }) => {
              const leftShare =
                session.online_capacity > 0
                  ? Math.round((session.remaining_online / session.online_capacity) * 100)
                  : 0
              return (
                <Card
                  key={`${doctor.id}-${session.shift_id}`}
                  className="gap-3 overflow-hidden border-t-4 border-t-steel py-4 transition-shadow hover:shadow-md"
                >
                  <CardHeader className="flex flex-row items-center gap-3 px-4">
                    <DoctorAvatar
                      name={doctor.full_name}
                      photoUrl={doctor.photo_url}
                      className="size-12"
                    />
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">
                        <Link to={`/doctors/${doctor.id}`} className="hover:underline">
                          {doctor.full_name}
                        </Link>
                      </CardTitle>
                      <p className="truncate text-sm text-muted-foreground">
                        {doctor.specialty} · {doctor.department.name}
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 px-4 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <Clock className="mt-0.5 size-4 shrink-0 text-steel" aria-hidden />
                        <div>
                          <p className="font-medium">{session.shift_name}</p>
                          <p className="whitespace-nowrap text-muted-foreground">
                            {formatTimeRange(session.start_time, session.end_time)}
                          </p>
                        </div>
                      </div>
                      <SessionStatusBadge status={session.session_status} />
                    </div>
                    <div>
                      <div className="h-1.5 overflow-hidden rounded-sm bg-sky/30" aria-hidden>
                        <div
                          className="h-full rounded-sm bg-gradient-to-r from-steel to-brand"
                          style={{ width: `${leftShare}%` }}
                        />
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        {t('onlineLeft', { count: session.remaining_online })}
                      </p>
                    </div>
                    <Button asChild variant="cta" className="w-full">
                      <Link
                        to={`/book/${doctor.id}?shift=${session.shift_id}&date=${session.session_date}`}
                      >
                        <Ticket /> {t('book')}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2" aria-label={t('visitingInfo')}>
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="flex flex-row items-center gap-3 bg-brand px-5 py-4 text-white">
            <span className="flex size-9 items-center justify-center rounded-md bg-white/15">
              <Clock className="size-5" aria-hidden />
            </span>
            <CardTitle className="text-base">{t('operatingHours')}</CardTitle>
          </CardHeader>
          <CardContent className="px-5 py-2">
            <dl className="divide-y">
              {hospital.operating_hours.map((h) => {
                const allDay = /24\s*[x×]\s*7/i.test(h.hours)
                return (
                  <div
                    key={h.label}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <dt className="flex items-center gap-2 font-medium text-slate-700">
                      {allDay ? (
                        <Siren className="size-4 text-rose-600" aria-hidden />
                      ) : (
                        <CalendarDays className="size-4 text-steel" aria-hidden />
                      )}
                      {h.label}
                    </dt>
                    <dd className="flex flex-wrap justify-end gap-1.5">
                      {h.hours
                        .split(',')
                        .map((part) => part.trim())
                        .filter(Boolean)
                        .map((part) => (
                          <span
                            key={part}
                            className={cn(
                              'rounded-sm px-2.5 py-1 text-xs font-semibold tabular',
                              allDay
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-sky/25 text-brand-deep ring-1 ring-sky',
                            )}
                          >
                            {part}
                          </span>
                        ))}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </CardContent>
        </Card>
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="flex flex-row items-center gap-3 border-b border-cream-dark bg-cream px-5 py-4 text-brand">
            <span className="flex size-9 items-center justify-center rounded-md bg-brand/10">
              <MapPin className="size-5" aria-hidden />
            </span>
            <CardTitle className="text-base">{t('addressContact')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 px-5 py-4 text-sm">
            <address className="not-italic text-slate-700">
              {hospital.address_line}, {hospital.city}, {hospital.state} {hospital.postal_code}
            </address>
            <div className="flex flex-wrap gap-2">
              {hospital.phone && (
                <a
                  href={`tel:${hospital.phone.replace(/\s/g, '')}`}
                  className="inline-flex items-center gap-2 rounded-md bg-brand/5 px-3 py-1.5 font-medium text-brand ring-1 ring-brand/20 hover:bg-brand/10"
                >
                  <Phone className="size-4" aria-hidden /> {hospital.phone}
                </a>
              )}
              {hospital.emergency_phone && (
                <a
                  href={`tel:${hospital.emergency_phone.replace(/\s/g, '')}`}
                  className="inline-flex items-center gap-2 rounded-md bg-rose-50 px-3 py-1.5 font-semibold text-rose-800 ring-1 ring-rose-200 hover:bg-rose-100"
                >
                  <Siren className="size-4" aria-hidden />
                  {t('emergency', { phone: hospital.emergency_phone })}
                </a>
              )}
              {hospital.map_url && (
                <a
                  href={hospital.map_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-steel/10 px-3 py-1.5 font-medium text-brand-deep ring-1 ring-steel/30 hover:bg-steel/20"
                >
                  <MapPin className="size-4" aria-hidden /> {t('openInMaps')}
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
