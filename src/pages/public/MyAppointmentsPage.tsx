import { useMutation, useQuery } from '@tanstack/react-query'
import { Link2 } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { getMyAppointments, rotateAccessKey, trackingUrl } from '@/api/bookings'
import { useAuth } from '@/auth/AuthProvider'
import { AppointmentStatusBadge } from '@/components/badges'
import { CardSkeletons, EmptyState, ErrorState, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { defineMessages, useT } from '@/i18n'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatTimeRange } from '@/lib/format'

const messages = defineMessages({
  en: {
    linkCopied: 'New tracking link copied. Older links for this booking no longer work.',
    title: 'My bookings',
    deviceDescription:
      'Bookings made on this phone. Clearing browser data removes this list — keep your tracking links.',
    accountDescription: 'Bookings linked to your account.',
    empty: 'No bookings on this device',
    emptyBody: 'Booked on another phone? Open the tracking link you saved.',
    bookToken: 'Book a token',
    token: 'Token',
    track: 'Track',
    newLinkTitle: 'Create a new private link to open this booking on another phone',
    newLink: 'New link',
    saveBefore: 'Want your bookings on another device?',
    saveLink: 'Save them to an account',
    saveAfter: '.',
  },
  hi: {
    linkCopied: 'नया ट्रैकिंग लिंक कॉपी हो गया। इस बुकिंग के पुराने लिंक अब काम नहीं करेंगे।',
    title: 'मेरी बुकिंग',
    deviceDescription:
      'इस फ़ोन से की गई बुकिंग। ब्राउज़र डेटा मिटाने पर यह सूची हट जाती है — अपने ट्रैकिंग लिंक संभालकर रखें।',
    accountDescription: 'आपके खाते से जुड़ी बुकिंग।',
    empty: 'इस डिवाइस पर कोई बुकिंग नहीं',
    emptyBody: 'किसी दूसरे फ़ोन से बुक किया था? सहेजा हुआ ट्रैकिंग लिंक खोलें।',
    bookToken: 'टोकन बुक करें',
    token: 'टोकन',
    track: 'ट्रैक करें',
    newLinkTitle: 'दूसरे फ़ोन पर यह बुकिंग खोलने के लिए नया निजी लिंक बनाएँ',
    newLink: 'नया लिंक',
    saveBefore: 'अपनी बुकिंग दूसरे डिवाइस पर भी देखना चाहते हैं?',
    saveLink: 'उन्हें खाते में सहेजें',
    saveAfter: '।',
  },
})

export function MyAppointmentsPage() {
  const t = useT(messages)
  const auth = useAuth()
  const list = useQuery({
    queryKey: ['my-appointments', auth.userId],
    queryFn: getMyAppointments,
    enabled: !auth.loading,
  })
  const rotate = useMutation({
    mutationFn: async (reference: string) => {
      const key = await rotateAccessKey(reference)
      const url = trackingUrl(reference, key)
      await navigator.clipboard?.writeText(url).catch(() => {})
      return url
    },
    onSuccess: () => toast.success(t('linkCopied')),
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t('title')}
        description={
          auth.isAnonymous || !auth.session ? t('deviceDescription') : t('accountDescription')
        }
      />
      {list.isPending ? (
        <CardSkeletons count={2} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState
          title={t('empty')}
          description={t('emptyBody')}
          action={
            <Button asChild>
              <Link to="/doctors?available=1">{t('bookToken')}</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {list.data.map((b) => (
            <Card key={b.booking_reference} className="py-4">
              <CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl bg-accent">
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {t('token')}
                    </span>
                    <span className="text-xl font-bold tabular">{b.token_no ?? '–'}</span>
                  </div>
                  <div>
                    <p className="font-medium">{b.doctor.full_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatDate(b.session_date)} · {b.shift.name},{' '}
                      {formatTimeRange(b.shift.start_time, b.shift.end_time)}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <AppointmentStatusBadge status={b.status} />
                      <span className="font-mono text-xs text-muted-foreground">
                        {b.booking_reference}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button asChild size="sm">
                    <Link to={`/track/${b.booking_reference}`}>{t('track')}</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rotate.isPending}
                    onClick={() => rotate.mutate(b.booking_reference)}
                    title={t('newLinkTitle')}
                  >
                    <Link2 /> {t('newLink')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-6 text-sm text-muted-foreground">
        {t('saveBefore')}{' '}
        <Link to="/account" className="text-primary underline">
          {t('saveLink')}
        </Link>
        {t('saveAfter')}
      </p>
    </div>
  )
}
