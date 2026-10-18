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
import { BookingAlertsCard } from '@/components/booking-alerts'
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
import { WhatsAppUpdatesCard } from '@/components/whatsapp-updates'
import { useAlertSettings, useAnnounceNotifications } from '@/hooks/useBookingAlerts'
import { LIVE_POLL_MS, useLiveQueue } from '@/hooks/useLiveQueue'
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { cancelBlockText } from '@/i18n/server-text'
import { errorMessage } from '@/lib/errors'
import type { BookingView } from '@/types/database'

const messages = defineMessages({
  en: {
    lookupTitle: 'Track your token',
    lookupDescription: 'Paste your tracking link, or open it directly from your messages.',
    invalidInput: 'Enter a booking reference like MQ-7K3P9XQ2 or paste the full tracking link.',
    inputLabel: 'Tracking link or booking reference',
    find: 'Find my booking',
    privacyBefore:
      'For privacy, a booking reference alone opens a booking only on the phone it was made from. Lookups by mobile number are not available. Booked on this phone? See',
    myBookings: 'My bookings',
    privacyAfter: '.',
    loadingToken: 'Loading your token',
    notFound: 'Booking not found',
    notFoundBody:
      'Check that you opened the complete tracking link (it ends with #k=…). A reference alone works only on the phone used for booking.',
    cancelledWithRefund:
      'Booking cancelled. A refund request has been recorded; its status will update once the payment provider confirms it.',
    cancelled: 'Booking cancelled.',
    refreshing: 'Refreshing',
    title: 'Token tracking',
    cancelThis: 'Cancel this booking',
    cancelTitle: 'Cancel token {token}?',
    cancelBody: 'Your token will be released for other patients. This cannot be undone.',
    cancelRefundNote:
      'A refund request will be recorded; refunds are confirmed only by the payment provider and follow the hospital’s policy.',
    reason: 'Reason (optional)',
    keep: 'Keep booking',
    cancelBooking: 'Cancel booking',
  },
  hi: {
    lookupTitle: 'अपना टोकन ट्रैक करें',
    lookupDescription: 'अपना ट्रैकिंग लिंक यहाँ पेस्ट करें, या उसे सीधे अपने मैसेज से खोलें।',
    invalidInput: 'MQ-7K3P9XQ2 जैसा बुकिंग नंबर लिखें या पूरा ट्रैकिंग लिंक पेस्ट करें।',
    inputLabel: 'ट्रैकिंग लिंक या बुकिंग नंबर',
    find: 'मेरी बुकिंग खोजें',
    privacyBefore:
      'निजता के लिए, सिर्फ़ बुकिंग नंबर से बुकिंग उसी फ़ोन पर ही खुलती है जिससे वह की गई थी। मोबाइल नंबर से बुकिंग नहीं खोजी जा सकती। इसी फ़ोन से बुक किया था?',
    myBookings: 'मेरी बुकिंग',
    privacyAfter: ' देखें।',
    loadingToken: 'आपका टोकन लोड हो रहा है',
    notFound: 'बुकिंग नहीं मिली',
    notFoundBody:
      'जाँचें कि आपने पूरा ट्रैकिंग लिंक खोला है (उसके अंत में #k=… होता है)। सिर्फ़ बुकिंग नंबर उसी फ़ोन पर ही काम करता है जिससे बुकिंग की गई थी।',
    cancelledWithRefund:
      'बुकिंग रद्द हो गई। रिफ़ंड का अनुरोध दर्ज कर लिया गया है; भुगतान प्रदाता की पुष्टि होने पर इसकी स्थिति अपडेट होगी।',
    cancelled: 'बुकिंग रद्द हो गई।',
    refreshing: 'रीफ़्रेश हो रहा है',
    title: 'टोकन ट्रैकिंग',
    cancelThis: 'यह बुकिंग रद्द करें',
    cancelTitle: 'टोकन {token} रद्द करें?',
    cancelBody: 'आपका टोकन दूसरे मरीज़ों के लिए छोड़ दिया जाएगा। इसे वापस नहीं किया जा सकता।',
    cancelRefundNote:
      'रिफ़ंड का अनुरोध दर्ज किया जाएगा; रिफ़ंड की पुष्टि केवल भुगतान प्रदाता करता है और यह अस्पताल की नीति के अनुसार होता है।',
    reason: 'कारण (वैकल्पिक)',
    keep: 'बुकिंग रखें',
    cancelBooking: 'बुकिंग रद्द करें',
  },
})

// Bookings that can still produce "turn near" / "called" alerts.
const ALERTABLE: BookingView['status'][] = [
  'PAYMENT_PENDING',
  'BOOKED',
  'CONFIRMED',
  'ARRIVED',
  'WAITING',
  'SKIPPED',
]

export function TrackPage() {
  const { reference } = useParams()
  return reference ? <TrackView reference={reference.toUpperCase()} /> : <TrackLookup />
}

function TrackLookup() {
  const t = useT(messages)
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [invalid, setInvalid] = useState(false)

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title={t('lookupTitle')} description={t('lookupDescription')} />
      <Card>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              const parsed = parseTrackingInput(input)
              if (!parsed) {
                setInvalid(true)
                return
              }
              navigate(`/track/${parsed.reference}${parsed.key ? `#k=${parsed.key}` : ''}`)
            }}
          >
            <Label htmlFor="track-input">{t('inputLabel')}</Label>
            <Input
              id="track-input"
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setInvalid(false)
              }}
              placeholder="https://…/track/MQ-…#k=…"
              autoComplete="off"
            />
            {invalid && <p className="text-sm text-destructive">{t('invalidInput')}</p>}
            <Button type="submit" className="w-full">
              <Search /> {t('find')}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            {t('privacyBefore')}{' '}
            <Link to="/my-appointments" className="text-primary underline">
              {t('myBookings')}
            </Link>
            {t('privacyAfter')}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function TrackView({ reference }: { reference: string }) {
  const t = useT(messages)
  const c = useT(common)
  const { hash } = useLocation()
  const accessKey = keyFromHash(hash)
  const queryClient = useQueryClient()
  const queryKey = ['booking', reference, accessKey]

  const booking = useQuery({ queryKey, queryFn: () => getBooking(reference, accessKey) })

  if (booking.isPending) return <PageSpinner label={t('loadingToken')} />
  if (booking.isError && !booking.data)
    return <ErrorState error={booking.error} onRetry={() => booking.refetch()} />
  if (!booking.data) {
    return (
      <EmptyState
        title={t('notFound')}
        description={t('notFoundBody')}
        action={
          <Button asChild>
            <Link to="/track">{c('tryAgain')}</Link>
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
  const t = useT(messages)
  const queryClient = useQueryClient()
  const queryKey = ['booking', reference, accessKey]
  const live = useLiveQueue({
    channelKey: `track:${reference}`,
    filter: `id=eq.${queueStateId}`,
    queryKeys: [queryKey],
  })
  const alerts = useAlertSettings(reference)
  const booking = useQuery({
    queryKey,
    queryFn: () => getBooking(reference, accessKey),
    // With alerts on, keep checking (once a minute) while the page is in the background.
    refetchInterval: () =>
      document.visibilityState === 'hidden' ? LIVE_POLL_MS : live.refetchInterval,
    refetchIntervalInBackground: alerts.enabled,
  })
  useAnnounceNotifications(booking.data ?? undefined, reference, alerts.enabled)

  const [reason, setReason] = useState('')
  const cancel = useMutation({
    mutationFn: () => cancelBooking(reference, accessKey, reason.trim() || null),
    onSuccess: (res) => {
      toast.success(res.refund_requested ? t('cancelledWithRefund') : t('cancelled'))
      void queryClient.invalidateQueries({ queryKey })
      onChanged()
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const data = booking.data
  if (!data) return <PageSpinner label={t('refreshing')} />

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <LiveIndicator status={live.status} updatedAt={booking.dataUpdatedAt} />
      </div>
      <TokenHero booking={data} />
      <QueueProgress booking={data} />
      {ALERTABLE.includes(data.status) && <BookingAlertsCard alerts={alerts} />}
      {(ALERTABLE.includes(data.status) || data.whatsapp?.enabled) && (
        <WhatsAppUpdatesCard booking={data} accessKey={accessKey} />
      )}
      <NotificationsList booking={data} />
      <BookingDetails booking={data} />

      {data.can_cancel ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-full text-destructive">
              {t('cancelThis')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('cancelTitle', { token: data.token_no ?? '' })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('cancelBody')}
                {data.payment?.status === 'CAPTURED' && ` ${t('cancelRefundNote')}`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">{t('reason')}</Label>
              <Textarea
                id="cancel-reason"
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('keep')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {t('cancelBooking')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        data.cancel_block_reason &&
        data.status !== 'CANCELLED' &&
        data.status !== 'COMPLETED' && (
          <p className="text-center text-sm text-muted-foreground">
            {cancelBlockText(data.cancel_block_reason)}
          </p>
        )
      )}
    </div>
  )
}
