import { CalendarClock, Clock, Ticket, Users } from 'lucide-react'
import { Link } from 'react-router'
import { SessionStatusBadge, ToneBadge } from '@/components/badges'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { defineMessages, useT } from '@/i18n'
import { sessionUnavailableText } from '@/i18n/server-text'
import { formatMoney, formatTimeRange, initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SessionRow } from '@/types/database'

const messages = defineMessages({
  en: {
    nowServing: 'Now serving',
    waiting: 'Waiting',
    onlineLeft: 'Online left',
    tokensBooked: 'Tokens booked',
    issued: '{issued} of {capacity} tokens issued',
    bookingFee: 'booking fee {fee}',
    runningLate: 'Running about {minutes} min late',
    bookToken: 'Book token',
  },
  hi: {
    nowServing: 'अभी का टोकन',
    waiting: 'प्रतीक्षा में',
    onlineLeft: 'ऑनलाइन बाकी',
    tokensBooked: 'बुक हुए टोकन',
    issued: '{capacity} में से {issued} टोकन जारी',
    bookingFee: 'बुकिंग शुल्क {fee}',
    runningLate: 'लगभग {minutes} मिनट की देरी',
    bookToken: 'टोकन बुक करें',
  },
})

export function DoctorAvatar({
  name,
  photoUrl,
  className,
}: {
  name: string
  photoUrl?: string | null
  className?: string
}) {
  return (
    <Avatar className={cn('size-14 rounded-xl', className)}>
      {photoUrl ? (
        <AvatarImage src={photoUrl} alt="" loading="lazy" width={56} height={56} />
      ) : null}
      <AvatarFallback className="rounded-xl bg-accent font-semibold text-accent-foreground">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  )
}

/** One OPD session: time, live status, capacity and the book button. */
export function SessionSummary({
  session,
  doctorId,
  compact = false,
}: {
  session: SessionRow
  doctorId: string
  compact?: boolean
}) {
  const t = useT(messages)
  const used =
    session.online_capacity > 0
      ? Math.min(100, (session.issued_count / session.capacity) * 100)
      : 100
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-medium">
          <Clock className="size-4 text-muted-foreground" aria-hidden />
          <span>{session.shift_name}</span>
          <span className="text-muted-foreground">
            {formatTimeRange(session.start_time, session.end_time)}
          </span>
        </div>
        <SessionStatusBadge status={session.session_status} />
      </div>

      {!compact && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <Stat
            icon={<Ticket className="size-3.5" />}
            label={t('nowServing')}
            value={session.current_token_no ?? '–'}
          />
          <Stat
            icon={<Users className="size-3.5" />}
            label={t('waiting')}
            value={session.waiting_count}
          />
          <Stat
            icon={<CalendarClock className="size-3.5" />}
            label={t('onlineLeft')}
            value={session.remaining_online}
          />
        </div>
      )}

      <div className="mt-3">
        <Progress value={used} aria-label={t('tokensBooked')} className="h-1.5" />
        <p className="mt-1 text-xs text-muted-foreground tabular">
          {t('issued', { issued: session.issued_count, capacity: session.capacity })}
          {session.booking_fee_paise > 0 && (
            <> · {t('bookingFee', { fee: formatMoney(session.booking_fee_paise) })}</>
          )}
        </p>
      </div>

      {session.delay_minutes > 0 && (
        <ToneBadge color="amber" className="mt-2">
          {t('runningLate', { minutes: session.delay_minutes })}
        </ToneBadge>
      )}
      {session.public_note && (
        <p className="mt-2 text-sm text-muted-foreground">{session.public_note}</p>
      )}

      <div className="mt-3">
        {session.bookable ? (
          <Button
            asChild
            variant="cta"
            size={compact ? 'sm' : 'default'}
            className="w-full sm:w-auto"
          >
            <Link to={`/book/${doctorId}?shift=${session.shift_id}&date=${session.session_date}`}>
              {t('bookToken')}
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {sessionUnavailableText(session.unavailable_reason, session.unavailable_message)}
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="rounded-md bg-muted/60 px-2 py-1.5">
      <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-lg font-semibold tabular">{value}</div>
    </div>
  )
}
