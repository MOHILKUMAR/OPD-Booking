import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { searchAppointments } from '@/api/staff'
import { AppointmentStatusBadge } from '@/components/badges'
import { EmptyState, ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDebounced, useToday } from '@/hooks/useHospital'
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { formatDate } from '@/lib/format'

const messages = defineMessages({
  en: {
    title: 'Appointments',
    description:
      'Search by booking reference, mobile number or name. Results are limited to doctors you work with.',
    search: 'Search',
    searchPlaceholder: 'MQ-… / 98765… / name',
    date: 'Date',
    anyDate: 'Any date',
    noResults: 'No appointments found',
    token: 'Token',
    patient: 'Patient',
    doctor: 'Doctor',
    status: 'Status',
    reference: 'Reference',
  },
  hi: {
    title: 'अपॉइंटमेंट',
    description:
      'बुकिंग नंबर, मोबाइल नंबर या नाम से खोजें। केवल उन डॉक्टरों के नतीजे दिखते हैं जिनके साथ आप काम करते हैं।',
    search: 'खोजें',
    searchPlaceholder: 'MQ-… / 98765… / नाम',
    date: 'तारीख़',
    anyDate: 'कोई भी तारीख़',
    noResults: 'कोई अपॉइंटमेंट नहीं मिला',
    token: 'टोकन',
    patient: 'मरीज़',
    doctor: 'डॉक्टर',
    status: 'स्थिति',
    reference: 'बुकिंग नंबर',
  },
})

const PAGE = 25

export default function AppointmentsPage() {
  const today = useToday()
  const t = useT(messages)
  const c = useT(common)
  const [date, setDate] = useState(today)
  const [text, setText] = useState('')
  const [page, setPage] = useState(0)
  const query = useDebounced(text, 400)

  const result = useQuery({
    queryKey: ['appointments-search', date, query, page],
    queryFn: () =>
      searchAppointments({ date: date || undefined, query, limit: PAGE, offset: page * PAGE }),
    placeholderData: keepPreviousData,
  })
  const pages = Math.ceil((result.data?.total ?? 0) / PAGE)

  return (
    <div>
      <PageHeader title={t('title')} description={t('description')} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="appt-search">{t('search')}</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              id="appt-search"
              className="pl-8"
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                setPage(0)
              }}
              placeholder={t('searchPlaceholder')}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appt-date">{t('date')}</Label>
          <Input
            id="appt-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setPage(0)
            }}
          />
        </div>
        <Button variant="outline" onClick={() => setDate('')} disabled={!date}>
          {t('anyDate')}
        </Button>
      </div>

      {result.isPending ? (
        <PageSpinner />
      ) : result.isError ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : result.data.rows.length === 0 ? (
        <EmptyState title={t('noResults')} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('token')}</TableHead>
                  <TableHead>{t('patient')}</TableHead>
                  <TableHead>{t('doctor')}</TableHead>
                  <TableHead>{t('date')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead>{t('reference')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-semibold tabular">{a.token_no ?? '–'}</TableCell>
                    <TableCell>
                      {a.patient_name}
                      <span className="block text-xs text-muted-foreground">{a.patient_phone}</span>
                    </TableCell>
                    <TableCell>
                      {(a as unknown as { doctor?: { full_name: string } }).doctor?.full_name}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(a.session_date, { weekday: undefined })}
                    </TableCell>
                    <TableCell>
                      <AppointmentStatusBadge status={a.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.booking_reference}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft /> {c('previous')}
              </Button>
              <span className="text-sm tabular">
                {page + 1} / {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= pages}
                onClick={() => setPage(page + 1)}
              >
                {c('next')} <ChevronRight />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
