import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
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
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { env } from '@/lib/env'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, formatMoney } from '@/lib/format'
import type { PaymentStatus, RefundStatus } from '@/types/database'

const messages = defineMessages({
  en: {
    refundProcessed: 'Refund processed by Razorpay.',
    refundSubmitted: 'Refund submitted. Status updates when Razorpay confirms it.',
    title: 'Payments & refunds',
    description:
      'Payment status comes only from server-side verification and signed Razorpay webhooks.',
    offTitle: 'Online payments are off',
    offBody:
      'Bookings with a fee are marked “pay at hospital”. To enable Razorpay (test mode first), turn on the hospital setting, set VITE_PAYMENTS_ENABLED, and set the PAYMENTS_ENABLED and Razorpay secrets on the Edge Functions. See docs/deployment.md.',
    autoOnUpTo:
      'Automatic refunds are on for refunds up to {amount}; larger ones wait here for review.',
    autoOn: 'Automatic refunds are on: requests are sent to Razorpay within about a minute.',
    autoOff: 'Automatic refunds are off: every refund request waits here for review.',
    changeInSettings: 'Change in Hospital settings',
    refunds: 'Refunds',
    payments: 'Payments',
    noRefunds: 'No refund requests',
    requested: 'Requested',
    booking: 'Booking',
    amount: 'Amount',
    reason: 'Reason',
    status: 'Status',
    auto: 'auto',
    refundViaRazorpay: 'Refund via Razorpay',
    reject: 'Reject',
    noPayments: 'No payments yet',
    created: 'Created',
    mode: 'Mode',
    verified: 'Verified',
    gatewayIds: 'Gateway ids',
    live: 'live',
    rejectTitle: 'Reject refund request',
    rejectPlaceholder: 'Reason (shown to the patient and kept in the audit log)',
    rejectRefund: 'Reject refund',
  },
  hi: {
    refundProcessed: 'Razorpay ने रिफ़ंड प्रोसेस कर दिया।',
    refundSubmitted: 'रिफ़ंड भेज दिया गया। Razorpay की पुष्टि होने पर स्थिति अपडेट होगी।',
    title: 'भुगतान और रिफ़ंड',
    description:
      'भुगतान की स्थिति केवल सर्वर पर हुई जाँच और Razorpay के हस्ताक्षरित वेबहुक से तय होती है।',
    offTitle: 'ऑनलाइन भुगतान बंद है',
    offBody:
      'शुल्क वाली बुकिंग पर “अस्पताल में भुगतान करें” लिखा जाता है। Razorpay चालू करने के लिए (पहले टेस्ट मोड में), अस्पताल सेटिंग चालू करें, VITE_PAYMENTS_ENABLED सेट करें, और Edge Functions पर PAYMENTS_ENABLED और Razorpay सीक्रेट सेट करें। docs/deployment.md देखें।',
    autoOnUpTo:
      '{amount} तक के रिफ़ंड के लिए स्वचालित रिफ़ंड चालू है; इससे बड़े रिफ़ंड समीक्षा के लिए यहीं रुकते हैं।',
    autoOn: 'स्वचालित रिफ़ंड चालू है: अनुरोध लगभग एक मिनट में Razorpay को भेजे जाते हैं।',
    autoOff: 'स्वचालित रिफ़ंड बंद है: हर रिफ़ंड अनुरोध समीक्षा के लिए यहीं रुकता है।',
    changeInSettings: 'अस्पताल सेटिंग्स में बदलें',
    refunds: 'रिफ़ंड',
    payments: 'भुगतान',
    noRefunds: 'कोई रिफ़ंड अनुरोध नहीं',
    requested: 'अनुरोध का समय',
    booking: 'बुकिंग',
    amount: 'राशि',
    reason: 'कारण',
    status: 'स्थिति',
    auto: 'स्वचालित',
    refundViaRazorpay: 'Razorpay से रिफ़ंड करें',
    reject: 'अस्वीकार करें',
    noPayments: 'अभी कोई भुगतान नहीं',
    created: 'बनने का समय',
    mode: 'मोड',
    verified: 'सत्यापन',
    gatewayIds: 'गेटवे आईडी',
    live: 'लाइव',
    rejectTitle: 'रिफ़ंड अनुरोध अस्वीकार करें',
    rejectPlaceholder: 'कारण (मरीज़ को दिखेगा और ऑडिट लॉग में रहेगा)',
    rejectRefund: 'रिफ़ंड अस्वीकार करें',
  },
})

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
  const t = useT(messages)
  const c = useT(common)
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
      toast.success(r.status === 'PROCESSED' ? t('refundProcessed') : t('refundSubmitted'))
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
      <PageHeader title={t('title')} description={t('description')} />
      {!onlineOn && (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>{t('offTitle')}</AlertTitle>
          <AlertDescription>{t('offBody')}</AlertDescription>
        </Alert>
      )}
      {onlineOn && (
        <p className="text-sm text-muted-foreground">
          {hospital?.auto_refund_enabled
            ? hospital.auto_refund_max_paise
              ? t('autoOnUpTo', { amount: formatMoney(hospital.auto_refund_max_paise) })
              : t('autoOn')
            : t('autoOff')}{' '}
          <Link to="/admin/settings" className="underline underline-offset-2">
            {t('changeInSettings')}
          </Link>
        </p>
      )}
      <Tabs defaultValue="refunds">
        <TabsList>
          <TabsTrigger value="refunds">
            {t('refunds')}
            {refunds.data?.some((r) => r.status === 'REQUESTED') ? ' •' : ''}
          </TabsTrigger>
          <TabsTrigger value="payments">{t('payments')}</TabsTrigger>
        </TabsList>
        <TabsContent value="refunds" className="mt-4">
          {refunds.isPending ? (
            <PageSpinner />
          ) : refunds.isError ? (
            <ErrorState error={refunds.error} onRetry={() => refunds.refetch()} />
          ) : refunds.data.length === 0 ? (
            <EmptyState title={t('noRefunds')} />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('requested')}</TableHead>
                    <TableHead>{t('booking')}</TableHead>
                    <TableHead>{t('amount')}</TableHead>
                    <TableHead>{t('reason')}</TableHead>
                    <TableHead>{t('status')}</TableHead>
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
                      <TableCell className="space-x-1 whitespace-nowrap">
                        <ToneBadge color={REFUND_TONE[r.status]}>
                          {c(`refund.${r.status}`)}
                        </ToneBadge>
                        {r.initiated_via === 'AUTO' && (
                          <ToneBadge color="teal">{t('auto')}</ToneBadge>
                        )}
                      </TableCell>
                      <TableCell className="space-x-2 whitespace-nowrap text-right">
                        {(r.status === 'REQUESTED' || r.status === 'FAILED') && (
                          <>
                            <Button
                              size="sm"
                              disabled={process.isPending || !onlineOn}
                              onClick={() => process.mutate(r.id)}
                            >
                              {t('refundViaRazorpay')}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setRejecting(r.id)}>
                              {t('reject')}
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
            <EmptyState title={t('noPayments')} />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('created')}</TableHead>
                      <TableHead>{t('booking')}</TableHead>
                      <TableHead>{t('amount')}</TableHead>
                      <TableHead>{t('mode')}</TableHead>
                      <TableHead>{t('status')}</TableHead>
                      <TableHead>{t('verified')}</TableHead>
                      <TableHead>{t('gatewayIds')}</TableHead>
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
                            <ToneBadge color="amber">{c('test')}</ToneBadge>
                          ) : (
                            t('live')
                          )}
                        </TableCell>
                        <TableCell>
                          <ToneBadge color={PAYMENT_TONE[p.status]}>
                            {c(`payment.${p.status}`)}
                          </ToneBadge>
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
                  {c('previous')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(page + 1) * 25 >= payments.data.total}
                  onClick={() => setPage(page + 1)}
                >
                  {c('next')}
                </Button>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('rejectTitle')}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={t('rejectPlaceholder')}
          />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={reason.trim().length < 3 || reject.isPending}
              onClick={() => rejecting && reject.mutate({ id: rejecting, why: reason.trim() })}
            >
              {t('rejectRefund')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
