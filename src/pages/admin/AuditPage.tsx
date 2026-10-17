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
import { formatDateTime } from '@/lib/format'

const FILTERS = [
  { value: '', label: 'All actions' },
  { value: 'appointment.', label: 'Bookings' },
  { value: 'queue.', label: 'Queue actions' },
  { value: 'session.', label: 'OPD sessions' },
  { value: 'payment.', label: 'Payments' },
  { value: 'refund.', label: 'Refunds' },
  { value: 'doctors.', label: 'Doctor changes' },
  { value: 'shifts.', label: 'Shift changes' },
  { value: 'user_roles.', label: 'Role changes' },
  { value: 'hospitals.', label: 'Settings changes' },
]
const PAGE = 50

export default function AuditPage() {
  const { data: hospital } = useHospital()
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
        title="Audit log"
        description="Append-only record written inside the same database transaction as each change. Patient names and phone numbers are not stored here."
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
                  {f.label}
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
        <EmptyState title="No entries" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Details</TableHead>
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
              Newer
            </Button>
            <span className="text-sm tabular">
              {page * PAGE + 1}–{Math.min((page + 1) * PAGE, logs.data.total)} of {logs.data.total}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * PAGE >= logs.data.total}
              onClick={() => setPage(page + 1)}
            >
              Older
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
