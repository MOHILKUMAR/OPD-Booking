import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { fetchPayments, fetchRefunds, processRefund, rejectRefund } from '@/api/admin'
import { ToneBadge } from '@/components/badges'
import { EmptyState, ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useHospital } from '@/hooks/useHospital'
import { env } from '@/lib/env'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, formatMoney } from '@/lib/format'
import type { PaymentStatus, RefundStatus } from '@/types/database'

const PAYMENT_TONE: Record<PaymentStatus, 'green' | 'amber' | 'red' | 'grey' | 'blue'> = {
  CREATED: 'grey',
  AUTHORIZED: 'blue',
  CAPTURED: 'green',
  FAILED: 'red',
  REFUNDED: 'amber',
  PARTIALLY_REFUNDED: 'amber',
}
const REFUND_TONE: Record<RefundStatus, 'green' | 'amber' | 'red' | 'grey' | 'blue'> = {
  REQUESTED: 'amber',
  PROCESSING: 'blue',
  PROCESSED: 'green',
  FAILED: 'red',
  REJECTED: 'grey',
}

export default function PaymentsPage() {
  const { data: hospital } = useHospital()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(0)
  const payments = useQuery({
    queryKey: ['admin-payments', hospital?.id, page],
    queryFn: () => fetchPayments(hospital!.id, page * 25),
    enabled: !!hospital,
  })
  const refunds = useQuery({
    queryKey: ['admin-refunds', hospital?.id],
    queryFn: () => fetchRefunds(hospital!.id),
    enabled: !!hospital,
  })
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-refunds'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-payments'] })
  }

  const process = useMutation({
    mutationFn: processRefund,
    onSuccess: (r) => {
      toast.success(
        r.status === 'PROCESSED'
          ? 'Refund processed by Razorpay.'
          : 'Refund submitted. Status updates when Razorpay confirms it.',
      )
      refresh()
    },
    onError: (e) => {
      toast.error(errorMessage(e))
      refresh()
    },
  })
  const reject = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => rejectRefund(id, why),
    onSuccess: () => {
      setRejecting(null)
      setReason('')
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  const onlineOn = hospital?.online_payments_enabled && env.VITE_PAYMENTS_ENABLED

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments & refunds"
        description="Payment status comes only from server-side verification and signed Razorpay webhooks."
      />
      {!onlineOn && (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>Online payments are off</AlertTitle>
          <AlertDescription>
            Bookings with a fee are marked “pay at hospital”. To enable Razorpay (test mode first),
            turn on the hospital setting, set VITE_PAYMENTS_ENABLED, and set the PAYMENTS_ENABLED
            and Razorpay secrets on the Edge Functions. See docs/deployment.md.
          </AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue="refunds">
        <TabsList>
          <TabsTrigger value="refunds">
            Refunds{refunds.data?.some((r) => r.status === 'REQUESTED') ? ' •' : ''}
          </TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
        </TabsList>
        <TabsContent value="refunds" className="mt-4">
          {refunds.isPending ? (
            <PageSpinner />
          ) : refunds.isError ? (
            <ErrorState error={refunds.error} onRetry={() => refunds.refetch()} />
          ) : refunds.data.length === 0 ? (
            <EmptyState title="No refund requests" />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Requested</TableHead>
                    <TableHead>Booking</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {refunds.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(r.requested_at)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.appointment?.booking_reference}
                      </TableCell>
                      <TableCell>{formatMoney(r.amount_paise)}</TableCell>
                      <TableCell className="max-w-xs">
                        {r.reason}
                        {r.failure_reason && (
                          <span className="block text-xs text-destructive">{r.failure_reason}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <ToneBadge color={REFUND_TONE[r.status]}>{r.status}</ToneBadge>
                      </TableCell>
                      <TableCell className="space-x-2 whitespace-nowrap text-right">
                        {(r.status === 'REQUESTED' || r.status === 'FAILED') && (
                          <>
                            <Button
                              size="sm"
                              disabled={process.isPending || !onlineOn}
                              onClick={() => process.mutate(r.id)}
                            >
                              Refund via Razorpay
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setRejecting(r.id)}>
                              Reject
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          {payments.isPending ? (
            <PageSpinner />
          ) : payments.isError ? (
            <ErrorState error={payments.error} onRetry={() => payments.refetch()} />
          ) : payments.data.rows.length === 0 ? (
            <EmptyState title="No payments yet" />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Created</TableHead>
                      <TableHead>Booking</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Verified</TableHead>
                      <TableHead>Gateway ids</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.data.rows.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="whitespace-nowrap">
                          {formatDateTime(p.created_at)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.appointment?.booking_reference}
                        </TableCell>
                        <TableCell>{formatMoney(p.amount_paise)}</TableCell>
                        <TableCell>
                          {p.gateway_mode === 'test' ? (
                            <ToneBadge color="amber">test</ToneBadge>
                          ) : (
                            'live'
                          )}
                        </TableCell>
                        <TableCell>
                          <ToneBadge color={PAYMENT_TONE[p.status]}>{p.status}</ToneBadge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {p.verified_via
                            ? `${p.verified_via} · ${formatDateTime(p.verified_at!)}`
                            : '–'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.gateway_order_id}
                          <br />
                          {p.gateway_payment_id}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-3 flex justify-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(page + 1) * 25 >= payments.data.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject refund request</DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Reason (shown to the patient and kept in the audit log)"
          />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || reject.isPending}
              onClick={() => rejecting && reject.mutate({ id: rejecting, why: reason.trim() })}
            >
              Reject refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
