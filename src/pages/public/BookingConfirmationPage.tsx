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
import { formatDateTime } from '@/lib/format'

export function BookingConfirmationPage() {
  const { reference = '' } = useParams()
  const { hash } = useLocation()
  const accessKey = keyFromHash(hash)

  const booking = useQuery({
    queryKey: ['booking', reference, accessKey],
    queryFn: () => getBooking(reference, accessKey),
    // keep polling while a payment is being confirmed by the server/webhook
    refetchInterval: (q) => (q.state.data?.status === 'PAYMENT_PENDING' ? 5_000 : false),
  })

  if (booking.isPending) return <PageSpinner label="Loading your booking" />
  if (booking.isError) return <ErrorState error={booking.error} onRetry={() => booking.refetch()} />
  if (!booking.data) {
    return (
      <EmptyState
        title="Booking not found"
        description="The link may be incomplete. Open the full tracking link, or check My bookings on the phone you booked from."
        action={
          <Button asChild>
            <Link to="/track">Track a token</Link>
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
          <AlertTitle>Waiting for payment confirmation</AlertTitle>
          <AlertDescription>
            Your booking is <strong>not confirmed yet</strong>. It is confirmed only after the
            hospital’s server verifies the payment.{' '}
            {b.hold_expires_at && <>Your slot is held until {formatDateTime(b.hold_expires_at)}.</>}
          </AlertDescription>
        </Alert>
      ) : b.status === 'CANCELLED' ? (
        <Alert variant="destructive">
          <Info aria-hidden />
          <AlertTitle>This booking is cancelled</AlertTitle>
          <AlertDescription>{b.cancel_reason}</AlertDescription>
        </Alert>
      ) : (
        <div className="flex items-center gap-3">
          <CheckCircle2 className="size-8 text-success" aria-hidden />
          <div>
            <h1 className="text-xl font-semibold">Token booked</h1>
            <p className="text-sm text-muted-foreground">Booking reference {b.booking_reference}</p>
          </div>
        </div>
      )}

      <TokenHero booking={b} />

      {accessKey && <ShareTrackingLink reference={b.booking_reference} accessKey={accessKey} />}

      <QueueProgress booking={b} />
      <BookingDetails booking={b} />

      <Alert>
        <Info aria-hidden />
        <AlertTitle>When you visit</AlertTitle>
        <AlertDescription>
          <ul className="list-disc space-y-1 pl-4">
            <li>
              {b.hospital.visit_instructions ??
                'Check in at the OPD reception desk with your token number.'}
            </li>
            <li>
              Watch the live queue and arrive before your turn. If you are not present when called,
              your token is skipped and can be recalled at the desk.
            </li>
            <li>Bring a photo ID and any previous prescriptions or reports.</li>
          </ul>
        </AlertDescription>
      </Alert>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild size="lg" className="flex-1">
          <Link to={trackHref}>Track my token</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="flex-1">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    </div>
  )
}
