import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Clock, Info } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router'
import { getBooking, keyFromHash } from '@/api/bookings'
import {
  BookingDetails,
  QueueProgress,
  ShareTrackingLink,
  TokenHero,
} from '@/components/booking-view'
import { EmptyState, ErrorState, PageSpinner } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { defineMessages, useT } from '@/i18n'
import { formatDateTime } from '@/lib/format'

const messages = defineMessages({
  en: {
    loading: 'Loading your booking',
    notFound: 'Booking not found',
    notFoundBody:
      'The link may be incomplete. Open the full tracking link, or check My bookings on the phone you booked from.',
    trackAToken: 'Track a token',
    pendingTitle: 'Waiting for payment confirmation',
    pendingBefore: 'Your booking is',
    pendingStrong: 'not confirmed yet',
    pendingAfter: '. It is confirmed only after the hospital’s server verifies the payment.',
    heldUntil: 'Your slot is held until {time}.',
    cancelledTitle: 'This booking is cancelled',
    booked: 'Token booked',
    reference: 'Booking reference {reference}',
    visitTitle: 'When you visit',
    visitCheckIn: 'Check in at the OPD reception desk with your token number.',
    visitQueue:
      'Watch the live queue and arrive before your turn. If you are not present when called, your token is skipped and can be recalled at the desk.',
    visitBring: 'Bring a photo ID and any previous prescriptions or reports.',
    trackMyToken: 'Track my token',
    backHome: 'Back to home',
  },
  hi: {
    loading: 'आपकी बुकिंग लोड हो रही है',
    notFound: 'बुकिंग नहीं मिली',
    notFoundBody:
      'हो सकता है लिंक अधूरा हो। पूरा ट्रैकिंग लिंक खोलें, या जिस फ़ोन से बुक किया था उस पर "मेरी बुकिंग" देखें।',
    trackAToken: 'टोकन ट्रैक करें',
    pendingTitle: 'भुगतान की पुष्टि का इंतज़ार',
    pendingBefore: 'आपकी बुकिंग',
    pendingStrong: 'अभी पक्की नहीं हुई है',
    pendingAfter: '। अस्पताल का सर्वर भुगतान की पुष्टि करने के बाद ही यह पक्की होगी।',
    heldUntil: 'आपका स्लॉट {time} तक रोका गया है।',
    cancelledTitle: 'यह बुकिंग रद्द हो गई है',
    booked: 'टोकन बुक हो गया',
    reference: 'बुकिंग नंबर {reference}',
    visitTitle: 'अस्पताल आने पर',
    visitCheckIn: 'अपना टोकन नंबर बताकर ओपीडी रिसेप्शन डेस्क पर चेक-इन करें।',
    visitQueue:
      'लाइव कतार देखते रहें और अपनी बारी से पहले पहुँचें। बुलाए जाने पर आप मौजूद न हों, तो आपका टोकन छोड़ दिया जाता है; रिसेप्शन डेस्क पर उसे दोबारा कतार में लगवाया जा सकता है।',
    visitBring: 'फ़ोटो पहचान पत्र और पुराने पर्चे या रिपोर्ट साथ लाएँ।',
    trackMyToken: 'मेरा टोकन ट्रैक करें',
    backHome: 'होम पेज पर वापस',
  },
})

export function BookingConfirmationPage() {
  const t = useT(messages)
  const { reference = '' } = useParams()
  const { hash } = useLocation()
  const accessKey = keyFromHash(hash)

  const booking = useQuery({
    queryKey: ['booking', reference, accessKey],
    queryFn: () => getBooking(reference, accessKey),
    // keep polling while a payment is being confirmed by the server/webhook
    refetchInterval: (q) => (q.state.data?.status === 'PAYMENT_PENDING' ? 5_000 : false),
  })

  if (booking.isPending) return <PageSpinner label={t('loading')} />
  if (booking.isError) return <ErrorState error={booking.error} onRetry={() => booking.refetch()} />
  if (!booking.data) {
    return (
      <EmptyState
        title={t('notFound')}
        description={t('notFoundBody')}
        action={
          <Button asChild>
            <Link to="/track">{t('trackAToken')}</Link>
          </Button>
        }
      />
    )
  }

  const b = booking.data
  const pending = b.status === 'PAYMENT_PENDING'
  const trackHref = `/track/${b.booking_reference}${accessKey ? `#k=${accessKey}` : ''}`

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {pending ? (
        <Alert className="border-warning/50">
          <Clock aria-hidden />
          <AlertTitle>{t('pendingTitle')}</AlertTitle>
          <AlertDescription>
            {t('pendingBefore')} <strong>{t('pendingStrong')}</strong>
            {t('pendingAfter')}{' '}
            {b.hold_expires_at && (
              <>{t('heldUntil', { time: formatDateTime(b.hold_expires_at) })}</>
            )}
          </AlertDescription>
        </Alert>
      ) : b.status === 'CANCELLED' ? (
        <Alert variant="destructive">
          <Info aria-hidden />
          <AlertTitle>{t('cancelledTitle')}</AlertTitle>
          <AlertDescription>{b.cancel_reason}</AlertDescription>
        </Alert>
      ) : (
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-8 text-success" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold">{t('booked')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('reference', { reference: b.booking_reference })}
            </p>
          </div>
        </div>
      )}

      <TokenHero booking={b} />

      {accessKey && <ShareTrackingLink reference={b.booking_reference} accessKey={accessKey} />}

      <QueueProgress booking={b} />
      <BookingDetails booking={b} />

      <Alert>
        <Info aria-hidden />
        <AlertTitle>{t('visitTitle')}</AlertTitle>
        <AlertDescription>
          <ul className="list-disc space-y-1 pl-4">
            <li>{b.hospital.visit_instructions ?? t('visitCheckIn')}</li>
            <li>{t('visitQueue')}</li>
            <li>{t('visitBring')}</li>
          </ul>
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild size="lg" className="flex-1">
          <Link to={trackHref}>{t('trackMyToken')}</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="flex-1">
          <Link to="/">{t('backHome')}</Link>
        </Button>
      </div>
    </div>
  )
}
