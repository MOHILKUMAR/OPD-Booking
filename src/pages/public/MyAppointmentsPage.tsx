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
import { errorMessage } from '@/lib/errors'
import { formatDate, formatTimeRange } from '@/lib/format'

export function MyAppointmentsPage() {
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
    onSuccess: () =>
      toast.success('New tracking link copied. Older links for this booking no longer work.'),
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="My bookings"
        description={
          auth.isAnonymous || !auth.session
            ? 'Bookings made on this phone. Clearing browser data removes this list — keep your tracking links.'
            : 'Bookings linked to your account.'
        }
      />
      {list.isPending ? (
        <CardSkeletons count={2} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState
          title="No bookings on this device"
          description="Booked on another phone? Open the tracking link you saved."
          action={
            <Button asChild>
              <Link to="/doctors?available=1">Book a token</Link>
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
                    <span className="text-[10px] uppercase text-muted-foreground">Token</span>
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
                    <Link to={`/track/${b.booking_reference}`}>Track</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rotate.isPending}
                    onClick={() => rotate.mutate(b.booking_reference)}
                    title="Create a new private link to open this booking on another phone"
                  >
                    <Link2 /> New link
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-6 text-sm text-muted-foreground">
        Want your bookings on another device?{' '}
        <Link to="/account" className="text-primary underline">
          Save them to an account
        </Link>
        .
      </p>
    </div>
  )
}
