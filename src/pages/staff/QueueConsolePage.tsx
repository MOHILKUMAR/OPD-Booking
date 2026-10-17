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
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { toAppError } from '@/lib/errors'
import { formatTimeRange } from '@/lib/format'
import { ACTIONS, availableActions, type QueueAction } from '@/lib/queue-transitions'
import { cn } from '@/lib/utils'
import type { AppRole, SessionRow, StaffAppointment } from '@/types/database'

const messages = defineMessages({
  en: {
    loadingSessions: "Loading today's sessions",
    title: 'Queue console',
    description: "Today's OPD sessions you can manage.",
    noSessionsTitle: 'No OPD sessions today',
    noSessionsBody: 'No shift you are assigned to is scheduled today.',
    session: 'Session',
    chooseSession: "Choose a doctor's session",
    roles: 'roles: {roles}',
    'role.admin': 'admin',
    'role.receptionist': 'receptionist',
    'role.doctor': 'doctor',
    delay: 'Delay {minutes} min',
    startOpd: 'Start OPD',
    reopenOpd: 'Reopen OPD',
    pause: 'Pause',
    resume: 'Resume',
    delayNote: 'Delay / note',
    endOpd: 'End OPD',
    nowServing: 'Now serving',
    nextInLine: 'Next in line',
    waiting: 'Waiting',
    seen: 'Seen',
    tokensIssued: 'Tokens issued',
    averages: 'Average consultation {consult} min · average wait after check-in {wait} min',
    callNext: 'Call next patient',
    scheduledSelf: 'Patients can be checked in now. Calling starts once you start the OPD.',
    scheduledOther:
      'Patients can be checked in now. Calling starts once the doctor or an administrator starts the OPD.',
    noTokensTitle: 'No tokens yet',
    noTokensBody: 'Tokens appear here as patients book or walk in.',
    loadingTokens: 'Loading tokens',
    'group.withDoctor': 'With the doctor',
    'group.waiting': 'Checked in, waiting',
    'group.notArrived': 'Booked, not arrived',
    'group.skipped': 'Skipped',
    'group.finished': 'Finished',
    age: '{age} y',
    skippedTimes: 'skipped {count}×',
    // {action} is the button label in lower case, {status} the new status (Hindi reads better).
    actionDone: 'Token {token}: {action}',
    calledToken: 'Called token {token}',
    'control.OPEN': 'Session open done',
    'control.PAUSE': 'Session pause done',
    'control.RESUME': 'Session resume done',
    'control.CLOSE': 'Session close done',
    'control.CANCEL': 'Session cancel done',
    'control.BOOKING_OPEN': 'Session booking open done',
    'control.BOOKING_CLOSE': 'Session booking close done',
    'control.SET_DELAY': 'Session set delay done',
    cancelTitle: 'Cancel token {token}?',
    cancelBody:
      'The patient will see this reason. If they paid online, a refund request is recorded for an administrator to process.',
    reason: 'Reason',
    keepToken: 'Keep token',
    delayTitle: 'Delay and public note',
    delayBody:
      'Shown to patients on the tracking page and the waiting-room display. No patient details.',
    delayMinutes: 'Delay (minutes, 0 to clear)',
    note: 'Note',
    notePlaceholder: 'e.g. Doctor attending an emergency',
    closeTitle: 'End OPD with patients still waiting?',
    closeBody:
      'Checked-in patients who were not seen will be cancelled (refund requested if they paid). Patients who never arrived are marked no-show.',
    keepOpen: 'Keep OPD open',
    endAnyway: 'End OPD anyway',
  },
  hi: {
    loadingSessions: 'आज के सत्र लोड हो रहे हैं',
    title: 'कतार कंसोल',
    description: 'आज के ओपीडी सत्र, जिन्हें आप संभाल सकते हैं।',
    noSessionsTitle: 'आज कोई ओपीडी सत्र नहीं है',
    noSessionsBody: 'आपको सौंपी गई कोई भी शिफ़्ट आज निर्धारित नहीं है।',
    session: 'सत्र',
    chooseSession: 'डॉक्टर का सत्र चुनें',
    roles: 'भूमिकाएँ: {roles}',
    'role.admin': 'एडमिन',
    'role.receptionist': 'रिसेप्शनिस्ट',
    'role.doctor': 'डॉक्टर',
    delay: 'देरी {minutes} मिनट',
    startOpd: 'ओपीडी शुरू करें',
    reopenOpd: 'ओपीडी फिर से खोलें',
    pause: 'रोकें',
    resume: 'फिर चालू करें',
    delayNote: 'देरी / सूचना',
    endOpd: 'ओपीडी समाप्त करें',
    nowServing: 'अभी का टोकन',
    nextInLine: 'अगला टोकन',
    waiting: 'प्रतीक्षा में',
    seen: 'देखे गए',
    tokensIssued: 'जारी टोकन',
    averages: 'औसत परामर्श {consult} मिनट · चेक-इन के बाद औसत प्रतीक्षा {wait} मिनट',
    callNext: 'अगले मरीज़ को बुलाएँ',
    scheduledSelf:
      'मरीज़ों का चेक-इन अभी किया जा सकता है। आपके ओपीडी शुरू करते ही बुलाना शुरू होगा।',
    scheduledOther:
      'मरीज़ों का चेक-इन अभी किया जा सकता है। डॉक्टर या प्रशासक के ओपीडी शुरू करते ही बुलाना शुरू होगा।',
    noTokensTitle: 'अभी कोई टोकन नहीं',
    noTokensBody: 'मरीज़ों के बुक करने या वॉक-इन आने पर टोकन यहाँ दिखेंगे।',
    loadingTokens: 'टोकन लोड हो रहे हैं',
    'group.withDoctor': 'डॉक्टर के पास',
    'group.waiting': 'चेक-इन हो गया, प्रतीक्षा में',
    'group.notArrived': 'बुक, पर अभी नहीं आए',
    'group.skipped': 'छोड़े गए',
    'group.finished': 'समाप्त',
    age: '{age} वर्ष',
    skippedTimes: '{count} बार छोड़ा गया',
    actionDone: 'टोकन {token}: {status}',
    calledToken: 'टोकन {token} को बुलाया गया',
    'control.OPEN': 'ओपीडी शुरू हो गई',
    'control.PAUSE': 'ओपीडी रोक दी गई',
    'control.RESUME': 'ओपीडी फिर चालू हो गई',
    'control.CLOSE': 'ओपीडी समाप्त हो गई',
    'control.CANCEL': 'सत्र रद्द हो गया',
    'control.BOOKING_OPEN': 'ऑनलाइन बुकिंग खुल गई',
    'control.BOOKING_CLOSE': 'ऑनलाइन बुकिंग बंद हो गई',
    'control.SET_DELAY': 'देरी और सूचना सहेज दी गई',
    cancelTitle: 'टोकन {token} रद्द करें?',
    cancelBody:
      'मरीज़ को यह कारण दिखेगा। अगर उन्होंने ऑनलाइन भुगतान किया है, तो रिफ़ंड का अनुरोध दर्ज हो जाएगा, जिसे प्रशासक पूरा करेंगे।',
    reason: 'कारण',
    keepToken: 'टोकन रहने दें',
    delayTitle: 'देरी और सार्वजनिक सूचना',
    delayBody:
      'यह मरीज़ों को ट्रैकिंग पेज और प्रतीक्षा-कक्ष के डिस्प्ले पर दिखता है। इसमें मरीज़ की कोई जानकारी न लिखें।',
    delayMinutes: 'देरी (मिनट में, हटाने के लिए 0)',
    note: 'सूचना',
    notePlaceholder: 'जैसे: डॉक्टर एक इमरजेंसी में हैं',
    closeTitle: 'मरीज़ अभी प्रतीक्षा में हैं। फिर भी ओपीडी समाप्त करें?',
    closeBody:
      'चेक-इन किए हुए जिन मरीज़ों को देखा नहीं गया, उनके टोकन रद्द हो जाएँगे (भुगतान किया हो तो रिफ़ंड का अनुरोध दर्ज होगा)। जो मरीज़ आए ही नहीं, उन्हें "नहीं आए" दर्ज किया जाएगा।',
    keepOpen: 'ओपीडी चालू रखें',
    endAnyway: 'फिर भी ओपीडी समाप्त करें',
  },
})
type Key = keyof typeof messages.en

const GROUPS: { title: Key; statuses: StaffAppointment['status'][]; collapsed?: boolean }[] = [
  { title: 'group.withDoctor', statuses: ['CALLED', 'IN_CONSULTATION'] },
  { title: 'group.waiting', statuses: ['ARRIVED', 'WAITING'] },
  { title: 'group.notArrived', statuses: ['BOOKED', 'CONFIRMED'] },
  { title: 'group.skipped', statuses: ['SKIPPED'] },
  { title: 'group.finished', statuses: ['COMPLETED', 'NO_SHOW', 'CANCELLED'], collapsed: true },
]

export default function QueueConsolePage() {
  const scope = useStaffScope()
  const today = useToday()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const t = useT(messages)
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
    return <PageSpinner label={t('loadingSessions')} />
  if (sessions.isError)
    return <ErrorState error={sessions.error} onRetry={() => sessions.refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      {list.length === 0 ? (
        <EmptyState title={t('noSessionsTitle')} description={t('noSessionsBody')} />
      ) : (
        <div className="max-w-md">
          <Label className="mb-1.5">{t('session')}</Label>
          <Select
            value={selected?.shift_id ?? ''}
            onValueChange={(v) => setParams({ shift: v }, { replace: true })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('chooseSession')} />
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
  const t = useT(messages)
  const c = useT(common)
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
      toast.success(
        t('actionDone', {
          token: v.appt.token_no,
          action: c(`action.${v.action}`).toLowerCase(),
          status: c(`appt.${ACTIONS[v.action].target}`),
        }),
      )
      refresh()
    },
    onError,
  })
  const next = useMutation({
    mutationFn: () => callNext(qsId!),
    onSuccess: (r) => {
      toast.success(t('calledToken', { token: r.token_no }))
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
      toast.success(t(`control.${v.action}`))
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
              {session.shift_name} · {formatTimeRange(session.start_time, session.end_time)} ·{' '}
              {t('roles', { roles: roles.map((r) => t(`role.${r}`)).join(', ') })}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SessionStatusBadge status={status} />
              {(q?.delay_minutes ?? session.delay_minutes) > 0 && (
                <ToneBadge color="amber">
                  {t('delay', { minutes: q?.delay_minutes ?? session.delay_minutes })}
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
                <Play /> {status === 'CLOSED' ? t('reopenOpd') : t('startOpd')}
              </Button>
            )}
            {canManage && status === 'OPEN' && (
              <Button
                variant="outline"
                onClick={() => control.mutate({ action: 'PAUSE' })}
                disabled={busy}
              >
                <Pause /> {t('pause')}
              </Button>
            )}
            {canManage && status === 'PAUSED' && (
              <Button onClick={() => control.mutate({ action: 'RESUME' })} disabled={busy}>
                <Play /> {t('resume')}
              </Button>
            )}
            {canDelay && status !== 'CLOSED' && status !== 'CANCELLED' && (
              <Button variant="outline" onClick={() => setDelayOpen(true)} disabled={busy}>
                <Timer /> {t('delayNote')}
              </Button>
            )}
            {canManage && (status === 'OPEN' || status === 'PAUSED') && (
              <Button
                variant="outline"
                className="text-destructive"
                onClick={() => control.mutate({ action: 'CLOSE' })}
                disabled={busy}
              >
                <Power /> {t('endOpd')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <BigStat label={t('nowServing')} value={q?.current_token_no ?? '–'} highlight />
            <BigStat label={t('nextInLine')} value={q?.next_token_no ?? '–'} />
            <BigStat label={t('waiting')} value={q?.waiting_count ?? 0} />
            <BigStat label={t('seen')} value={q?.completed_count ?? 0} />
            <BigStat
              label={t('tokensIssued')}
              value={`${q?.issued_count ?? session.issued_count}/${q?.capacity ?? session.capacity}`}
            />
          </div>
          {stats.data && (stats.data.avg_consult_minutes || stats.data.avg_wait_minutes) && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('averages', {
                consult: stats.data.avg_consult_minutes ?? '–',
                wait: stats.data.avg_wait_minutes ?? '–',
              })}
            </p>
          )}
          {status === 'OPEN' && (
            <Button
              size="lg"
              className="mt-4 h-14 w-full text-lg"
              onClick={() => next.mutate()}
              disabled={busy || !qsId}
            >
              <BellRing className="size-5" /> {t('callNext')}
            </Button>
          )}
          {status === 'SCHEDULED' && (
            <p className="mt-4 text-sm text-muted-foreground">
              {canManage ? t('scheduledSelf') : t('scheduledOther')}
            </p>
          )}
        </CardContent>
      </Card>

      {!qsId ? (
        <EmptyState title={t('noTokensTitle')} description={t('noTokensBody')} />
      ) : appointments.isPending ? (
        <PageSpinner label={t('loadingTokens')} />
      ) : appointments.isError ? (
        <ErrorState error={appointments.error} onRetry={() => appointments.refetch()} />
      ) : (
        grouped.map((g) =>
          g.rows.length === 0 ? null : (
            <section key={g.title} aria-label={t(g.title)}>
              <details open={!g.collapsed} className="group">
                <summary className="mb-2 cursor-pointer text-sm font-semibold text-muted-foreground">
                  {t(g.title)} ({g.rows.length})
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
                                · {t('age', { age: a.patient_age })}
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            <a href={`tel:${a.patient_phone}`} className="hover:underline">
                              {a.patient_phone}
                            </a>{' '}
                            · {c(a.source === 'WALK_IN' ? 'source.WALK_IN' : 'source.ONLINE')} ·{' '}
                            {a.booking_reference}
                            {a.skip_count > 0 && ` · ${t('skippedTimes', { count: a.skip_count })}`}
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
                              {c(`action.${act}`)}
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
            <DialogTitle>{t('cancelTitle', { token: cancelTarget?.token_no })}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('cancelBody')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">{t('reason')}</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              maxLength={300}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              {t('keepToken')}
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
              {c('action.CANCEL')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delayOpen} onOpenChange={setDelayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('delayTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('delayBody')}</p>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="delay-min">{t('delayMinutes')}</Label>
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
              <Label htmlFor="delay-note">{t('note')}</Label>
              <Input
                id="delay-note"
                maxLength={200}
                value={delay.note}
                onChange={(e) => setDelay({ ...delay, note: e.target.value })}
                placeholder={t('notePlaceholder')}
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
              {c('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmClose} onOpenChange={(o) => !o && setConfirmClose(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('closeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmClose} {t('closeBody')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('keepOpen')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => control.mutate({ action: 'CLOSE', force: true })}
            >
              {t('endAnyway')}
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
