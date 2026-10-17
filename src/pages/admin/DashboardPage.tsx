import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { fetchDashboard } from '@/api/admin'
import { ChartCard, ColumnChart, HorizontalBarChart, TrendLineChart } from '@/components/charts'
import { ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useHospital, useToday } from '@/hooks/useHospital'
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { addDays, formatDate } from '@/lib/format'

const messages = defineMessages({
  en: {
    loading: 'Loading dashboard',
    title: 'Dashboard',
    description: 'Live figures for {date} from the database. No sample data.',
    bookingsToday: 'Bookings today',
    bookingsTodayHint: '{online} online · {walkIn} walk-in',
    confirmedNotArrived: 'Confirmed, not arrived',
    waiting: 'Waiting (checked in)',
    withDoctor: 'With the doctor',
    completed: 'Completed',
    cancelled: 'Cancelled',
    noShows: 'No-shows',
    activeDoctors: 'Active doctors',
    sessionsRunning: 'OPD sessions running',
    awaitingPayment: 'Awaiting payment',
    trends: 'Trends',
    days: '{n} days',
    conversion: 'Conversion',
    onlineCompletion: 'Online booking completion',
    onlineCompletionHint: '{done} of {total} got a token',
    paidCompletion: 'Paid-booking completion',
    paidCompletionHint: '{done} of {total} payment holds',
    cancellationRate: 'Cancellation rate',
    cancellationRateHint: '{done} of {total} tokens',
    noShowRate: 'No-show rate',
    noShowRateHint: '{seen} seen · {noShow} no-show',
    bookingsByDay: 'Bookings by day',
    bookingsByDayHint: 'Tokens issued per OPD date',
    bookings: 'Bookings',
    cancellationRateChartHint: 'Cancelled tokens as % of tokens issued, per day',
    bookingsByDepartment: 'Bookings by department',
    volumeByDoctor: 'Patient volume by doctor',
    volumeByDoctorHint: 'Top 15 doctors',
    patients: 'Patients',
    peakHours: 'Peak booking hours',
    peakHoursHint: 'When bookings are made (hospital time)',
  },
  hi: {
    loading: 'डैशबोर्ड लोड हो रहा है',
    title: 'डैशबोर्ड',
    description: '{date} के लाइव आँकड़े, सीधे डेटाबेस से। कोई नमूना डेटा नहीं।',
    bookingsToday: 'आज की बुकिंग',
    bookingsTodayHint: '{online} ऑनलाइन · {walkIn} वॉक-इन',
    confirmedNotArrived: 'पक्की, पर अभी नहीं पहुँचे',
    waiting: 'प्रतीक्षा में (चेक-इन हो गया)',
    withDoctor: 'डॉक्टर के पास',
    completed: 'पूरे हुए',
    cancelled: 'रद्द',
    noShows: 'नहीं आए',
    activeDoctors: 'सक्रिय डॉक्टर',
    sessionsRunning: 'चालू ओपीडी सत्र',
    awaitingPayment: 'भुगतान बाकी',
    trends: 'रुझान',
    days: '{n} दिन',
    conversion: 'बुकिंग पूरी होने की दर',
    onlineCompletion: 'ऑनलाइन बुकिंग पूरी होने की दर',
    onlineCompletionHint: '{total} में से {done} को टोकन मिला',
    paidCompletion: 'सशुल्क बुकिंग पूरी होने की दर',
    paidCompletionHint: 'भुगतान के लिए रोकी गई {total} बुकिंग में से {done}',
    cancellationRate: 'रद्द होने की दर',
    cancellationRateHint: '{total} टोकन में से {done}',
    noShowRate: 'न आने की दर',
    noShowRateHint: '{seen} देखे गए · {noShow} नहीं आए',
    bookingsByDay: 'दिन के अनुसार बुकिंग',
    bookingsByDayHint: 'हर ओपीडी तारीख़ के लिए जारी टोकन',
    bookings: 'बुकिंग',
    cancellationRateChartHint: 'हर दिन जारी टोकन में से रद्द टोकन का %',
    bookingsByDepartment: 'विभाग के अनुसार बुकिंग',
    volumeByDoctor: 'डॉक्टर के अनुसार मरीज़ों की संख्या',
    volumeByDoctorHint: 'शीर्ष 15 डॉक्टर',
    patients: 'मरीज़',
    peakHours: 'बुकिंग के व्यस्त घंटे',
    peakHoursHint: 'बुकिंग कब की जाती है (अस्पताल का समय)',
  },
})

const RANGES = { '7': 7, '14': 14, '30': 30 } as const

export default function DashboardPage() {
  const { data: hospital } = useHospital()
  const today = useToday()
  const t = useT(messages)
  const c = useT(common)
  const [range, setRange] = useState<keyof typeof RANGES>('14')
  const from = addDays(today, -(RANGES[range] - 1))

  const stats = useQuery({
    queryKey: ['dashboard', hospital?.id, from, today],
    queryFn: () => fetchDashboard(hospital!.id, from, today),
    enabled: !!hospital,
    refetchInterval: 60_000,
  })

  if (stats.isPending) return <PageSpinner label={t('loading')} />
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
  const s = stats.data
  const counts = s.today_counts
  const conv = s.conversion
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
        title={t('title')}
        description={t('description', { date: formatDate(s.today) })}
      />

      <section
        aria-label={c('today')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        <Tile
          label={t('bookingsToday')}
          value={counts.total}
          hint={t('bookingsTodayHint', { online: counts.online, walkIn: counts.walk_in })}
        />
        <Tile label={t('confirmedNotArrived')} value={counts.confirmed} />
        <Tile label={t('waiting')} value={counts.waiting} />
        <Tile label={t('withDoctor')} value={counts.serving} />
        <Tile label={t('completed')} value={counts.completed} />
        <Tile label={t('cancelled')} value={counts.cancelled} />
        <Tile label={t('noShows')} value={counts.no_show} />
        <Tile label={t('activeDoctors')} value={s.active_doctors} />
        <Tile label={t('sessionsRunning')} value={s.sessions_in_progress} />
        <Tile label={t('awaitingPayment')} value={counts.payment_pending} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{t('trends')}</h2>
        <Tabs value={range} onValueChange={(v) => setRange(v as keyof typeof RANGES)}>
          <TabsList>
            <TabsTrigger value="7">{t('days', { n: 7 })}</TabsTrigger>
            <TabsTrigger value="14">{t('days', { n: 14 })}</TabsTrigger>
            <TabsTrigger value="30">{t('days', { n: 30 })}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <section aria-label={t('conversion')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label={t('onlineCompletion')}
          value={pct(conv.online_confirmed, conv.online_created)}
          hint={t('onlineCompletionHint', {
            done: conv.online_confirmed,
            total: conv.online_created,
          })}
        />
        <Tile
          label={t('paidCompletion')}
          value={pct(conv.payment_holds_confirmed, conv.payment_holds)}
          hint={t('paidCompletionHint', {
            done: conv.payment_holds_confirmed,
            total: conv.payment_holds,
          })}
        />
        <Tile
          label={t('cancellationRate')}
          value={pct(issued.cancelled, issued.bookings)}
          hint={t('cancellationRateHint', { done: issued.cancelled, total: issued.bookings })}
        />
        <Tile
          label={t('noShowRate')}
          value={pct(conv.no_show, conv.completed + conv.no_show)}
          hint={t('noShowRateHint', { seen: conv.completed, noShow: conv.no_show })}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={t('bookingsByDay')}
          subtitle={t('bookingsByDayHint')}
          valueLabel={t('bookings')}
          data={s.by_day.map((d) => ({ label: short(d.date), value: d.bookings }))}
        >
          <ColumnChart data={s.by_day.map((d) => ({ label: short(d.date), value: d.bookings }))} />
        </ChartCard>
        <ChartCard
          title={t('cancellationRate')}
          subtitle={t('cancellationRateChartHint')}
          valueLabel={t('cancelled')}
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
          title={t('bookingsByDepartment')}
          valueLabel={t('bookings')}
          data={s.by_department.map((d) => ({ label: d.department, value: d.bookings }))}
        >
          <HorizontalBarChart
            data={s.by_department.map((d) => ({ label: d.department, value: d.bookings }))}
          />
        </ChartCard>
        <ChartCard
          title={t('volumeByDoctor')}
          subtitle={t('volumeByDoctorHint')}
          valueLabel={t('patients')}
          data={s.by_doctor.map((d) => ({ label: d.doctor, value: d.patients }))}
        >
          <HorizontalBarChart
            data={s.by_doctor.map((d) => ({ label: d.doctor, value: d.patients }))}
          />
        </ChartCard>
        <ChartCard
          title={t('peakHours')}
          subtitle={t('peakHoursHint')}
          valueLabel={t('bookings')}
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
