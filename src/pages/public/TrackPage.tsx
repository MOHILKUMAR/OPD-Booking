import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { cancelBooking, getBooking, keyFromHash, parseTrackingInput } from '@/api/bookings'
import {
  BookingDetails,
  NotificationsList,
  QueueProgress,
  TokenHero,
} from '@/components/booking-view'
import { EmptyState, ErrorState, LiveIndicator, PageHeader, PageSpinner } from '@/components/states'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useLiveQueue } from '@/hooks/useLiveQueue'
import { errorMessage } from '@/lib/errors'

export function TrackPage() {
  const { reference } = useParams()
  return reference ? <TrackView reference={reference.toUpperCase()} /> : <TrackLookup />
}

function TrackLookup() {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Track your token"
        description="Paste your tracking link, or open it directly from your messages."
      />
      <Card>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              const parsed = parseTrackingInput(input)
              if (!parsed) {
                setError(
                  'Enter a booking reference like MQ-7K3P9XQ2 or paste the full tracking link.',
                )
                return
              }
              navigate(`/track/${parsed.reference}${parsed.key ? `#k=${parsed.key}` : ''}`)
            }}
          >
            <Label htmlFor="track-input">Tracking link or booking reference</Label>
            <Input
              id="track-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setError(null)
              }}
              placeholder="https://…/track/MQ-…#k=…"
              autoComplete="off"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">
              <Search /> Find my booking
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            For privacy, a booking reference alone opens a booking only on the phone it was made
            from. Lookups by mobile number are not available. Booked on this phone? See{' '}
            <Link to="/my-appointments" className="text-primary underline">
              My bookings
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function TrackView({ reference }: { reference: string }) {
  const { hash } = useLocation()
  const accessKey = keyFromHash(hash)
  const queryClient = useQueryClient()
  const queryKey = ['booking', reference, accessKey]

  const booking = useQuery({ queryKey, queryFn: () => getBooking(reference, accessKey) })

  if (booking.isPending) return <PageSpinner label="Loading your token" />
  if (booking.isError && !booking.data)
    return <ErrorState error={booking.error} onRetry={() => booking.refetch()} />
  if (!booking.data) {
    return (
      <EmptyState
        title="Booking not found"
        description="Check that you opened the complete tracking link (it ends with #k=…). A reference alone works only on the phone used for booking."
        action={
          <Button asChild>
            <Link to="/track">Try again</Link>
          </Button>
        }
      />
    )
  }
  return (
    <LiveTrackView
      reference={reference}
      accessKey={accessKey}
      queueStateId={booking.data.queue.queue_state_id}
      onChanged={() => void queryClient.invalidateQueries({ queryKey: ['my-appointments'] })}
    />
  )
}

/** Mounted once the booking is known: subscribes to its session and polls as a fallback. */
function LiveTrackView({
  reference,
  accessKey,
  queueStateId,
  onChanged,
}: {
  reference: string
  accessKey: string | null
  queueStateId: string
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const queryKey = ['booking', reference, accessKey]
  const live = useLiveQueue({
    channelKey: `track:${reference}`,
    filter: `id=eq.${queueStateId}`,
    queryKeys: [queryKey],
  })
  const booking = useQuery({
    queryKey,
    queryFn: () => getBooking(reference, accessKey),
    refetchInterval: live.refetchInterval,
  })

  const [reason, setReason] = useState('')
  const cancel = useMutation({
    mutationFn: () => cancelBooking(reference, accessKey, reason.trim() || null),
    onSuccess: (res) => {
      toast.success(
        res.refund_requested
          ? 'Booking cancelled. A refund request has been recorded; its status will update once the payment provider confirms it.'
          : 'Booking cancelled.',
      )
      void queryClient.invalidateQueries({ queryKey })
      onChanged()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const data = booking.data
  if (!data) return <PageSpinner label="Refreshing" />

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Token tracking</h1>
        <LiveIndicator status={live.status} updatedAt={booking.dataUpdatedAt} />
      </div>
      <TokenHero booking={data} />
      <QueueProgress booking={data} />
      <NotificationsList items={data.notifications} />
      <BookingDetails booking={data} />

      {data.can_cancel ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-full text-destructive">
              Cancel this booking
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel token {data.token_no ?? ''}?</AlertDialogTitle>
              <AlertDialogDescription>
                Your token will be released for other patients. This cannot be undone.
                {data.payment?.status === 'CAPTURED' &&
                  ' A refund request will be recorded; refunds are confirmed only by the payment provider and follow the hospital’s policy.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">Reason (optional)</Label>
              <Textarea
                id="cancel-reason"
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep booking</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                Cancel booking
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        data.cancel_block_reason &&
        data.status !== 'CANCELLED' &&
        data.status !== 'COMPLETED' && (
          <p className="text-center text-sm text-muted-foreground">{data.cancel_block_reason}</p>
        )
      )}
    </div>
  )
}
