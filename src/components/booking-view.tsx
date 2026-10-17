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
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { formatDate, formatDateTime, formatMoney, formatTimeRange } from '@/lib/format'
import { notificationText } from '@/lib/notification-text'
import { cn } from '@/lib/utils'
import type { BookingView } from '@/types/database'

const messages = defineMessages({
  en: {
    yourToken: 'Your token',
    yourTurn: 'It’s your turn — please go to {doctor}.',
    yourTurnRoom: 'It’s your turn — please go to {doctor}, {room}.',
    liveQueue: 'Live queue',
    nowServing: 'Now serving',
    next: 'Next',
    ahead: 'Ahead of you',
    estimate:
      'Rough estimate: about {minutes} min of consultations ahead of you. Actual times vary — plan to arrive early.',
    doctorLate: 'Doctor running about {minutes} min late',
    notStarted:
      'The OPD has not started yet. Token calls begin when the doctor starts the session.',
    queueCounts: '{waiting} checked in · {completed} seen · last change {time}',
    details: 'Booking details',
    doctor: 'Doctor',
    date: 'Date',
    shift: 'OPD shift',
    patient: 'Patient',
    hospital: 'Hospital',
    directions: 'Directions',
    reason: 'Reason: {reason}',
    noFee: 'No booking fee.',
    payAtCounter: 'Booking fee {fee} — pay at the hospital counter.',
    onlinePayment: 'Online payment {fee}:',
    paid: 'paid (verified by the hospital)',
    refunded: 'refunded',
    failed: 'failed',
    awaiting: 'awaiting confirmation',
    refund: 'Refund:',
    refundProcessed: 'processed by the payment provider',
    refundRejected: 'not approved — contact the hospital',
    refundFailed: 'failed — the hospital will contact you',
    refundRequested: 'requested (pending confirmation from the payment provider)',
    updates: 'Updates',
    copyFailed: 'Could not copy. Long-press the link to copy it.',
    shareTitle: 'OPD token {reference}',
    saveLink: 'Save your tracking link',
    saveLinkBody:
      'This private link is the only way to open this booking on another phone. Anyone with it can see your token.',
    copied: 'Copied',
    copyLink: 'Copy link',
    share: 'Share',
  },
  hi: {
    yourToken: 'आपका टोकन',
    yourTurn: 'आपकी बारी आ गई है — कृपया {doctor} के पास जाएँ।',
    yourTurnRoom: 'आपकी बारी आ गई है — कृपया {room} में {doctor} के पास जाएँ।',
    liveQueue: 'लाइव कतार',
    nowServing: 'अभी का टोकन',
    next: 'अगला टोकन',
    ahead: 'आपसे आगे',
    estimate:
      'मोटा अनुमान: आपसे पहले लगभग {minutes} मिनट के परामर्श बाकी हैं। असली समय बदल सकता है — थोड़ा पहले पहुँचें।',
    doctorLate: 'डॉक्टर लगभग {minutes} मिनट देरी से चल रहे हैं',
    notStarted: 'ओपीडी अभी शुरू नहीं हुई है। डॉक्टर के सत्र शुरू करने पर टोकन बुलाए जाने लगेंगे।',
    queueCounts: '{waiting} चेक-इन · {completed} देखे गए · आख़िरी बदलाव {time}',
    details: 'बुकिंग की जानकारी',
    doctor: 'डॉक्टर',
    date: 'तारीख़',
    shift: 'ओपीडी शिफ़्ट',
    patient: 'मरीज़',
    hospital: 'अस्पताल',
    directions: 'रास्ता देखें',
    reason: 'कारण: {reason}',
    noFee: 'कोई बुकिंग शुल्क नहीं।',
    payAtCounter: 'बुकिंग शुल्क {fee} — अस्पताल काउंटर पर भुगतान करें।',
    onlinePayment: 'ऑनलाइन भुगतान {fee}:',
    paid: 'भुगतान हो गया (अस्पताल द्वारा सत्यापित)',
    refunded: 'रिफ़ंड हो गया',
    failed: 'विफल',
    awaiting: 'पुष्टि का इंतज़ार',
    refund: 'रिफ़ंड:',
    refundProcessed: 'भुगतान प्रदाता ने प्रोसेस कर दिया',
    refundRejected: 'मंज़ूर नहीं हुआ — अस्पताल से संपर्क करें',
    refundFailed: 'विफल — अस्पताल आपसे संपर्क करेगा',
    refundRequested: 'अनुरोध किया गया (भुगतान प्रदाता की पुष्टि बाकी)',
    updates: 'अपडेट',
    copyFailed: 'कॉपी नहीं हो सका। लिंक को देर तक दबाकर कॉपी करें।',
    shareTitle: 'ओपीडी टोकन {reference}',
    saveLink: 'अपना ट्रैकिंग लिंक सहेजें',
    saveLinkBody:
      'किसी दूसरे फ़ोन पर यह बुकिंग खोलने का यही एक निजी लिंक है। जिसके पास यह लिंक होगा, वह आपका टोकन देख सकता है।',
    copied: 'कॉपी हो गया',
    copyLink: 'लिंक कॉपी करें',
    share: 'शेयर करें',
  },
})

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
  const t = useT(messages)
  const c = useT(common)
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
      <p className="text-sm font-medium text-muted-foreground">{t('yourToken')}</p>
      <p className="my-1 text-7xl font-bold tracking-tight tabular" aria-live="polite">
        {booking.token_no ?? '—'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <AppointmentStatusBadge status={booking.status} />
        <span className="font-mono text-sm text-muted-foreground">{booking.booking_reference}</span>
      </div>
      {called && (
        <p className="mt-3 font-semibold text-success">
          {booking.doctor.room_no
            ? t('yourTurnRoom', {
                doctor: booking.doctor.full_name,
                room: c('room', { room: booking.doctor.room_no }),
              })
            : t('yourTurn', { doctor: booking.doctor.full_name })}
        </p>
      )}
    </div>
  )
}

export function QueueProgress({ booking }: { booking: BookingView }) {
  const t = useT(messages)
  const q = booking.queue
  const isActive = (ACTIVE as readonly string[]).includes(booking.status)
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">{t('liveQueue')}</CardTitle>
        <SessionStatusBadge status={q.status} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Metric label={t('nowServing')} value={q.current_token_no ?? '–'} />
          <Metric label={t('next')} value={q.next_token_no ?? '–'} />
          <Metric
            label={t('ahead')}
            value={isActive && booking.patients_ahead != null ? booking.patients_ahead : '–'}
          />
        </div>
        {isActive && booking.estimated_wait_minutes != null && booking.patients_ahead! > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('estimate', { minutes: booking.estimated_wait_minutes })}
          </p>
        )}
        {q.delay_minutes > 0 && (
          <ToneBadge color="amber">{t('doctorLate', { minutes: q.delay_minutes })}</ToneBadge>
        )}
        {q.public_note && <p className="text-sm">{q.public_note}</p>}
        {q.status === 'SCHEDULED' && isActive && (
          <p className="text-sm text-muted-foreground">{t('notStarted')}</p>
        )}
        <p className="text-xs text-muted-foreground">
          {t('queueCounts', {
            waiting: q.waiting_count,
            completed: q.completed_count,
            time: formatDateTime(q.updated_at),
          })}
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
  const t = useT(messages)
  const c = useT(common)
  const h = booking.hospital
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('details')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Row icon={<Stethoscope />} label={t('doctor')}>
            {booking.doctor.full_name}
            <span className="block text-muted-foreground">
              {booking.doctor.specialty} · {booking.doctor.department}
              {booking.doctor.room_no && ` · ${c('room', { room: booking.doctor.room_no })}`}
            </span>
          </Row>
          <Row icon={<CalendarDays />} label={t('date')}>
            {formatDate(booking.session_date)}
          </Row>
          <Row icon={<Clock />} label={t('shift')}>
            {booking.shift.name},{' '}
            {formatTimeRange(booking.shift.start_time, booking.shift.end_time)}
          </Row>
          <Row icon={<Users />} label={t('patient')}>
            {booking.patient_name_masked}
            <span className="block text-muted-foreground">{booking.patient_phone_masked}</span>
          </Row>
          <Row icon={<MapPin />} label={t('hospital')} className="sm:col-span-2">
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
                {t('directions')}
              </a>
            )}
          </Row>
        </dl>
        <PaymentLine booking={booking} />
        {booking.cancel_reason && booking.status === 'CANCELLED' && (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('reason', { reason: booking.cancel_reason })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function PaymentLine({ booking }: { booking: BookingView }) {
  const t = useT(messages)
  if (booking.payment_mode === 'FREE')
    return <p className="mt-4 text-sm text-muted-foreground">{t('noFee')}</p>
  if (booking.payment_mode === 'PAY_AT_HOSPITAL') {
    return (
      <p className="mt-4 text-sm">{t('payAtCounter', { fee: formatMoney(booking.fee_paise) })}</p>
    )
  }
  const p = booking.payment
  return (
    <div className="mt-4 space-y-1 text-sm">
      <p>
        {t('onlinePayment', { fee: formatMoney(booking.fee_paise) })}{' '}
        <strong>
          {p?.status === 'CAPTURED'
            ? t('paid')
            : p?.status === 'REFUNDED'
              ? t('refunded')
              : p?.status === 'FAILED'
                ? t('failed')
                : t('awaiting')}
        </strong>
      </p>
      {booking.refund && (
        <p>
          {t('refund')}{' '}
          <strong>
            {booking.refund.status === 'PROCESSED'
              ? t('refundProcessed')
              : booking.refund.status === 'REJECTED'
                ? t('refundRejected')
                : booking.refund.status === 'FAILED'
                  ? t('refundFailed')
                  : t('refundRequested')}
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

export function NotificationsList({ booking }: { booking: BookingView }) {
  const t = useT(messages)
  const items = booking.notifications
  if (!items.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bell className="size-4" /> {t('updates')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((n, i) => {
          const { title, body } = notificationText(n, booking)
          return (
            <div key={n.id ?? i} className="border-l-2 border-primary/40 pl-3 text-sm">
              <p className="font-medium">{title}</p>
              <p className="text-muted-foreground">{body}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(n.created_at)}</p>
            </div>
          )
        })}
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
  const t = useT(messages)
  const [copied, setCopied] = useState(false)
  const url = trackingUrl(reference, accessKey)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('copyFailed'))
    }
  }
  const share = async () => {
    try {
      await navigator.share({ title: t('shareTitle', { reference }), url })
    } catch {
      /* user cancelled */
    }
  }
  return (
    <Alert>
      <AlertTitle>{t('saveLink')}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{t('saveLinkBody')}</p>
        <p className="break-all rounded bg-muted px-2 py-1 font-mono text-xs">{url}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />} {copied ? t('copied') : t('copyLink')}
          </Button>
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <Button size="sm" variant="outline" onClick={share}>
              <Share2 /> {t('share')}
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
