import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { fetchDepartments, fetchSpecialties, searchDoctors } from '@/api/public'
import { DoctorAvatar, SessionSummary } from '@/components/doctor'
import { CardSkeletons, EmptyState, ErrorState, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebounced, useHospital, useToday } from '@/hooks/useHospital'
import { defineMessages, localeFor, useLanguage, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { addDays, formatMoney } from '@/lib/format'

const PAGE_SIZE = 8
const ALL = '__all'

const messages = defineMessages({
  en: {
    title: 'Find a doctor',
    description: 'Live OPD status and token availability.',
    updated: 'Updated {time}',
    searchLabel: 'Doctor or specialty',
    searchPlaceholder: 'e.g. Rao, Paediatrician',
    department: 'Department',
    allDepartments: 'All departments',
    specialty: 'Specialty',
    allSpecialties: 'All specialties',
    availableOnly: 'Open for booking only',
    noMatch: 'No doctors match these filters',
    noMatchAvailable: 'Turn off "Open for booking only" to see all doctors.',
    noMatchSearch: 'Try a different search.',
    doctorCount: '{count} doctor|{count} doctors',
    consultationFee: 'Consultation fee {fee} (paid at hospital)',
    noOpdToday: 'No OPD today.',
    noOpdTomorrow: 'No OPD tomorrow.',
    viewProfile: 'View profile',
    pagination: 'Pagination',
    pageOf: 'Page {page} of {pages}',
  },
  hi: {
    title: 'डॉक्टर खोजें',
    description: 'ओपीडी की लाइव स्थिति और टोकन की उपलब्धता।',
    updated: '{time} पर अपडेट',
    searchLabel: 'डॉक्टर या विशेषज्ञता',
    searchPlaceholder: 'जैसे: Rao, Paediatrician',
    department: 'विभाग',
    allDepartments: 'सभी विभाग',
    specialty: 'विशेषज्ञता',
    allSpecialties: 'सभी विशेषज्ञता',
    availableOnly: 'केवल बुकिंग के लिए खुले',
    noMatch: 'इन फ़िल्टर से कोई डॉक्टर नहीं मिला',
    noMatchAvailable: 'सभी डॉक्टर देखने के लिए "केवल बुकिंग के लिए खुले" बंद करें।',
    noMatchSearch: 'कुछ और खोजकर देखें।',
    doctorCount: '{count} डॉक्टर|{count} डॉक्टर',
    consultationFee: 'परामर्श शुल्क {fee} (अस्पताल में देना है)',
    noOpdToday: 'आज ओपीडी नहीं है।',
    noOpdTomorrow: 'कल ओपीडी नहीं है।',
    viewProfile: 'प्रोफ़ाइल देखें',
    pagination: 'पेज',
    pageOf: 'पेज {page} / {pages}',
  },
})

export function DoctorsPage() {
  const t = useT(messages)
  const c = useT(common)
  const { lang } = useLanguage()
  const { data: hospital } = useHospital()
  const today = useToday()
  const [params, setParams] = useSearchParams()

  const q = params.get('q') ?? ''
  const department = params.get('department') ?? ''
  const specialty = params.get('specialty') ?? ''
  const availableOnly = params.get('available') === '1'
  const day = params.get('day') === 'tomorrow' ? 'tomorrow' : 'today'
  const page = Math.max(0, Number(params.get('page') ?? 0) || 0)
  const date = day === 'tomorrow' ? addDays(today, 1) : today
  const search = useDebounced(q, 350)

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  const departments = useQuery({
    queryKey: ['departments', hospital?.id],
    queryFn: () => fetchDepartments(hospital!.id),
    enabled: !!hospital,
    staleTime: 10 * 60_000,
  })
  const specialties = useQuery({
    queryKey: ['specialties', hospital?.id],
    queryFn: () => fetchSpecialties(hospital!.id),
    enabled: !!hospital,
    staleTime: 10 * 60_000,
  })

  const queryKey = [
    'doctors',
    'search',
    hospital?.id,
    search,
    department,
    specialty,
    availableOnly,
    date,
    page,
  ]
  const doctors = useQuery({
    queryKey,
    queryFn: () =>
      searchDoctors({
        hospitalId: hospital!.id,
        search,
        departmentId: department || undefined,
        specialty: specialty || undefined,
        availableOnly,
        date,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    enabled: !!hospital,
    placeholderData: keepPreviousData,
    // Directory numbers refresh every minute; live Realtime is reserved for tracking and staff screens
    // to stay well inside the free Realtime message quota.
    refetchInterval: 60_000,
  })

  const total = doctors.data?.total ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          doctors.dataUpdatedAt ? (
            <span className="text-xs text-muted-foreground">
              {t('updated', {
                time: new Date(doctors.dataUpdatedAt).toLocaleTimeString(localeFor(lang), {
                  hour: 'numeric',
                  minute: '2-digit',
                }),
              })}
            </span>
          ) : null
        }
      />

      <Card className="mb-6 py-4">
        <CardContent className="grid gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Label htmlFor="doctor-search" className="mb-1.5">
              {t('searchLabel')}
            </Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="doctor-search"
                value={q}
                onChange={(e) => update({ q: e.target.value || null })}
                placeholder={t('searchPlaceholder')}
                className="pl-8"
                maxLength={60}
              />
            </div>
          </div>
          <div>
            <Label className="mb-1.5">{t('department')}</Label>
            <Select
              value={department || ALL}
              onValueChange={(v) => update({ department: v === ALL ? null : v })}
            >
              <SelectTrigger className="w-full" aria-label={t('department')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('allDepartments')}</SelectItem>
                {departments.data?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5">{t('specialty')}</Label>
            <Select
              value={specialty || ALL}
              onValueChange={(v) => update({ specialty: v === ALL ? null : v })}
            >
              <SelectTrigger className="w-full" aria-label={t('specialty')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('allSpecialties')}</SelectItem>
                {specialties.data?.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col justify-end gap-3">
            <Tabs value={day} onValueChange={(v) => update({ day: v === 'today' ? null : v })}>
              <TabsList className="w-full">
                <TabsTrigger value="today">{c('today')}</TabsTrigger>
                <TabsTrigger value="tomorrow">{c('tomorrow')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              <Switch
                id="available-only"
                checked={availableOnly}
                onCheckedChange={(on) => update({ available: on ? '1' : null })}
              />
              <Label htmlFor="available-only">{t('availableOnly')}</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {doctors.isPending ? (
        <CardSkeletons count={4} className="md:grid-cols-2" />
      ) : doctors.isError ? (
        <ErrorState error={doctors.error} onRetry={() => doctors.refetch()} />
      ) : total === 0 ? (
        <EmptyState
          title={t('noMatch')}
          description={availableOnly ? t('noMatchAvailable') : t('noMatchSearch')}
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {t('doctorCount', { count: total })}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {doctors.data.items.map((d) => (
              <Card key={d.id} className="gap-4 py-4">
                <CardContent className="space-y-4 px-4">
                  <div className="flex gap-3">
                    <DoctorAvatar name={d.full_name} photoUrl={d.photo_url} />
                    <div className="min-w-0 flex-1">
                      <h2 className="font-semibold">
                        <Link to={`/doctors/${d.id}`} className="hover:underline">
                          {d.full_name}
                        </Link>
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {d.specialty} · {d.department.name}
                      </p>
                      {d.qualifications && (
                        <p className="text-xs text-muted-foreground">{d.qualifications}</p>
                      )}
                      {d.consultation_fee_paise > 0 && (
                        <p className="mt-1 text-xs">
                          {t('consultationFee', { fee: formatMoney(d.consultation_fee_paise) })}
                        </p>
                      )}
                    </div>
                  </div>
                  {d.sessions.length === 0 ? (
                    <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                      {day === 'tomorrow' ? t('noOpdTomorrow') : t('noOpdToday')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {d.sessions.map((s) => (
                        <SessionSummary key={s.shift_id} session={s} doctorId={d.id} compact />
                      ))}
                    </div>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/doctors/${d.id}`}>{t('viewProfile')}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          {pages > 1 && (
            <nav
              className="mt-6 flex items-center justify-center gap-3"
              aria-label={t('pagination')}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => update({ page: String(page - 1) })}
              >
                <ChevronLeft /> {c('previous')}
              </Button>
              <span className="text-sm tabular">{t('pageOf', { page: page + 1, pages })}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pages}
                onClick={() => update({ page: String(page + 1) })}
              >
                {c('next')} <ChevronRight />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
