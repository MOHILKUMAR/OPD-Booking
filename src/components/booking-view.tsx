import {
  Bell,
  CalendarDays,
  Check,
  Clock,
  Copy,
  MapPin,
  Share2,
  Stethoscope,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { trackingUrl } from '@/api/bookings'
import { AppointmentStatusBadge, SessionStatusBadge, ToneBadge } from '@/components/badges'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate, formatDateTime, formatMoney, formatTimeRange } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { BookingView } from '@/types/database'

const ACTIVE = [
  'BOOKED',
  'CONFIRMED',
  'ARRIVED',
  'WAITING',
  'CALLED',
  'IN_CONSULTATION',
  'SKIPPED',
] as const

export function TokenHero({ booking }: { booking: BookingView }) {
  const called = booking.status === 'CALLED' || booking.status === 'IN_CONSULTATION'
  return (
    <div
      className={cn(
        'rounded-2xl border p-6 text-center',
        called
          ? 'border-success bg-success/10'
          : booking.status === 'CANCELLED'
            ? 'bg-muted'
            : 'bg-accent/60',
      )}
    >
      <p className="text-sm font-medium text-muted-foreground">Your token</p>
      <p className="my-1 text-7xl font-bold tracking-tight tabular" aria-live="polite">
        {booking.token_no ?? '—'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <AppointmentStatusBadge status={booking.status} />
        <span className="font-mono text-sm text-muted-foreground">{booking.booking_reference}</span>
      </div>
      {called && (
        <p className="mt-3 font-semibold text-success">
          It’s your turn — please go to {booking.doctor.full_name}
          {booking.doctor.room_no && `, Room ${booking.doctor.room_no}`}.
        </p>
      )}
    </div>
  )
}

export function QueueProgress({ booking }: { booking: BookingView }) {
  const q = booking.queue
  const isActive = (ACTIVE as readonly string[]).includes(booking.status)
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Live queue</CardTitle>
        <SessionStatusBadge status={q.status} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label="Now serving" value={q.current_token_no ?? '–'} />
          <Metric label="Next" value={q.next_token_no ?? '–'} />
          <Metric
            label="Ahead of you"
            value={isActive && booking.patients_ahead != null ? booking.patients_ahead : '–'}
          />
        </div>
        {isActive && booking.estimated_wait_minutes != null && booking.patients_ahead! > 0 && (
          <p className="text-sm text-muted-foreground">
            Rough estimate: about {booking.estimated_wait_minutes} min of consultations ahead of
            you. Actual times vary — plan to arrive early.
          </p>
        )}
        {q.delay_minutes > 0 && (
          <ToneBadge color="amber">Doctor running about {q.delay_minutes} min late</ToneBadge>
        )}
        {q.public_note && <p className="text-sm">{q.public_note}</p>}
        {q.status === 'SCHEDULED' && isActive && (
          <p className="text-sm text-muted-foreground">
            The OPD has not started yet. Token calls begin when the doctor starts the session.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {q.waiting_count} checked in · {q.completed_count} seen · last change{' '}
          {formatDateTime(q.updated_at)}
        </p>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/60 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular">{value}</p>
    </div>
  )
}

export function BookingDetails({ booking }: { booking: BookingView }) {
  const h = booking.hospital
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Booking details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Row icon={<Stethoscope />} label="Doctor">
            {booking.doctor.full_name}
            <span className="block text-muted-foreground">
              {booking.doctor.specialty} · {booking.doctor.department}
              {booking.doctor.room_no && ` · Room ${booking.doctor.room_no}`}
            </span>
          </Row>
          <Row icon={<CalendarDays />} label="Date">
            {formatDate(booking.session_date)}
          </Row>
          <Row icon={<Clock />} label="OPD shift">
            {booking.shift.name},{' '}
            {formatTimeRange(booking.shift.start_time, booking.shift.end_time)}
          </Row>
          <Row icon={<Users />} label="Patient">
            {booking.patient_name_masked}
            <span className="block text-muted-foreground">{booking.patient_phone_masked}</span>
          </Row>
          <Row icon={<MapPin />} label="Hospital" className="sm:col-span-2">
            {h.name}
            <span className="block text-muted-foreground">
              {h.address_line}, {h.city}, {h.state} {h.postal_code}
            </span>
            {h.map_url && (
              <a
                href={h.map_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Directions
              </a>
            )}
          </Row>
        </dl>
        <PaymentLine booking={booking} />
        {booking.cancel_reason && booking.status === 'CANCELLED' && (
          <p className="mt-3 text-sm text-muted-foreground">Reason: {booking.cancel_reason}</p>
        )}
      </CardContent>
    </Card>
  )
}

function PaymentLine({ booking }: { booking: BookingView }) {
  if (booking.payment_mode === 'FREE')
    return <p className="mt-4 text-sm text-muted-foreground">No booking fee.</p>
  if (booking.payment_mode === 'PAY_AT_HOSPITAL') {
    return (
      <p className="mt-4 text-sm">
        Booking fee {formatMoney(booking.fee_paise)} — pay at the hospital counter.
      </p>
    )
  }
  const p = booking.payment
  return (
    <div className="mt-4 space-y-1 text-sm">
      <p>
        Online payment {formatMoney(booking.fee_paise)}:{' '}
        <strong>
          {p?.status === 'CAPTURED'
            ? 'paid (verified by the hospital)'
            : p?.status === 'REFUNDED'
              ? 'refunded'
              : p?.status === 'FAILED'
                ? 'failed'
                : 'awaiting confirmation'}
        </strong>
      </p>
      {booking.refund && (
        <p>
          Refund:{' '}
          <strong>
            {booking.refund.status === 'PROCESSED'
              ? 'processed by the payment provider'
              : booking.refund.status === 'REJECTED'
                ? 'not approved — contact the hospital'
                : booking.refund.status === 'FAILED'
                  ? 'failed — the hospital will contact you'
                  : 'requested (pending confirmation from the payment provider)'}
          </strong>
        </p>
      )}
    </div>
  )
}

function Row({
  icon,
  label,
  children,
  className,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex gap-3', className)}>
      <span className="mt-0.5 text-muted-foreground [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <div>
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="font-medium">{children}</dd>
      </div>
    </div>
  )
}

export function NotificationsList({ items }: { items: BookingView['notifications'] }) {
  if (!items.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="size-4" /> Updates
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((n, i) => (
          <div key={i} className="border-l-2 border-primary/40 pl-3 text-sm">
            <p className="font-medium">{n.title}</p>
            <p className="text-muted-foreground">{n.body}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function ShareTrackingLink({
  reference,
  accessKey,
}: {
  reference: string
  accessKey: string
}) {
  const [copied, setCopied] = useState(false)
  const url = trackingUrl(reference, accessKey)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Long-press the link to copy it.')
    }
  }
  const share = async () => {
    try {
      await navigator.share({ title: `OPD token ${reference}`, url })
    } catch {
      /* user cancelled */
    }
  }
  return (
    <Alert>
      <AlertTitle>Save your tracking link</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>
          This private link is the only way to open this booking on another phone. Anyone with it
          can see your token.
        </p>
        <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{url}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy link'}
          </Button>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <Button size="sm" variant="outline" onClick={share}>
              <Share2 /> Share
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
