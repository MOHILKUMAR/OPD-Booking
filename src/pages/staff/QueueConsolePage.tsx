import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellRing, Pause, Play, Power, Timer } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { fetchSessions } from '@/api/public'
import {
  callNext,
  fetchQueueAppointments,
  fetchQueueStats,
  queueAction,
  sessionControl,
  type SessionAction,
} from '@/api/staff'
import { AppointmentStatusBadge, SessionStatusBadge, ToneBadge } from '@/components/badges'
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
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Textarea } from '@/components/ui/textarea'
import { useToday } from '@/hooks/useHospital'
import { useLiveQueue } from '@/hooks/useLiveQueue'
import { useStaffScope } from '@/hooks/useStaffScope'
import { toAppError } from '@/lib/errors'
import { formatTimeRange } from '@/lib/format'
import { ACTIONS, availableActions, type QueueAction } from '@/lib/queue-transitions'
import { cn } from '@/lib/utils'
import type { AppRole, SessionRow, StaffAppointment } from '@/types/database'

const GROUPS: { title: string; statuses: StaffAppointment['status'][]; collapsed?: boolean }[] = [
  { title: 'With the doctor', statuses: ['CALLED', 'IN_CONSULTATION'] },
  { title: 'Checked in, waiting', statuses: ['ARRIVED', 'WAITING'] },
  { title: 'Booked, not arrived', statuses: ['BOOKED', 'CONFIRMED'] },
  { title: 'Skipped', statuses: ['SKIPPED'] },
  { title: 'Finished', statuses: ['COMPLETED', 'NO_SHOW', 'CANCELLED'], collapsed: true },
]

export default function QueueConsolePage() {
  const scope = useStaffScope()
  const today = useToday()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const doctorIds = scope.doctors.map((d) => d.id)

  const sessions = useQuery({
    queryKey: ['staff-sessions', scope.hospital?.id, today, doctorIds.join(',')],
    queryFn: () => fetchSessions(scope.hospital!.id, today, today, doctorIds),
    enabled: !!scope.hospital && doctorIds.length > 0,
    refetchInterval: 30_000,
  })
  const list = (sessions.data ?? []).filter(
    (s) => s.unavailable_reason !== 'NOT_SCHEDULED' || s.queue_state_id,
  )
  const selected =
    list.find((s) => s.shift_id === params.get('shift')) ??
    (list.length === 1 ? list[0] : undefined)

  if (scope.doctorsQuery.isPending || (sessions.isPending && doctorIds.length > 0))
    return <PageSpinner label="Loading today's sessions" />
  if (sessions.isError)
    return <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader title="Queue console" description="Today's OPD sessions you can manage." />
      {list.length === 0 ? (
        <EmptyState
          title="No OPD sessions today"
          description="No shift you are assigned to is scheduled today."
        />
      ) : (
        <div className="max-w-md">
          <Label className="mb-1.5">Session</Label>
          <Select
            value={selected?.shift_id ?? ''}
            onValueChange={(v) => setParams({ shift: v }, { replace: true })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a doctor's session" />
            </SelectTrigger>
            <SelectContent>
              {list.map((s) => {
                const doc = scope.doctors.find((d) => d.id === s.doctor_id)
                return (
                  <SelectItem key={s.shift_id} value={s.shift_id}>
                    {doc?.full_name} — {s.shift_name} ({formatTimeRange(s.start_time, s.end_time)})
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      )}
      {selected && (
        <SessionConsole
          key={selected.shift_id}
          session={selected}
          roles={scope.rolesFor(selected.doctor_id)}
          canSelfManage={
            !!scope.doctors.find((d) => d.id === selected.doctor_id)?.can_self_manage_session
          }
          doctorName={scope.doctors.find((d) => d.id === selected.doctor_id)?.full_name ?? ''}
          onSessionChanged={() =>
            void queryClient.invalidateQueries({ queryKey: ['staff-sessions'] })
          }
        />
      )}
    </div>
  )
}

function SessionConsole({
  session,
  roles,
  canSelfManage,
  doctorName,
  onSessionChanged,
}: {
  session: SessionRow
  roles: AppRole[]
  canSelfManage: boolean
  doctorName: string
  onSessionChanged: () => void
}) {
  const queryClient = useQueryClient()
  const qsId = session.queue_state_id
  const listKey = ['queue', qsId]
  const live = useLiveQueue({
    channelKey: `staff:${session.shift_id}`,
    filter: qsId ? `id=eq.${qsId}` : undefined,
    queryKeys: [listKey, ['queue-stats', qsId], ['staff-sessions']],
    enabled: !!qsId,
  })
  const appointments = useQuery({
    queryKey: listKey,
    queryFn: () => fetchQueueAppointments(qsId!),
    enabled: !!qsId,
    refetchInterval: live.refetchInterval,
  })
  const stats = useQuery({
    queryKey: ['queue-stats', qsId],
    queryFn: () => fetchQueueStats(qsId!),
    enabled: !!qsId,
    refetchInterval: live.refetchInterval,
  })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: listKey })
    void queryClient.invalidateQueries({ queryKey: ['queue-stats', qsId] })
    onSessionChanged()
  }

  const onError = (err: unknown) => {
    const e = toAppError(err)
    toast.error(e.message)
    if (
      e.code === 'MQ_STALE' ||
      e.code === 'MQ_INVALID_TRANSITION' ||
      e.code === 'MQ_ALREADY_CALLED'
    )
      refresh()
  }

  const action = useMutation({
    mutationFn: (v: { appt: StaffAppointment; action: QueueAction; reason?: string }) =>
      queueAction(v.appt.id, v.action, { reason: v.reason, expectedVersion: v.appt.version }),
    onSuccess: (_r, v) => {
      toast.success(`Token ${v.appt.token_no}: ${ACTIONS[v.action].label.toLowerCase()}`)
      refresh()
    },
    onError,
  })
  const next = useMutation({
    mutationFn: () => callNext(qsId!),
    onSuccess: (r) => {
      toast.success(`Called token ${r.token_no}`)
      refresh()
    },
    onError,
  })
  const control = useMutation({
    mutationFn: (v: {
      action: SessionAction
      note?: string
      delayMinutes?: number
      force?: boolean
    }) => sessionControl({ shiftId: session.shift_id, sessionDate: session.session_date, ...v }),
    onSuccess: (_r, v) => {
      toast.success(`Session ${v.action.toLowerCase().replace('_', ' ')} done`)
      setConfirmClose(null)
      refresh()
    },
    onError: (err, v) => {
      const e = toAppError(err)
      if (e.code === 'MQ_PATIENTS_WAITING' && v.action === 'CLOSE') setConfirmClose(e.message)
      else onError(err)
    },
  })

  const [cancelTarget, setCancelTarget] = useState<StaffAppointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [delayOpen, setDelayOpen] = useState(false)
  const [delay, setDelay] = useState({
    minutes: String(session.delay_minutes || 15),
    note: session.public_note ?? '',
  })
  const [confirmClose, setConfirmClose] = useState<string | null>(null)

  const status = stats.data?.queue.status ?? session.session_status
  const isAdmin = roles.includes('admin')
  const canManage = isAdmin || (roles.includes('doctor') && canSelfManage)
  const canDelay = canManage || roles.includes('receptionist')
  const busy = action.isPending || next.isPending || control.isPending

  const grouped = useMemo(() => {
    const rows = appointments.data ?? []
    return GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => g.statuses.includes(r.status)) }))
  }, [appointments.data])

  const q = stats.data?.queue

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-lg">{doctorName}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {session.shift_name} · {formatTimeRange(session.start_time, session.end_time)} ·
              roles: {roles.join(', ')}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SessionStatusBadge status={status} />
              {(q?.delay_minutes ?? session.delay_minutes) > 0 && (
                <ToneBadge color="amber">
                  Delay {q?.delay_minutes ?? session.delay_minutes} min
                </ToneBadge>
              )}
              {qsId && (
                <LiveIndicator status={live.status} updatedAt={appointments.dataUpdatedAt} />
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && (status === 'SCHEDULED' || (status === 'CLOSED' && isAdmin)) && (
              <Button onClick={() => control.mutate({ action: 'OPEN' })} disabled={busy}>
                <Play /> {status === 'CLOSED' ? 'Reopen OPD' : 'Start OPD'}
              </Button>
            )}
            {canManage && status === 'OPEN' && (
              <Button
                variant="outline"
                onClick={() => control.mutate({ action: 'PAUSE' })}
                disabled={busy}
              >
                <Pause /> Pause
              </Button>
            )}
            {canManage && status === 'PAUSED' && (
              <Button onClick={() => control.mutate({ action: 'RESUME' })} disabled={busy}>
                <Play /> Resume
              </Button>
            )}
            {canDelay && status !== 'CLOSED' && status !== 'CANCELLED' && (
              <Button variant="outline" onClick={() => setDelayOpen(true)} disabled={busy}>
                <Timer /> Delay / note
              </Button>
            )}
            {canManage && (status === 'OPEN' || status === 'PAUSED') && (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => control.mutate({ action: 'CLOSE' })}
                disabled={busy}
              >
                <Power /> End OPD
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <BigStat label="Now serving" value={q?.current_token_no ?? '–'} highlight />
            <BigStat label="Next in line" value={q?.next_token_no ?? '–'} />
            <BigStat label="Waiting" value={q?.waiting_count ?? 0} />
            <BigStat label="Seen" value={q?.completed_count ?? 0} />
            <BigStat
              label="Tokens issued"
              value={`${q?.issued_count ?? session.issued_count}/${q?.capacity ?? session.capacity}`}
            />
          </div>
          {stats.data && (stats.data.avg_consult_minutes || stats.data.avg_wait_minutes) && (
            <p className="mt-2 text-xs text-muted-foreground">
              Average consultation {stats.data.avg_consult_minutes ?? '–'} min · average wait after
              check-in {stats.data.avg_wait_minutes ?? '–'} min
            </p>
          )}
          {status === 'OPEN' && (
            <Button
              size="lg"
              className="mt-4 h-14 w-full text-lg"
              onClick={() => next.mutate()}
              disabled={busy || !qsId}
            >
              <BellRing className="size-5" /> Call next patient
            </Button>
          )}
          {status === 'SCHEDULED' && (
            <p className="mt-4 text-sm text-muted-foreground">
              Patients can be checked in now. Calling starts once{' '}
              {canManage ? 'you start' : 'the doctor or an administrator starts'} the OPD.
            </p>
          )}
        </CardContent>
      </Card>

      {!qsId ? (
        <EmptyState
          title="No tokens yet"
          description="Tokens appear here as patients book or walk in."
        />
      ) : appointments.isPending ? (
        <PageSpinner label="Loading tokens" />
      ) : appointments.isError ? (
        <ErrorState error={appointments.error} onRetry={() => appointments.refetch()} />
      ) : (
        grouped.map((g) =>
          g.rows.length === 0 ? null : (
            <section key={g.title} aria-label={g.title}>
              <details open={!g.collapsed} className="group">
                <summary className="mb-2 cursor-pointer text-sm font-semibold text-muted-foreground">
                  {g.title} ({g.rows.length})
                </summary>
                <div className="overflow-hidden rounded-lg border">
                  {g.rows.map((a) => (
                    <div
                      key={a.id}
                      className={cn(
                        'flex flex-col gap-2 border-b p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between',
                        (a.status === 'CALLED' || a.status === 'IN_CONSULTATION') && 'bg-success/5',
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-12 text-center text-2xl font-bold tabular">
                          {a.token_no}
                        </span>
                        <div>
                          <p className="font-medium">
                            {a.patient_name}
                            {a.patient_age != null && (
                              <span className="font-normal text-muted-foreground">
                                {' '}
                                · {a.patient_age} y
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            <a href={`tel:${a.patient_phone}`} className="hover:underline">
                              {a.patient_phone}
                            </a>{' '}
                            · {a.source === 'WALK_IN' ? 'Walk-in' : 'Online'} ·{' '}
                            {a.booking_reference}
                            {a.skip_count > 0 && ` · skipped ${a.skip_count}×`}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <AppointmentStatusBadge status={a.status} />
                        {availableActions(a.status, roles)
                          .filter((act) => act !== 'CALL' || status === 'OPEN')
                          .filter(
                            (act) => (act !== 'START' && act !== 'COMPLETE') || status === 'OPEN',
                          )
                          .map((act) => (
                            <Button
                              key={act}
                              size="sm"
                              variant={
                                act === 'START' || act === 'COMPLETE' || act === 'ARRIVE'
                                  ? 'default'
                                  : 'outline'
                              }
                              className={cn(ACTIONS[act].destructive && 'text-destructive')}
                              disabled={busy}
                              onClick={() =>
                                ACTIONS[act].needsReason
                                  ? setCancelTarget(a)
                                  : action.mutate({ appt: a, action: act })
                              }
                            >
                              {ACTIONS[act].label}
                            </Button>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </section>
          ),
        )
      )}

      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel token {cancelTarget?.token_no}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The patient will see this reason. If they paid online, a refund request is recorded for
            an administrator to process.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Keep token
            </Button>
            <Button
              variant="destructive"
              disabled={cancelReason.trim().length < 3 || busy}
              onClick={() => {
                action.mutate({
                  appt: cancelTarget!,
                  action: 'CANCEL',
                  reason: cancelReason.trim(),
                })
                setCancelTarget(null)
                setCancelReason('')
              }}
            >
              Cancel token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delayOpen} onOpenChange={setDelayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delay and public note</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Shown to patients on the tracking page and the waiting-room display. No patient details.
          </p>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="delay-min">Delay (minutes, 0 to clear)</Label>
              <Input
                id="delay-min"
                type="number"
                min={0}
                max={600}
                value={delay.minutes}
                onChange={(e) => setDelay({ ...delay, minutes: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delay-note">Note</Label>
              <Input
                id="delay-note"
                maxLength={200}
                value={delay.note}
                onChange={(e) => setDelay({ ...delay, note: e.target.value })}
                placeholder="e.g. Doctor attending an emergency"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                control.mutate({
                  action: 'SET_DELAY',
                  delayMinutes: Number(delay.minutes) || 0,
                  note: delay.note,
                })
                setDelayOpen(false)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmClose} onOpenChange={(o) => !o && setConfirmClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End OPD with patients still waiting?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmClose} Checked-in patients who were not seen will be cancelled (refund
              requested if they paid). Patients who never arrived are marked no-show.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep OPD open</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => control.mutate({ action: 'CLOSE', force: true })}
            >
              End OPD anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function BigStat({
  label,
  value,
  highlight,
}: {
  label: string
  value: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div
      className={cn('rounded-lg border p-3 text-center', highlight && 'border-primary bg-accent')}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular">{value}</p>
    </div>
  )
}
