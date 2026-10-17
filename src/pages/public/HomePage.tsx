import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Clock, MapPin, Phone, Search, Ticket } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
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
  },
})

export function HomePage() {
  const t = useT(messages)
  const hospitalQuery = useHospital()
  const hospital = hospitalQuery.data
  const today = useToday()
  const navigate = useNavigate()
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

  if (hospitalQuery.isPending) return <PageSpinner />
  if (hospitalQuery.isError)
    return <ErrorState error={hospitalQuery.error} onRetry={() => hospitalQuery.refetch()} />
  if (!hospital)
    return <EmptyState title={t('hospitalNotFound')} description={t('hospitalNotFoundBody')} />

  const sessionsToday =
    available.data?.items.flatMap((d) => d.sessions.map((s) => ({ doctor: d, session: s }))) ?? []
  const running = sessionsToday.filter((x) => x.session.session_status === 'OPEN').length
  const bookable = sessionsToday.filter((x) => x.session.bookable)

  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 px-5 py-8 text-primary-foreground sm:px-10 sm:py-12">
        <p className="text-sm font-medium opacity-90">{formatDate(today)}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">{hospital.name}</h1>
        {hospital.tagline && <p className="mt-2 max-w-2xl opacity-90">{hospital.tagline}</p>}
        <p className="mt-4 text-sm opacity-90">
          {running > 0 ? t('running', { count: running }) : t('noneRunning')}
          {' · '}
          {t('openToday', { count: bookable.length })}
        </p>
        <form
          className="mt-6 flex max-w-xl gap-2"
          role="search"
          onSubmit={(e) => {
            e.preventDefault()
            navigate(`/doctors${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`)
          }}
        >
          <label htmlFor="home-search" className="sr-only">
            {t('searchLabel')}
          </label>
          <Input
            id="home-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-11 bg-background text-foreground"
          />
          <Button
            type="submit"
            size="lg"
            variant="secondary"
            className="h-11"
            aria-label={t('search')}
          >
            <Search />
          </Button>
        </form>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild size="lg" variant="secondary">
            <Link to="/doctors?available=1">
              <Ticket /> {t('bookToken')}
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="border-primary-foreground/40 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <Link to="/track">{t('trackToken')}</Link>
          </Button>
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
            {departments.data?.map((d) => (
              <Button key={d.id} asChild variant="outline" className="rounded-full">
                <Link to={`/doctors?department=${d.id}`}>{d.name}</Link>
              </Button>
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
            {bookable.slice(0, 6).map(({ doctor, session }) => (
              <Card key={`${doctor.id}-${session.shift_id}`} className="gap-3 py-4">
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
                <CardContent className="flex items-center justify-between gap-2 px-4 text-sm">
                  <div>
                    <p>
                      {session.shift_name}, {formatTimeRange(session.start_time, session.end_time)}
                    </p>
                    <p className="text-muted-foreground">
                      {t('onlineLeft', { count: session.remaining_online })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <SessionStatusBadge status={session.session_status} />
                    <Button asChild size="sm">
                      <Link
                        to={`/book/${doctor.id}?shift=${session.shift_id}&date=${session.session_date}`}
                      >
                        {t('book')}
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2" aria-label={t('visitingInfo')}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="size-4" /> {t('operatingHours')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-1 text-sm">
              {hospital.operating_hours.map((h) => (
                <div key={h.label} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{h.label}</dt>
                  <dd className="text-right font-medium">{h.hours}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="size-4" /> {t('addressContact')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <address className="not-italic">
              {hospital.address_line}, {hospital.city}, {hospital.state} {hospital.postal_code}
            </address>
            {hospital.map_url && (
              <a
                href={hospital.map_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {t('openInMaps')}
              </a>
            )}
            {hospital.phone && (
              <p className="flex items-center gap-2">
                <Phone className="size-4" aria-hidden />{' '}
                <a href={`tel:${hospital.phone.replace(/\s/g, '')}`}>{hospital.phone}</a>
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
