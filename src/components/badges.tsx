import { Badge } from '@/components/ui/badge'
import { useT } from '@/i18n'
import { common } from '@/i18n/common'
import { cn } from '@/lib/utils'
import type { AppointmentStatus, SessionStatus } from '@/types/database'

const tone = {
  green: 'border-transparent bg-success/15 text-success',
  amber: 'border-transparent bg-warning/15 text-warning',
  red: 'border-transparent bg-destructive/10 text-destructive',
  blue: 'border-transparent bg-chart-2/15 text-chart-2',
  teal: 'border-transparent bg-primary/12 text-primary',
  grey: 'border-transparent bg-muted text-muted-foreground',
} as const

const SESSION_TONE: Record<SessionStatus, keyof typeof tone> = {
  SCHEDULED: 'grey',
  OPEN: 'green',
  PAUSED: 'amber',
  CLOSED: 'grey',
  CANCELLED: 'red',
}

export function SessionStatusBadge({
  status,
  className,
}: {
  status: SessionStatus
  className?: string
}) {
  const t = useT(common)
  return (
    <Badge className={cn(tone[SESSION_TONE[status]], className)}>{t(`session.${status}`)}</Badge>
  )
}

const APPOINTMENT_TONE: Record<AppointmentStatus, keyof typeof tone> = {
  BOOKED: 'blue',
  PAYMENT_PENDING: 'amber',
  CONFIRMED: 'teal',
  ARRIVED: 'blue',
  WAITING: 'blue',
  CALLED: 'green',
  IN_CONSULTATION: 'green',
  COMPLETED: 'grey',
  SKIPPED: 'amber',
  CANCELLED: 'red',
  NO_SHOW: 'red',
}

export function AppointmentStatusBadge({
  status,
  className,
}: {
  status: AppointmentStatus
  className?: string
}) {
  const t = useT(common)
  return (
    <Badge className={cn(tone[APPOINTMENT_TONE[status]], className)}>{t(`appt.${status}`)}</Badge>
  )
}

export function ToneBadge({
  children,
  color,
  className,
}: {
  children: React.ReactNode
  color: keyof typeof tone
  className?: string
}) {
  return <Badge className={cn(tone[color], className)}>{children}</Badge>
}
