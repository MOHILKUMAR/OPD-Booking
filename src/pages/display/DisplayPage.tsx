import { useQuery } from '@tanstack/react-query'
import { Maximize } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { fetchDisplayBoard } from '@/api/public'
import { LanguageSwitch } from '@/components/language-switch'
import { LiveIndicator } from '@/components/states'
import { Button } from '@/components/ui/button'
import { useHospital, useNow } from '@/hooks/useHospital'
import { useLiveQueue } from '@/hooks/useLiveQueue'
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { formatClock, formatDate, formatTimeRange } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DisplaySession } from '@/types/database'

// Read from across a waiting room: keep the Hindi labels short.
const messages = defineMessages({
  en: {
    tokenStatus: 'OPD token status',
    fullScreen: 'Full screen',
    noSessions: 'No OPD sessions today.',
    nowServing: 'Now serving',
    delay: 'Running about {minutes} min late. ',
    'status.SCHEDULED': 'Not started',
    'status.OPEN': 'In progress',
    'status.PAUSED': 'Paused',
    'status.CLOSED': 'Closed',
    'status.CANCELLED': 'Cancelled',
  },
  hi: {
    tokenStatus: 'ओपीडी टोकन स्थिति',
    fullScreen: 'फ़ुल स्क्रीन',
    noSessions: 'आज कोई ओपीडी सत्र नहीं है।',
    nowServing: 'अभी का टोकन',
    delay: 'लगभग {minutes} मिनट की देरी। ',
    'status.SCHEDULED': 'शुरू नहीं हुई',
    'status.OPEN': 'चालू',
    'status.PAUSED': 'रुकी हुई',
    'status.CLOSED': 'बंद',
    'status.CANCELLED': 'रद्द',
  },
})

/**
 * Waiting-room TV. Shows only doctor/department, token numbers, OPD status and public
 * announcements — get_display_board() returns no patient fields at all.
 * Opens in Hindi with /display?lang=hi.
 */
export default function DisplayPage() {
  const { data: hospital } = useHospital()
  const t = useT(messages)
  const c = useT(common)
  const [params] = useSearchParams()
  const department = params.get('department')
  const now = useNow(1000)
  const queryKey = ['display', hospital?.id, department]
  const live = useLiveQueue({
    channelKey: `display:${hospital?.id}:${department ?? 'all'}`,
    filter: hospital ? `hospital_id=eq.${hospital.id}` : undefined,
    queryKeys: [queryKey],
    enabled: !!hospital,
  })
  const board = useQuery({
    queryKey,
    queryFn: () => fetchDisplayBoard(hospital!.id, department ?? undefined),
    enabled: !!hospital,
    refetchInterval: live.refetchInterval,
  })

  const sessions = (board.data?.sessions ?? []).filter(
    (s) => s.status !== 'CANCELLED' || s.public_note,
  )
  const announcements = board.data?.announcements ?? []

  return (
    <div className="dark flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-2xl font-bold lg:text-4xl">{hospital?.name ?? 'MediQueue'}</h1>
          <p className="text-muted-foreground lg:text-xl">
            {t('tokenStatus')}
            {board.data && ` · ${formatDate(board.data.date)}`}
          </p>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <p className="text-3xl font-semibold tabular lg:text-5xl">{formatClock(now)}</p>
            <LiveIndicator status={live.status} />
          </div>
          <div className="flex flex-col items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('fullScreen')}
              onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})}
            >
              <Maximize />
            </Button>
            <LanguageSwitch compact className="text-muted-foreground" />
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 lg:p-6">
        {board.isPending ? (
          <p className="p-10 text-center text-2xl text-muted-foreground">{c('loading')}…</p>
        ) : sessions.length === 0 ? (
          <p className="p-10 text-center text-2xl text-muted-foreground">{t('noSessions')}</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sessions.map((s) => (
              <SessionTile key={`${s.doctor_name}-${s.shift_name}`} s={s} />
            ))}
          </div>
        )}
      </main>

      {announcements.length > 0 && (
        <footer className="border-t bg-primary/15 px-6 py-3 lg:text-xl" aria-live="polite">
          {announcements.map((a) => (
            <p key={a.id}>
              <strong>{a.title}:</strong> {a.body}
            </p>
          ))}
        </footer>
      )}
    </div>
  )
}

function SessionTile({ s }: { s: DisplaySession }) {
  const t = useT(messages)
  const c = useT(common)
  const running = s.status === 'OPEN'
  return (
    <div
      className={cn(
        'rounded-2xl border p-5',
        running ? 'border-primary/60 bg-card' : 'bg-card/60 opacity-80',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xl font-semibold lg:text-2xl">{s.doctor_name}</p>
          <p className="text-muted-foreground lg:text-lg">
            {s.department}
            {s.room_no && ` · ${c('room', { room: s.room_no })}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {s.shift_name}, {formatTimeRange(s.start_time, s.end_time)}
          </p>
        </div>
        <span
          className={cn(
            'rounded-full px-3 py-1 text-sm font-semibold',
            running
              ? 'bg-success/20 text-success'
              : s.status === 'PAUSED'
                ? 'bg-warning/20 text-warning'
                : 'bg-muted text-muted-foreground',
          )}
        >
          {t(`status.${s.status}`)}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-center">
        <div className="rounded-xl bg-primary/15 py-3">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">{t('nowServing')}</p>
          <p className="text-6xl font-bold tabular lg:text-7xl">{s.current_token_no ?? '–'}</p>
        </div>
        <div className="rounded-xl bg-muted py-3">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">{c('next')}</p>
          <p className="text-6xl font-bold tabular text-muted-foreground lg:text-7xl">
            {s.next_token_no ?? '–'}
          </p>
        </div>
      </div>
      {(s.delay_minutes > 0 || s.public_note) && (
        <p className="mt-3 rounded-lg bg-warning/15 px-3 py-2 text-warning">
          {s.delay_minutes > 0 && t('delay', { minutes: s.delay_minutes })}
          {s.public_note}
        </p>
      )}
    </div>
  )
}
