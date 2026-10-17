import { Badge } from '@/components/ui/badge'
import { STATUS_LABEL } from '@/lib/queue-transitions'
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

const SESSION: Record<SessionStatus, { label: string; tone: keyof typeof tone }> = {
  SCHEDULED: { label: 'Not started', tone: 'grey' },
  OPEN: { label: 'OPD running', tone: 'green' },
  PAUSED: { label: 'Paused', tone: 'amber' },
  CLOSED: { label: 'Closed', tone: 'grey' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
}

export function SessionStatusBadge({
  status,
  className,
}: {
  status: SessionStatus
  className?: string
}) {
  const s = SESSION[status]
  return <Badge className={cn(tone[s.tone], className)}>{s.label}</Badge>
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
  return (
    <Badge className={cn(tone[APPOINTMENT_TONE[status]], className)}>{STATUS_LABEL[status]}</Badge>
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
