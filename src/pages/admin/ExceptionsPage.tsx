import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  createException,
  deleteException,
  fetchAllDoctors,
  fetchDoctorShifts,
  fetchExceptions,
} from '@/api/admin'
import { ToneBadge } from '@/components/badges'
import { EmptyState, ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { useHospital, useToday } from '@/hooks/useHospital'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatTimeRange } from '@/lib/format'
import type { ExceptionKind } from '@/types/database'

const KINDS: { value: ExceptionKind; label: string; scope: 'any' | 'shift' }[] = [
  { value: 'HOLIDAY', label: 'Holiday (closed)', scope: 'any' },
  { value: 'CLOSED', label: 'Closure / doctor leave', scope: 'any' },
  { value: 'MODIFIED_HOURS', label: 'Changed hours (one day)', scope: 'shift' },
  { value: 'CAPACITY_CHANGE', label: 'Changed token limit (one day)', scope: 'shift' },
]
const NONE = '__none'

interface Draft {
  date: string
  kind: ExceptionKind
  doctorId: string
  shiftId: string
  start: string
  end: string
  maxTokens: string
  reason: string
}

export default function ExceptionsPage() {
  const { data: hospital } = useHospital()
  const today = useToday()
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: ['admin-exceptions', hospital?.id, today],
    queryFn: () => fetchExceptions(hospital!.id, today),
    enabled: !!hospital,
  })
  const doctors = useQuery({
    queryKey: ['admin-doctors', hospital?.id],
    queryFn: () => fetchAllDoctors(hospital!.id),
    enabled: !!hospital,
  })
  const [draft, setDraft] = useState<Draft | null>(null)
  const shifts = useQuery({
    queryKey: ['admin-shifts', draft?.doctorId],
    queryFn: () => fetchDoctorShifts(draft!.doctorId),
    enabled: !!draft?.doctorId && draft.doctorId !== NONE,
  })

  const kind = KINDS.find((k) => k.value === draft?.kind)
  const needsShift = kind?.scope === 'shift'

  const create = useMutation({
    mutationFn: (d: Draft) =>
      createException({
        hospital_id: hospital!.id,
        exception_date: d.date,
        kind: d.kind,
        doctor_id: d.doctorId === NONE ? null : d.doctorId,
        shift_id: d.shiftId === NONE ? null : d.shiftId,
        start_time: d.kind === 'MODIFIED_HOURS' ? d.start : null,
        end_time: d.kind === 'MODIFIED_HOURS' ? d.end : null,
        max_tokens: d.kind === 'CAPACITY_CHANGE' ? Number(d.maxTokens) : null,
        reason: d.reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Saved. Patients now see this on the booking pages.')
      setDraft(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-exceptions'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: deleteException,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-exceptions'] }),
    onError: (e) => toast.error(errorMessage(e)),
  })

  const doctorName = (id: string | null) => doctors.data?.find((d) => d.id === id)?.full_name

  return (
    <div>
      <PageHeader
        title="Holidays & closures"
        description="One-day changes to the weekly schedule. Existing bookings are not cancelled automatically — use the queue console's Cancel session if needed."
        actions={
          <Button
            onClick={() =>
              setDraft({
                date: today,
                kind: 'HOLIDAY',
                doctorId: NONE,
                shiftId: NONE,
                start: '09:00',
                end: '13:00',
                maxTokens: '20',
                reason: '',
              })
            }
          >
            <Plus /> Add
          </Button>
        }
      />
      {list.isPending ? (
        <PageSpinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState title="No upcoming exceptions" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Reason (public)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(e.exception_date)}
                  </TableCell>
                  <TableCell>
                    <ToneBadge
                      color={e.kind === 'HOLIDAY' || e.kind === 'CLOSED' ? 'red' : 'amber'}
                    >
                      {KINDS.find((k) => k.value === e.kind)?.label}
                    </ToneBadge>
                  </TableCell>
                  <TableCell>
                    {e.doctor_id
                      ? `${doctorName(e.doctor_id) ?? 'Doctor'}${e.shift_id ? ' (one shift)' : ''}`
                      : 'Whole hospital'}
                  </TableCell>
                  <TableCell>
                    {e.kind === 'MODIFIED_HOURS' &&
                      e.start_time &&
                      e.end_time &&
                      formatTimeRange(e.start_time, e.end_time)}
                    {e.kind === 'CAPACITY_CHANGE' && `${e.max_tokens} tokens`}
                  </TableCell>
                  <TableCell className="max-w-xs">{e.reason}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete"
                      onClick={() => remove.mutate(e.id)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add holiday or schedule change</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ex-date">Date</Label>
                  <Input
                    id="ex-date"
                    type="date"
                    min={today}
                    value={draft.date}
                    onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select
                    value={draft.kind}
                    onValueChange={(v) => setDraft({ ...draft, kind: v as ExceptionKind })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Doctor</Label>
                <Select
                  value={draft.doctorId}
                  onValueChange={(v) => setDraft({ ...draft, doctorId: v, shiftId: NONE })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!needsShift && <SelectItem value={NONE}>Whole hospital</SelectItem>}
                    {doctors.data?.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {draft.doctorId !== NONE && (
                <div className="space-y-1.5">
                  <Label>Shift</Label>
                  <Select
                    value={draft.shiftId}
                    onValueChange={(v) => setDraft({ ...draft, shiftId: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!needsShift && (
                        <SelectItem value={NONE}>All of this doctor’s shifts</SelectItem>
                      )}
                      {shifts.data?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({formatTimeRange(s.start_time, s.end_time)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {draft.kind === 'MODIFIED_HOURS' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ex-start">Start</Label>
                    <Input
                      id="ex-start"
                      type="time"
                      value={draft.start}
                      onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ex-end">End</Label>
                    <Input
                      id="ex-end"
                      type="time"
                      value={draft.end}
                      onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                    />
                  </div>
                </div>
              )}
              {draft.kind === 'CAPACITY_CHANGE' && (
                <div className="space-y-1.5">
                  <Label htmlFor="ex-max">Token limit for the day</Label>
                  <Input
                    id="ex-max"
                    type="number"
                    min={1}
                    max={500}
                    value={draft.maxTokens}
                    onChange={(e) => setDraft({ ...draft, maxTokens: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ex-reason">Reason shown to patients</Label>
                <Input
                  id="ex-reason"
                  maxLength={300}
                  value={draft.reason}
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                  placeholder="e.g. Diwali holiday"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={
                !draft ||
                draft.reason.trim().length < 3 ||
                (needsShift && draft.shiftId === NONE) ||
                create.isPending
              }
              onClick={() => draft && create.mutate(draft)}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
