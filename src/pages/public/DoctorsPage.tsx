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
import { addDays, formatMoney } from '@/lib/format'

const PAGE_SIZE = 8
const ALL = '__all'

export function DoctorsPage() {
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
        title="Find a doctor"
        description="Live OPD status and token availability."
        actions={
          doctors.dataUpdatedAt ? (
            <span className="text-xs text-muted-foreground">
              Updated{' '}
              {new Date(doctors.dataUpdatedAt).toLocaleTimeString('en-IN', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          ) : null
        }
      />

      <Card className="mb-6 py-4">
        <CardContent className="grid gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Label htmlFor="doctor-search" className="mb-1.5">
              Doctor or specialty
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
                placeholder="e.g. Rao, Paediatrician"
                className="pl-8"
                maxLength={60}
              />
            </div>
          </div>
          <div>
            <Label className="mb-1.5">Department</Label>
            <Select
              value={department || ALL}
              onValueChange={(v) => update({ department: v === ALL ? null : v })}
            >
              <SelectTrigger className="w-full" aria-label="Department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments.data?.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5">Specialty</Label>
            <Select
              value={specialty || ALL}
              onValueChange={(v) => update({ specialty: v === ALL ? null : v })}
            >
              <SelectTrigger className="w-full" aria-label="Specialty">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All specialties</SelectItem>
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
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="tomorrow">Tomorrow</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-2">
              <Switch
                id="available-only"
                checked={availableOnly}
                onCheckedChange={(c) => update({ available: c ? '1' : null })}
              />
              <Label htmlFor="available-only">Open for booking only</Label>
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
          title="No doctors match these filters"
          description={
            availableOnly
              ? 'Turn off "Open for booking only" to see all doctors.'
              : 'Try a different search.'
          }
        />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
            {total} doctor{total === 1 ? '' : 's'}
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
                          Consultation fee {formatMoney(d.consultation_fee_paise)} (paid at
                          hospital)
                        </p>
                      )}
                    </div>
                  </div>
                  {d.sessions.length === 0 ? (
                    <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                      No OPD {day}.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {d.sessions.map((s) => (
                        <SessionSummary key={s.shift_id} session={s} doctorId={d.id} compact />
                      ))}
                    </div>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/doctors/${d.id}`}>View profile</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
          {pages > 1 && (
            <nav className="mt-6 flex items-center justify-center gap-3" aria-label="Pagination">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => update({ page: String(page - 1) })}
              >
                <ChevronLeft /> Previous
              </Button>
              <span className="text-sm tabular">
                Page {page + 1} of {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pages}
                onClick={() => update({ page: String(page + 1) })}
              >
                Next <ChevronRight />
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
