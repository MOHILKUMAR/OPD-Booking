import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { fetchDashboard } from '@/api/admin'
import { ChartCard, ColumnChart, HorizontalBarChart, TrendLineChart } from '@/components/charts'
import { ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useHospital, useToday } from '@/hooks/useHospital'
import { addDays, formatDate } from '@/lib/format'

const RANGES = { '7': 7, '14': 14, '30': 30 } as const

export default function DashboardPage() {
  const { data: hospital } = useHospital()
  const today = useToday()
  const [range, setRange] = useState<keyof typeof RANGES>('14')
  const from = addDays(today, -(RANGES[range] - 1))

  const stats = useQuery({
    queryKey: ['dashboard', hospital?.id, from, today],
    queryFn: () => fetchDashboard(hospital!.id, from, today),
    enabled: !!hospital,
    refetchInterval: 60_000,
  })

  if (stats.isPending) return <PageSpinner label="Loading dashboard" />
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
  const s = stats.data
  const t = s.today_counts
  const c = s.conversion
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '–')
  const short = (iso: string) => formatDate(iso, { weekday: undefined, year: undefined })
  const issued = s.by_day.reduce(
    (acc, d) => ({ bookings: acc.bookings + d.bookings, cancelled: acc.cancelled + d.cancelled }),
    {
      bookings: 0,
      cancelled: 0,
    },
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Live figures for ${formatDate(s.today)} from the database. No sample data.`}
      />

      <section aria-label="Today" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile
          label="Bookings today"
          value={t.total}
          hint={`${t.online} online · ${t.walk_in} walk-in`}
        />
        <Tile label="Confirmed, not arrived" value={t.confirmed} />
        <Tile label="Waiting (checked in)" value={t.waiting} />
        <Tile label="With the doctor" value={t.serving} />
        <Tile label="Completed" value={t.completed} />
        <Tile label="Cancelled" value={t.cancelled} />
        <Tile label="No-shows" value={t.no_show} />
        <Tile label="Active doctors" value={s.active_doctors} />
        <Tile label="OPD sessions running" value={s.sessions_in_progress} />
        <Tile label="Awaiting payment" value={t.payment_pending} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Trends</h2>
        <Tabs value={range} onValueChange={(v) => setRange(v as keyof typeof RANGES)}>
          <TabsList>
            <TabsTrigger value="7">7 days</TabsTrigger>
            <TabsTrigger value="14">14 days</TabsTrigger>
            <TabsTrigger value="30">30 days</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <section aria-label="Conversion" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Online booking completion"
          value={pct(c.online_confirmed, c.online_created)}
          hint={`${c.online_confirmed} of ${c.online_created} got a token`}
        />
        <Tile
          label="Paid-booking completion"
          value={pct(c.payment_holds_confirmed, c.payment_holds)}
          hint={`${c.payment_holds_confirmed} of ${c.payment_holds} payment holds`}
        />
        <Tile
          label="Cancellation rate"
          value={pct(issued.cancelled, issued.bookings)}
          hint={`${issued.cancelled} of ${issued.bookings} tokens`}
        />
        <Tile
          label="No-show rate"
          value={pct(c.no_show, c.completed + c.no_show)}
          hint={`${c.completed} seen · ${c.no_show} no-show`}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Bookings by day"
          subtitle="Tokens issued per OPD date"
          valueLabel="Bookings"
          data={s.by_day.map((d) => ({ label: short(d.date), value: d.bookings }))}
        >
          <ColumnChart data={s.by_day.map((d) => ({ label: short(d.date), value: d.bookings }))} />
        </ChartCard>
        <ChartCard
          title="Cancellation rate"
          subtitle="Cancelled tokens as % of tokens issued, per day"
          valueLabel="Cancelled"
          unit="%"
          data={s.by_day.map((d) => ({
            label: short(d.date),
            value: d.bookings ? Math.round((d.cancelled / d.bookings) * 100) : 0,
          }))}
        >
          <TrendLineChart
            unit="%"
            data={s.by_day.map((d) => ({
              label: short(d.date),
              value: d.bookings ? Math.round((d.cancelled / d.bookings) * 100) : 0,
            }))}
          />
        </ChartCard>
        <ChartCard
          title="Bookings by department"
          valueLabel="Bookings"
          data={s.by_department.map((d) => ({ label: d.department, value: d.bookings }))}
        >
          <HorizontalBarChart
            data={s.by_department.map((d) => ({ label: d.department, value: d.bookings }))}
          />
        </ChartCard>
        <ChartCard
          title="Patient volume by doctor"
          subtitle="Top 15 doctors"
          valueLabel="Patients"
          data={s.by_doctor.map((d) => ({ label: d.doctor, value: d.patients }))}
        >
          <HorizontalBarChart
            data={s.by_doctor.map((d) => ({ label: d.doctor, value: d.patients }))}
          />
        </ChartCard>
        <ChartCard
          title="Peak booking hours"
          subtitle="When bookings are made (hospital time)"
          valueLabel="Bookings"
          data={s.peak_hours.map((h) => ({
            label: `${String(h.hour).padStart(2, '0')}:00`,
            value: h.bookings,
          }))}
        >
          <ColumnChart
            data={s.peak_hours.map((h) => ({
              label: `${String(h.hour).padStart(2, '0')}:00`,
              value: h.bookings,
            }))}
          />
        </ChartCard>
      </div>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}
