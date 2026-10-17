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
import { defineMessages, useT } from '@/i18n'
import { common } from '@/i18n/common'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatTimeRange } from '@/lib/format'
import type { ExceptionKind } from '@/types/database'

const messages = defineMessages({
  en: {
    'kind.HOLIDAY': 'Holiday (closed)',
    'kind.CLOSED': 'Closure / doctor leave',
    'kind.MODIFIED_HOURS': 'Changed hours (one day)',
    'kind.CAPACITY_CHANGE': 'Changed token limit (one day)',
    saved: 'Saved. Patients now see this on the booking pages.',
    title: 'Holidays & closures',
    description:
      "One-day changes to the weekly schedule. Existing bookings are not cancelled automatically — use the queue console's Cancel session if needed.",
    add: 'Add',
    empty: 'No upcoming exceptions',
    date: 'Date',
    type: 'Type',
    appliesTo: 'Applies to',
    details: 'Details',
    reasonPublic: 'Reason (public)',
    doctor: 'Doctor',
    oneShift: '{doctor} (one shift)',
    wholeHospital: 'Whole hospital',
    tokens: '{n} tokens',
    delete: 'Delete',
    dialogTitle: 'Add holiday or schedule change',
    shift: 'Shift',
    allShifts: 'All of this doctor’s shifts',
    start: 'Start',
    end: 'End',
    tokenLimit: 'Token limit for the day',
    reasonShown: 'Reason shown to patients',
    reasonPlaceholder: 'e.g. Diwali holiday',
  },
  hi: {
    'kind.HOLIDAY': 'छुट्टी (बंद)',
    'kind.CLOSED': 'बंदी / डॉक्टर की छुट्टी',
    'kind.MODIFIED_HOURS': 'बदला हुआ समय (एक दिन)',
    'kind.CAPACITY_CHANGE': 'बदली हुई टोकन सीमा (एक दिन)',
    saved: 'सहेजा गया। अब मरीज़ों को यह बुकिंग पेजों पर दिखेगा।',
    title: 'छुट्टियाँ और बंदी',
    description:
      'साप्ताहिक समय-सारणी में एक दिन के बदलाव। पहले से हुई बुकिंग अपने-आप रद्द नहीं होतीं — ज़रूरत हो तो कतार कंसोल में “सत्र रद्द करें” का उपयोग करें।',
    add: 'जोड़ें',
    empty: 'आगे के लिए कोई छुट्टी या बदलाव नहीं',
    date: 'तारीख़',
    type: 'प्रकार',
    appliesTo: 'किस पर लागू',
    details: 'विवरण',
    reasonPublic: 'कारण (सार्वजनिक)',
    doctor: 'डॉक्टर',
    oneShift: '{doctor} (एक शिफ़्ट)',
    wholeHospital: 'पूरा अस्पताल',
    tokens: '{n} टोकन',
    delete: 'हटाएँ',
    dialogTitle: 'छुट्टी या समय-सारणी में बदलाव जोड़ें',
    shift: 'शिफ़्ट',
    allShifts: 'इस डॉक्टर की सभी शिफ़्ट',
    start: 'शुरू',
    end: 'समाप्त',
    tokenLimit: 'उस दिन की टोकन सीमा',
    reasonShown: 'मरीज़ों को दिखने वाला कारण',
    reasonPlaceholder: 'जैसे दीवाली की छुट्टी',
  },
})

const KINDS: { value: ExceptionKind; scope: 'any' | 'shift' }[] = [
  { value: 'HOLIDAY', scope: 'any' },
  { value: 'CLOSED', scope: 'any' },
  { value: 'MODIFIED_HOURS', scope: 'shift' },
  { value: 'CAPACITY_CHANGE', scope: 'shift' },
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
  const t = useT(messages)
  const c = useT(common)
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
      toast.success(t('saved'))
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
        title={t('title')}
        description={t('description')}
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
            <Plus /> {t('add')}
          </Button>
        }
      />
      {list.isPending ? (
        <PageSpinner />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : list.data.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('date')}</TableHead>
                <TableHead>{t('type')}</TableHead>
                <TableHead>{t('appliesTo')}</TableHead>
                <TableHead>{t('details')}</TableHead>
                <TableHead>{t('reasonPublic')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((e) => {
                const doctor = doctorName(e.doctor_id) ?? t('doctor')
                return (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(e.exception_date)}
                    </TableCell>
                    <TableCell>
                      <ToneBadge
                        color={e.kind === 'HOLIDAY' || e.kind === 'CLOSED' ? 'red' : 'amber'}
                      >
                        {t(`kind.${e.kind}`)}
                      </ToneBadge>
                    </TableCell>
                    <TableCell>
                      {e.doctor_id
                        ? e.shift_id
                          ? t('oneShift', { doctor })
                          : doctor
                        : t('wholeHospital')}
                    </TableCell>
                    <TableCell>
                      {e.kind === 'MODIFIED_HOURS' &&
                        e.start_time &&
                        e.end_time &&
                        formatTimeRange(e.start_time, e.end_time)}
                      {e.kind === 'CAPACITY_CHANGE' && t('tokens', { n: e.max_tokens })}
                    </TableCell>
                    <TableCell className="max-w-xs">{e.reason}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('delete')}
                        onClick={() => remove.mutate(e.id)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ex-date">{t('date')}</Label>
                  <Input
                    id="ex-date"
                    type="date"
                    min={today}
                    value={draft.date}
                    onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('type')}</Label>
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
                          {t(`kind.${k.value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('doctor')}</Label>
                <Select
                  value={draft.doctorId}
                  onValueChange={(v) => setDraft({ ...draft, doctorId: v, shiftId: NONE })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!needsShift && <SelectItem value={NONE}>{t('wholeHospital')}</SelectItem>}
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
                  <Label>{t('shift')}</Label>
                  <Select
                    value={draft.shiftId}
                    onValueChange={(v) => setDraft({ ...draft, shiftId: v })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!needsShift && <SelectItem value={NONE}>{t('allShifts')}</SelectItem>}
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
                    <Label htmlFor="ex-start">{t('start')}</Label>
                    <Input
                      id="ex-start"
                      type="time"
                      value={draft.start}
                      onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ex-end">{t('end')}</Label>
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
                  <Label htmlFor="ex-max">{t('tokenLimit')}</Label>
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
                <Label htmlFor="ex-reason">{t('reasonShown')}</Label>
                <Input
                  id="ex-reason"
                  maxLength={300}
                  value={draft.reason}
                  onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                  placeholder={t('reasonPlaceholder')}
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
              {c('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
