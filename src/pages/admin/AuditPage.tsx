import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { fetchAuditLogs } from '@/api/admin'
import { EmptyState, ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useHospital } from '@/hooks/useHospital'
import { defineMessages, useT } from '@/i18n'
import { formatDateTime } from '@/lib/format'

const messages = defineMessages({
  en: {
    'filter.all': 'All actions',
    'filter.bookings': 'Bookings',
    'filter.queue': 'Queue actions',
    'filter.sessions': 'OPD sessions',
    'filter.payments': 'Payments',
    'filter.refunds': 'Refunds',
    'filter.reports': 'Report exports',
    'filter.doctors': 'Doctor changes',
    'filter.shifts': 'Shift changes',
    'filter.roles': 'Role changes',
    'filter.settings': 'Settings changes',
    title: 'Audit log',
    description:
      'Append-only record written inside the same database transaction as each change. Patient names and phone numbers are not stored here.',
    empty: 'No entries',
    time: 'Time',
    action: 'Action',
    actor: 'Actor',
    entity: 'Entity',
    details: 'Details',
    newer: 'Newer',
    older: 'Older',
    range: '{from}–{to} of {total}',
  },
  hi: {
    'filter.all': 'सभी कार्रवाइयाँ',
    'filter.bookings': 'बुकिंग',
    'filter.queue': 'कतार की कार्रवाइयाँ',
    'filter.sessions': 'ओपीडी सत्र',
    'filter.payments': 'भुगतान',
    'filter.refunds': 'रिफ़ंड',
    'filter.reports': 'रिपोर्ट एक्सपोर्ट',
    'filter.doctors': 'डॉक्टर में बदलाव',
    'filter.shifts': 'शिफ़्ट में बदलाव',
    'filter.roles': 'भूमिका में बदलाव',
    'filter.settings': 'सेटिंग्स में बदलाव',
    title: 'ऑडिट लॉग',
    description:
      'केवल जोड़ा जा सकने वाला रिकॉर्ड, जो हर बदलाव के साथ उसी डेटाबेस ट्रांज़ैक्शन में लिखा जाता है। मरीज़ों के नाम और फ़ोन नंबर यहाँ नहीं रखे जाते।',
    empty: 'कोई प्रविष्टि नहीं',
    time: 'समय',
    action: 'कार्रवाई',
    actor: 'किसने',
    entity: 'रिकॉर्ड',
    details: 'विवरण',
    newer: 'नई',
    older: 'पुरानी',
    range: '{total} में से {from}–{to}',
  },
})
type Key = keyof typeof messages.en

// The values are audit action prefixes (stored codes): only the labels are translated.
const FILTERS: { value: string; label: Key }[] = [
  { value: '', label: 'filter.all' },
  { value: 'appointment.', label: 'filter.bookings' },
  { value: 'queue.', label: 'filter.queue' },
  { value: 'session.', label: 'filter.sessions' },
  { value: 'payment.', label: 'filter.payments' },
  { value: 'refund.', label: 'filter.refunds' },
  { value: 'report.', label: 'filter.reports' },
  { value: 'doctors.', label: 'filter.doctors' },
  { value: 'shifts.', label: 'filter.shifts' },
  { value: 'user_roles.', label: 'filter.roles' },
  { value: 'hospitals.', label: 'filter.settings' },
]
const PAGE = 50

export default function AuditPage() {
  const { data: hospital } = useHospital()
  const t = useT(messages)
  const [action, setAction] = useState('')
  const [page, setPage] = useState(0)
  const logs = useQuery({
    queryKey: ['audit', hospital?.id, action, page],
    queryFn: () => fetchAuditLogs(hospital!.id, { action, offset: page * PAGE, limit: PAGE }),
    enabled: !!hospital,
    placeholderData: keepPreviousData,
  })

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Select
            value={action || 'all'}
            onValueChange={(v) => {
              setAction(v === 'all' ? '' : v)
              setPage(0)
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FILTERS.map((f) => (
                <SelectItem key={f.label} value={f.value || 'all'}>
                  {t(f.label)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {logs.isPending ? (
        <PageSpinner />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
      ) : logs.data.rows.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('time')}</TableHead>
                  <TableHead>{t('action')}</TableHead>
                  <TableHead>{t('actor')}</TableHead>
                  <TableHead>{t('entity')}</TableHead>
                  <TableHead>{t('details')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.data.rows.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(l.created_at)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{l.action}</TableCell>
                    <TableCell className="text-xs">
                      {l.actor_role}
                      {l.actor_user_id && (
                        <span className="block text-muted-foreground">
                          {l.actor_user_id.slice(0, 8)}…
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.entity_type}
                      <span className="block font-mono text-muted-foreground">
                        {l.entity_id?.slice(0, 8)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <code
                        className="block max-w-md truncate text-xs"
                        title={JSON.stringify(l.details)}
                      >
                        {JSON.stringify(l.details)}
                      </code>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              {t('newer')}
            </Button>
            <span className="text-sm tabular">
              {t('range', {
                from: page * PAGE + 1,
                to: Math.min((page + 1) * PAGE, logs.data.total),
                total: logs.data.total,
              })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * PAGE >= logs.data.total}
              onClick={() => setPage(page + 1)}
            >
              {t('older')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
