import { useMutation } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Loader2, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { fetchReportRows, type ReportKind } from '@/api/admin'
import { PageHeader, PageSpinner } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useHospital } from '@/hooks/useHospital'
import { defineMessages, useT } from '@/i18n'
import { downloadCsv, toCsv, type CsvColumn } from '@/lib/csv'
import { errorMessage } from '@/lib/errors'
import { addDays, todayInIST } from '@/lib/format'
import { cn } from '@/lib/utils'

const messages = defineMessages({
  en: {
    title: 'Reports & exports',
    description:
      'Download CSV files for spreadsheets and record keeping. Times are in the hospital timezone; amounts in rupees.',
    report: 'Report',
    'kind.appointments': 'Appointments',
    'kind.appointments.help': 'One row per booking: token, status, timings, fee and payment.',
    'kind.daily_summary': 'Daily OPD summary',
    'kind.daily_summary.help':
      'One row per doctor session: tokens, completed, cancelled, no-shows, waiting time, fees.',
    'kind.payments': 'Online payments',
    'kind.payments.help': 'One row per Razorpay payment created in the period.',
    'kind.refunds': 'Refunds',
    'kind.refunds.help': 'One row per refund request, including automatic refunds.',
    'kind.audit': 'Audit log',
    'kind.audit.help':
      'Every recorded action. Export before removing entries older than 90 days (docs/operations.md).',
    period: 'Period',
    from: 'From',
    to: 'To',
    last7: 'Last 7 days',
    last30: 'Last 30 days',
    thisMonth: 'This month',
    lastMonth: 'Last month',
    includePatient: 'Include patient name, mobile number and age',
    piiTitle: 'Contains personal data',
    piiBody:
      'Store the file securely, share it only with people who need it, and delete it when no longer needed.',
    download: 'Download CSV',
    fetching: 'Fetching… {count} rows',
    done: 'Downloaded {count} row|Downloaded {count} rows',
    empty: 'No rows for this period.',
    truncated: 'Only the first {count} rows were exported. Choose a shorter period for the rest.',
    rangeError: 'Choose a start date on or before the end date (at most one year).',
    auditNote:
      'Each export is recorded in the audit log (report, period, and whether patient details were included). Column names stay in English so spreadsheets and imports keep working.',
  },
  hi: {
    title: 'रिपोर्ट और एक्सपोर्ट',
    description:
      'स्प्रेडशीट और रिकॉर्ड के लिए CSV फ़ाइलें डाउनलोड करें। समय अस्पताल के टाइमज़ोन में और राशि रुपये में है।',
    report: 'रिपोर्ट',
    'kind.appointments': 'अपॉइंटमेंट',
    'kind.appointments.help': 'हर बुकिंग की एक पंक्ति: टोकन, स्थिति, समय, शुल्क और भुगतान।',
    'kind.daily_summary': 'दैनिक ओपीडी सारांश',
    'kind.daily_summary.help':
      'हर डॉक्टर सत्र की एक पंक्ति: टोकन, पूरे हुए, रद्द, न आए मरीज़, प्रतीक्षा समय, शुल्क।',
    'kind.payments': 'ऑनलाइन भुगतान',
    'kind.payments.help': 'इस अवधि में बने हर Razorpay भुगतान की एक पंक्ति।',
    'kind.refunds': 'रिफ़ंड',
    'kind.refunds.help': 'हर रिफ़ंड अनुरोध की एक पंक्ति, स्वचालित रिफ़ंड सहित।',
    'kind.audit': 'ऑडिट लॉग',
    'kind.audit.help':
      'हर दर्ज कार्रवाई। 90 दिन से पुरानी प्रविष्टियाँ हटाने से पहले एक्सपोर्ट करें (docs/operations.md)।',
    period: 'अवधि',
    from: 'से',
    to: 'तक',
    last7: 'पिछले 7 दिन',
    last30: 'पिछले 30 दिन',
    thisMonth: 'इस महीने',
    lastMonth: 'पिछले महीने',
    includePatient: 'मरीज़ का नाम, मोबाइल नंबर और उम्र शामिल करें',
    piiTitle: 'इसमें व्यक्तिगत जानकारी है',
    piiBody:
      'फ़ाइल सुरक्षित रखें, केवल ज़रूरतमंद लोगों से साझा करें, और ज़रूरत ख़त्म होने पर हटा दें।',
    download: 'CSV डाउनलोड करें',
    fetching: 'ला रहे हैं… {count} पंक्तियाँ',
    done: '{count} पंक्ति डाउनलोड हुई|{count} पंक्तियाँ डाउनलोड हुईं',
    empty: 'इस अवधि के लिए कोई पंक्ति नहीं है।',
    truncated: 'केवल पहली {count} पंक्तियाँ एक्सपोर्ट हुईं। बाकी के लिए छोटी अवधि चुनें।',
    rangeError: 'शुरुआती तारीख़ अंतिम तारीख़ से पहले या उसी दिन चुनें (अधिकतम एक वर्ष)।',
    auditNote:
      'हर एक्सपोर्ट ऑडिट लॉग में दर्ज होता है (रिपोर्ट, अवधि, और क्या मरीज़ की जानकारी शामिल थी)। कॉलम के नाम अंग्रेज़ी में रहते हैं ताकि स्प्रेडशीट और इम्पोर्ट ठीक चलें।',
  },
})

const KINDS: ReportKind[] = ['appointments', 'daily_summary', 'payments', 'refunds', 'audit']

// Column order and headers of each CSV (keys match public.admin_export).
const COLUMNS: Record<ReportKind, CsvColumn[]> = {
  appointments: [
    { key: 'session_date', header: 'Session date' },
    { key: 'session', header: 'Session' },
    { key: 'doctor', header: 'Doctor' },
    { key: 'department', header: 'Department' },
    { key: 'token_no', header: 'Token' },
    { key: 'booking_reference', header: 'Booking reference' },
    { key: 'source', header: 'Source' },
    { key: 'status', header: 'Status' },
    { key: 'payment_mode', header: 'Payment mode' },
    { key: 'fee_rupees', header: 'Fee (Rs)' },
    { key: 'payment_status', header: 'Payment status' },
    { key: 'refund_status', header: 'Refund status' },
    { key: 'booked_at', header: 'Booked at' },
    { key: 'arrived_at', header: 'Checked in at' },
    { key: 'called_at', header: 'Called at' },
    { key: 'completed_at', header: 'Completed at' },
    { key: 'cancelled_at', header: 'Cancelled at' },
    { key: 'cancel_reason', header: 'Cancel reason' },
    { key: 'wait_minutes', header: 'Wait (min)' },
    { key: 'consult_minutes', header: 'Consultation (min)' },
  ],
  daily_summary: [
    { key: 'session_date', header: 'Session date' },
    { key: 'doctor', header: 'Doctor' },
    { key: 'department', header: 'Department' },
    { key: 'session', header: 'Session' },
    { key: 'start_time', header: 'Starts' },
    { key: 'end_time', header: 'Ends' },
    { key: 'session_status', header: 'Session status' },
    { key: 'capacity', header: 'Capacity' },
    { key: 'tokens_issued', header: 'Tokens issued' },
    { key: 'online', header: 'Online' },
    { key: 'walk_in', header: 'Walk-in' },
    { key: 'completed', header: 'Completed' },
    { key: 'cancelled', header: 'Cancelled' },
    { key: 'no_show', header: 'No-show' },
    { key: 'avg_wait_minutes', header: 'Avg wait (min)' },
    { key: 'avg_consult_minutes', header: 'Avg consultation (min)' },
    { key: 'online_fees_rupees', header: 'Online fees (Rs)' },
    { key: 'refunded_rupees', header: 'Refunded (Rs)' },
    { key: 'delay_minutes', header: 'Delay (min)' },
  ],
  payments: [
    { key: 'created_at', header: 'Created at' },
    { key: 'booking_reference', header: 'Booking reference' },
    { key: 'session_date', header: 'Session date' },
    { key: 'doctor', header: 'Doctor' },
    { key: 'amount_rupees', header: 'Amount (Rs)' },
    { key: 'status', header: 'Status' },
    { key: 'mode', header: 'Mode' },
    { key: 'verified_via', header: 'Verified via' },
    { key: 'verified_at', header: 'Verified at' },
    { key: 'gateway_order_id', header: 'Razorpay order' },
    { key: 'gateway_payment_id', header: 'Razorpay payment' },
    { key: 'refund_status', header: 'Refund status' },
  ],
  refunds: [
    { key: 'requested_at', header: 'Requested at' },
    { key: 'booking_reference', header: 'Booking reference' },
    { key: 'session_date', header: 'Session date' },
    { key: 'amount_rupees', header: 'Amount (Rs)' },
    { key: 'status', header: 'Status' },
    { key: 'initiated_via', header: 'Started by' },
    { key: 'reason', header: 'Reason' },
    { key: 'gateway_refund_id', header: 'Razorpay refund' },
    { key: 'processed_at', header: 'Processed at' },
    { key: 'failure_reason', header: 'Failure reason' },
  ],
  audit: [
    { key: 'id', header: 'Entry' },
    { key: 'created_at', header: 'Time' },
    { key: 'actor_role', header: 'Role' },
    { key: 'actor_email', header: 'Staff email' },
    { key: 'action', header: 'Action' },
    { key: 'entity_type', header: 'Entity' },
    { key: 'entity_id', header: 'Entity id' },
    { key: 'details', header: 'Details' },
  ],
}

const PATIENT_COLUMNS: CsvColumn[] = [
  { key: 'patient_name', header: 'Patient name' },
  { key: 'patient_phone', header: 'Mobile' },
  { key: 'patient_age', header: 'Age' },
]

const firstOfMonth = (d: string) => `${d.slice(0, 8)}01`

function presetRange(preset: 'last7' | 'last30' | 'thisMonth' | 'lastMonth', today: string) {
  switch (preset) {
    case 'last7':
      return { from: addDays(today, -6), to: today }
    case 'last30':
      return { from: addDays(today, -29), to: today }
    case 'thisMonth':
      return { from: firstOfMonth(today), to: today }
    case 'lastMonth': {
      const end = addDays(firstOfMonth(today), -1)
      return { from: firstOfMonth(end), to: end }
    }
  }
}

export default function ReportsPage() {
  const { data: hospital } = useHospital()
  const t = useT(messages)
  const today = todayInIST()
  const [kind, setKind] = useState<ReportKind>('appointments')
  const [range, setRange] = useState(() => presetRange('last30', today))
  const [includePatient, setIncludePatient] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)

  const validRange =
    !!range.from && !!range.to && range.from <= range.to && addDays(range.from, 366) >= range.to
  const withPatient = kind === 'appointments' && includePatient

  const exportCsv = useMutation({
    mutationFn: async () => {
      setProgress(0)
      const { rows, truncated } = await fetchReportRows(hospital!.id, kind, range.from, range.to, {
        includePatient: withPatient,
        onProgress: setProgress,
      })
      if (rows.length) {
        const columns = withPatient ? [...COLUMNS[kind], ...PATIENT_COLUMNS] : COLUMNS[kind]
        downloadCsv(
          `mediqueue-${kind.replace('_', '-')}-${range.from}_to_${range.to}.csv`,
          toCsv(columns, rows),
        )
      }
      return { count: rows.length, truncated }
    },
    onSuccess: ({ count, truncated }) => {
      if (!count) toast.info(t('empty'))
      else if (truncated) toast.warning(t('truncated', { count }))
      else toast.success(t('done', { count }))
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setProgress(null),
  })

  if (!hospital) return <PageSpinner />

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('report')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-label={t('report')} className="grid gap-2 sm:grid-cols-2">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  kind === k && 'border-primary bg-primary/5',
                )}
              >
                <FileSpreadsheet
                  className={cn('mt-0.5 size-5 shrink-0', kind === k && 'text-primary')}
                  aria-hidden
                />
                <span>
                  <span className="block font-medium">{t(`kind.${k}`)}</span>
                  <span className="block text-sm text-muted-foreground">{t(`kind.${k}.help`)}</span>
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('period')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['last7', 'last30', 'thisMonth', 'lastMonth'] as const).map((p) => (
              <Button
                key={p}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setRange(presetRange(p, today))}
              >
                {t(p)}
              </Button>
            ))}
          </div>
          <div className="grid max-w-md grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="report-from">{t('from')}</Label>
              <Input
                id="report-from"
                type="date"
                value={range.from}
                max={today}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="report-to">{t('to')}</Label>
              <Input
                id="report-to"
                type="date"
                value={range.to}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              />
            </div>
          </div>
          {!validRange && <p className="text-sm text-destructive">{t('rangeError')}</p>}

          {kind === 'appointments' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={includePatient}
                  onCheckedChange={(v) => setIncludePatient(v === true)}
                />
                {t('includePatient')}
              </label>
              {includePatient && (
                <Alert variant="destructive">
                  <ShieldAlert aria-hidden />
                  <AlertTitle>{t('piiTitle')}</AlertTitle>
                  <AlertDescription>{t('piiBody')}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              disabled={!validRange || exportCsv.isPending}
              onClick={() => exportCsv.mutate()}
            >
              {exportCsv.isPending ? <Loader2 className="animate-spin" /> : <Download />}
              {t('download')}
            </Button>
            {progress !== null && (
              <span className="text-sm text-muted-foreground" role="status">
                {t('fetching', { count: progress })}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('auditNote')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
