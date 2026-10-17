import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  fetchAllDepartments,
  fetchDoctorShifts,
  saveDoctor,
  saveShift,
  type ShiftWithDays,
} from '@/api/admin'
import { fetchDoctor } from '@/api/public'
import { ToneBadge } from '@/components/badges'
import { ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useHospital, useToday } from '@/hooks/useHospital'
import { defineMessages, localeFor, tr, useLanguage, useT, type Lang, type TFunction } from '@/i18n'
import { errorMessage } from '@/lib/errors'
import { formatMoney, formatTimeRange } from '@/lib/format'

const messages = defineMessages({
  en: {
    doctors: 'Doctors',
    addDoctor: 'Add doctor',
    doctor: 'Doctor',
    profile: 'Profile',
    fullName: 'Full name',
    department: 'Department',
    choose: 'Choose',
    specialty: 'Specialty',
    qualifications: 'Qualifications (exactly as provided by the hospital)',
    room: 'Room',
    consultationFee: 'Consultation fee (₹, paid at hospital)',
    photoUrl: 'Photo URL (optional)',
    sortOrder: 'Sort order',
    about: 'About (optional)',
    listedPublicly: 'Active (listed publicly)',
    acceptingBookings: 'Accepting online bookings',
    selfManage: 'Doctor may start/stop own OPD',
    saveProfile: 'Save profile',
    doctorSaved: 'Doctor saved',

    shiftsTitle: 'OPD shifts and weekly schedule',
    addShift: 'Add shift',
    editShift: 'Edit shift',
    noShifts: 'No shifts yet.',
    inactive: 'Inactive',
    noWeekdays: 'No weekdays',
    shiftSummary: '{tokens} tokens ({walkIns} for walk-ins) · ~{minutes} min each',
    defaultFee: 'hospital default fee',
    free: 'free',
    edit: 'Edit',
    overlapNote:
      'Overlapping shifts for the same doctor on the same weekday are rejected by the database. Use Holidays & closures for one-off changes.',
    name: 'Name',
    start: 'Start',
    end: 'End',
    maxTokens: 'Max tokens',
    walkinReserved: 'Reserved for walk-ins',
    onlineCutoff: 'Online cutoff (min before end)',
    avgConsult: 'Avg consultation (min)',
    bookingFee: 'Booking fee ₹ (blank = default)',
    runsOn: 'Runs on',
    active: 'Active',
    saveShift: 'Save shift',
    shiftSaved: 'Shift saved',

    'v.rupees': 'Enter an amount in rupees',
    'v.doctorName': 'Enter the doctor’s name',
    'v.department': 'Choose a department',
    'v.specialty': 'Enter a specialty',
    'v.httpsUrl': 'Use an https:// URL',
    'v.time': 'HH:MM',
    'v.feeOrBlank': 'Rupees, or blank for the hospital default',
    'v.endAfterStart': 'End must be after start',
    'v.lessThanTotal': 'Must be less than total tokens',

    // zod's built-in checks: empty keeps zod's own English message (see zodText).
    'z.minChars': '',
    'z.maxChars': '',
    'z.min': '',
    'z.max': '',
    'z.number': '',
    'z.invalid': '',
  },
  hi: {
    doctors: 'डॉक्टर',
    addDoctor: 'डॉक्टर जोड़ें',
    doctor: 'डॉक्टर',
    profile: 'प्रोफ़ाइल',
    fullName: 'पूरा नाम',
    department: 'विभाग',
    choose: 'चुनें',
    specialty: 'विशेषज्ञता',
    qualifications: 'योग्यताएँ (ठीक वैसी ही, जैसी अस्पताल ने दी हैं)',
    room: 'कक्ष',
    consultationFee: 'परामर्श शुल्क (₹, अस्पताल में देय)',
    photoUrl: 'फ़ोटो URL (वैकल्पिक)',
    sortOrder: 'दिखाने का क्रम',
    about: 'परिचय (वैकल्पिक)',
    listedPublicly: 'सक्रिय (सार्वजनिक सूची में दिखें)',
    acceptingBookings: 'ऑनलाइन बुकिंग ले रहे हैं',
    selfManage: 'डॉक्टर अपनी ओपीडी ख़ुद शुरू/बंद कर सकते हैं',
    saveProfile: 'प्रोफ़ाइल सहेजें',
    doctorSaved: 'डॉक्टर की जानकारी सहेजी गई',

    shiftsTitle: 'ओपीडी शिफ़्ट और साप्ताहिक समय-सारणी',
    addShift: 'शिफ़्ट जोड़ें',
    editShift: 'शिफ़्ट बदलें',
    noShifts: 'अभी कोई शिफ़्ट नहीं।',
    inactive: 'निष्क्रिय',
    noWeekdays: 'कोई दिन तय नहीं',
    shiftSummary: '{tokens} टोकन (वॉक-इन के लिए {walkIns}) · हर मरीज़ ~{minutes} मिनट',
    defaultFee: 'अस्पताल का डिफ़ॉल्ट शुल्क',
    free: 'निःशुल्क',
    edit: 'बदलें',
    overlapNote:
      'एक ही डॉक्टर की, एक ही वार को आपस में टकराने वाली शिफ़्ट डेटाबेस स्वीकार नहीं करता। किसी एक दिन के बदलाव के लिए “छुट्टियाँ और बंदी” का उपयोग करें।',
    name: 'नाम',
    start: 'शुरू',
    end: 'समाप्त',
    maxTokens: 'अधिकतम टोकन',
    walkinReserved: 'वॉक-इन के लिए आरक्षित',
    onlineCutoff: 'ऑनलाइन बुकिंग बंद (समाप्ति से कितने मिनट पहले)',
    avgConsult: 'औसत परामर्श (मिनट)',
    bookingFee: 'बुकिंग शुल्क ₹ (ख़ाली = डिफ़ॉल्ट)',
    runsOn: 'किन दिनों चलती है',
    active: 'सक्रिय',
    saveShift: 'शिफ़्ट सहेजें',
    shiftSaved: 'शिफ़्ट सहेजी गई',

    'v.rupees': 'राशि रुपये में लिखें',
    'v.doctorName': 'डॉक्टर का नाम लिखें',
    'v.department': 'विभाग चुनें',
    'v.specialty': 'विशेषज्ञता लिखें',
    'v.httpsUrl': 'https:// वाला URL डालें',
    'v.time': 'समय HH:MM के रूप में लिखें',
    'v.feeOrBlank': 'राशि रुपये में लिखें, या अस्पताल के डिफ़ॉल्ट शुल्क के लिए ख़ाली छोड़ें',
    'v.endAfterStart': 'समाप्ति का समय शुरू के समय के बाद का होना चाहिए',
    'v.lessThanTotal': 'कुल टोकन से कम होना चाहिए',

    'z.minChars': 'कम से कम {n} अक्षर लिखें',
    'z.maxChars': 'अधिकतम {n} अक्षर लिखें',
    'z.min': 'कम से कम {n} होना चाहिए',
    'z.max': 'अधिकतम {n} हो सकता है',
    'z.number': 'पूरी संख्या लिखें',
    'z.invalid': 'यह मान सही नहीं है',
  },
})
type Key = keyof typeof messages.en

/** Field error text: our schema messages are message keys; zod's own messages are already text. */
function errorText(t: TFunction<typeof messages.en>, message?: string) {
  if (!message) return undefined
  return message in messages.en ? t(message as Key) : message
}

/**
 * Messages for zod's built-in checks (lengths, number ranges), which have no message of ours.
 * The English 'z.*' texts are empty, so English keeps zod's own wording.
 */
const zodText: z.core.$ZodErrorMap = (iss) => {
  let text: string
  if (iss.code === 'too_small') {
    text = tr(messages, iss.origin === 'string' ? 'z.minChars' : 'z.min', {
      n: Number(iss.minimum),
    })
  } else if (iss.code === 'too_big') {
    text = tr(messages, iss.origin === 'string' ? 'z.maxChars' : 'z.max', {
      n: Number(iss.maximum),
    })
  } else if (iss.code === 'invalid_type') {
    text = tr(messages, 'z.number')
  } else {
    text = tr(messages, 'z.invalid')
  }
  return text || undefined
}

/** Short weekday names, index 0 = Sunday (as stored in doctor_schedules). */
function weekdayNames(lang: Lang): string[] {
  const fmt = new Intl.DateTimeFormat(localeFor(lang), { weekday: 'short', timeZone: 'UTC' })
  // 1 January 2023 was a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2023, 0, 1 + i))))
}

const rupees = z
  .string()
  .trim()
  .regex(/^\d{0,6}(\.\d{1,2})?$/, 'v.rupees')
  .transform((v) => Math.round(Number(v || '0') * 100))

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))

const doctorSchema = z.object({
  full_name: z.string().trim().min(3, 'v.doctorName').max(120),
  department_id: z.uuid('v.department'),
  specialty: z.string().trim().min(2, 'v.specialty').max(80),
  qualifications: optionalText(200),
  bio: optionalText(1000),
  photo_url: optionalText(500).refine(
    (v) => v === null || /^(https:\/\/|\/)/.test(v),
    'v.httpsUrl',
  ),
  room_no: optionalText(20),
  consultation_fee: rupees,
  accepting_bookings: z.boolean(),
  can_self_manage_session: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(9999),
})

export default function DoctorEditPage() {
  const { doctorId = 'new' } = useParams()
  const isNew = doctorId === 'new'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: hospital } = useHospital()
  const t = useT(messages)

  const departments = useQuery({
    queryKey: ['admin-departments', hospital?.id],
    queryFn: () => fetchAllDepartments(hospital!.id),
    enabled: !!hospital,
  })
  const doctor = useQuery({
    queryKey: ['doctor', doctorId],
    queryFn: () => fetchDoctor(doctorId),
    enabled: !isNew,
  })

  const form = useForm<z.input<typeof doctorSchema>, unknown, z.output<typeof doctorSchema>>({
    resolver: zodResolver(doctorSchema, { error: zodText }),
    defaultValues: {
      full_name: '',
      department_id: '',
      specialty: '',
      qualifications: '',
      bio: '',
      photo_url: '',
      room_no: '',
      consultation_fee: '0',
      accepting_bookings: true,
      can_self_manage_session: false,
      is_active: true,
      sort_order: 0,
    },
  })
  const errors = form.formState.errors

  useEffect(() => {
    const d = doctor.data
    if (!d) return
    form.reset({
      full_name: d.full_name,
      department_id: d.department_id,
      specialty: d.specialty,
      qualifications: d.qualifications ?? '',
      bio: d.bio ?? '',
      photo_url: d.photo_url ?? '',
      room_no: d.room_no ?? '',
      consultation_fee: String(d.consultation_fee_paise / 100),
      accepting_bookings: d.accepting_bookings,
      can_self_manage_session: d.can_self_manage_session,
      is_active: d.is_active,
      sort_order: d.sort_order,
    })
  }, [doctor.data, form])

  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const { consultation_fee, ...rest } = v
      const saved = await saveDoctor({
        ...rest,
        id: isNew ? undefined : doctorId,
        hospital_id: hospital!.id,
        consultation_fee_paise: consultation_fee,
      })
      toast.success(t('doctorSaved'))
      void queryClient.invalidateQueries({ queryKey: ['admin-doctors'] })
      void queryClient.invalidateQueries({ queryKey: ['doctor', saved.id] })
      if (isNew) navigate(`/admin/doctors/${saved.id}`, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  if (!hospital || departments.isPending || (!isNew && doctor.isPending)) return <PageSpinner />
  if (doctor.isError) return <ErrorState error={doctor.error} />

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/admin/doctors">
          <ArrowLeft /> {t('doctors')}
        </Link>
      </Button>
      <PageHeader title={isNew ? t('addDoctor') : (doctor.data?.full_name ?? t('doctor'))} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('profile')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Field label={t('fullName')} error={errors.full_name?.message}>
              <Input {...form.register('full_name')} />
            </Field>
            <Field label={t('department')} error={errors.department_id?.message}>
              <Controller
                control={form.control}
                name="department_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('choose')} />
                    </SelectTrigger>
                    <SelectContent>
                      {departments.data?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label={t('specialty')} error={errors.specialty?.message}>
              <Input {...form.register('specialty')} />
            </Field>
            <Field label={t('qualifications')} error={errors.qualifications?.message}>
              <Input {...form.register('qualifications')} />
            </Field>
            <Field label={t('room')} error={errors.room_no?.message}>
              <Input {...form.register('room_no')} />
            </Field>
            <Field label={t('consultationFee')} error={errors.consultation_fee?.message}>
              <Input inputMode="decimal" {...form.register('consultation_fee')} />
            </Field>
            <Field label={t('photoUrl')} error={errors.photo_url?.message}>
              <Input placeholder="https://…" {...form.register('photo_url')} />
            </Field>
            <Field label={t('sortOrder')} error={errors.sort_order?.message}>
              <Input type="number" {...form.register('sort_order')} />
            </Field>
            <Field label={t('about')} error={errors.bio?.message} className="sm:col-span-2">
              <Textarea rows={3} {...form.register('bio')} />
            </Field>
            <div className="flex flex-wrap gap-6 sm:col-span-2">
              <SwitchField form={form} name="is_active" label={t('listedPublicly')} />
              <SwitchField form={form} name="accepting_bookings" label={t('acceptingBookings')} />
              <SwitchField form={form} name="can_self_manage_session" label={t('selfManage')} />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="animate-spin" />}{' '}
                {t('saveProfile')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {!isNew && <ShiftsCard doctorId={doctorId} hospitalId={hospital.id} />}
    </div>
  )
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  const t = useT(messages)
  return (
    <div className={className}>
      <Label className="mb-1.5">{label}</Label>
      {children}
      {error && <p className="mt-1 text-sm text-destructive">{errorText(t, error)}</p>}
    </div>
  )
}

function SwitchField({
  form,
  name,
  label,
}: {
  form: ReturnType<
    typeof useForm<z.input<typeof doctorSchema>, unknown, z.output<typeof doctorSchema>>
  >
  name: 'is_active' | 'accepting_bookings' | 'can_self_manage_session'
  label: string
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={field.value} onCheckedChange={field.onChange} />
          {label}
        </label>
      )}
    />
  )
}

// ---------------------------------------------------------------------------
const shiftSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    start_time: z.string().regex(/^\d{2}:\d{2}$/, 'v.time'),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, 'v.time'),
    max_tokens: z.coerce.number().int().min(1).max(500),
    walkin_reserved: z.coerce.number().int().min(0),
    booking_cutoff_minutes: z.coerce.number().int().min(0).max(720),
    avg_consult_minutes: z.coerce.number().int().min(1).max(120),
    booking_fee: z
      .string()
      .trim()
      .regex(/^(\d{0,6}(\.\d{1,2})?)?$/, 'v.feeOrBlank')
      .transform((v) => (v === '' ? null : Math.round(Number(v) * 100))),
    is_active: z.boolean(),
    weekdays: z.array(z.number().int().min(0).max(6)),
  })
  .refine((v) => v.end_time > v.start_time, {
    message: 'v.endAfterStart',
    path: ['end_time'],
  })
  .refine((v) => v.walkin_reserved < v.max_tokens, {
    message: 'v.lessThanTotal',
    path: ['walkin_reserved'],
  })

function ShiftsCard({ doctorId, hospitalId }: { doctorId: string; hospitalId: string }) {
  const queryClient = useQueryClient()
  const today = useToday()
  const t = useT(messages)
  const { lang } = useLanguage()
  const weekdays = useMemo(() => weekdayNames(lang), [lang])
  const shifts = useQuery({
    queryKey: ['admin-shifts', doctorId],
    queryFn: () => fetchDoctorShifts(doctorId),
  })
  const [editing, setEditing] = useState<ShiftWithDays | 'new' | null>(null)

  const form = useForm<z.input<typeof shiftSchema>, unknown, z.output<typeof shiftSchema>>({
    resolver: zodResolver(shiftSchema, { error: zodText }),
  })
  const errors = form.formState.errors

  const open = (s: ShiftWithDays | 'new') => {
    setEditing(s)
    form.reset(
      s === 'new'
        ? {
            name: 'Morning OPD',
            start_time: '09:00',
            end_time: '13:00',
            max_tokens: 30,
            walkin_reserved: 5,
            booking_cutoff_minutes: 30,
            avg_consult_minutes: 10,
            booking_fee: '',
            is_active: true,
            weekdays: [1, 2, 3, 4, 5, 6],
          }
        : {
            name: s.name,
            start_time: s.start_time.slice(0, 5),
            end_time: s.end_time.slice(0, 5),
            max_tokens: s.max_tokens,
            walkin_reserved: s.walkin_reserved,
            booking_cutoff_minutes: s.booking_cutoff_minutes,
            avg_consult_minutes: s.avg_consult_minutes,
            booking_fee: s.booking_fee_paise == null ? '' : String(s.booking_fee_paise / 100),
            is_active: s.is_active,
            weekdays: s.weekdays,
          },
    )
  }

  const save = useMutation({
    mutationFn: async (v: z.output<typeof shiftSchema>) => {
      const { booking_fee, ...rest } = v
      await saveShift(
        {
          ...rest,
          id: editing && editing !== 'new' ? editing.id : undefined,
          hospital_id: hospitalId,
          doctor_id: doctorId,
          booking_fee_paise: booking_fee,
        },
        today,
      )
    },
    onSuccess: () => {
      toast.success(t('shiftSaved'))
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-shifts', doctorId] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t('shiftsTitle')}</CardTitle>
        <Button size="sm" onClick={() => open('new')}>
          <Plus /> {t('addShift')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {shifts.isPending ? (
          <PageSpinner />
        ) : shifts.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noShifts')}</p>
        ) : (
          shifts.data?.map((s) => (
            <div
              key={s.id}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">
                  {s.name} · {formatTimeRange(s.start_time, s.end_time)}{' '}
                  {!s.is_active && <ToneBadge color="grey">{t('inactive')}</ToneBadge>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[
                    s.weekdays.length
                      ? s.weekdays.map((w) => weekdays[w]).join(', ')
                      : t('noWeekdays'),
                    t('shiftSummary', {
                      tokens: s.max_tokens,
                      walkIns: s.walkin_reserved,
                      minutes: s.avg_consult_minutes,
                    }),
                    s.booking_fee_paise == null
                      ? t('defaultFee')
                      : s.booking_fee_paise
                        ? formatMoney(s.booking_fee_paise)
                        : t('free'),
                  ].join(' · ')}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => open(s)}>
                {t('edit')}
              </Button>
            </div>
          ))
        )}
        <p className="pt-2 text-xs text-muted-foreground">{t('overlapNote')}</p>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? t('addShift') : t('editShift')}</DialogTitle>
          </DialogHeader>
          <form
            id="shift-form"
            onSubmit={form.handleSubmit((v) => save.mutate(v))}
            className="grid grid-cols-2 gap-3"
            noValidate
          >
            <Field label={t('name')} error={errors.name?.message} className="col-span-2">
              <Input {...form.register('name')} />
            </Field>
            <Field label={t('start')} error={errors.start_time?.message}>
              <Input type="time" {...form.register('start_time')} />
            </Field>
            <Field label={t('end')} error={errors.end_time?.message}>
              <Input type="time" {...form.register('end_time')} />
            </Field>
            <Field label={t('maxTokens')} error={errors.max_tokens?.message}>
              <Input type="number" {...form.register('max_tokens')} />
            </Field>
            <Field label={t('walkinReserved')} error={errors.walkin_reserved?.message}>
              <Input type="number" {...form.register('walkin_reserved')} />
            </Field>
            <Field label={t('onlineCutoff')} error={errors.booking_cutoff_minutes?.message}>
              <Input type="number" {...form.register('booking_cutoff_minutes')} />
            </Field>
            <Field label={t('avgConsult')} error={errors.avg_consult_minutes?.message}>
              <Input type="number" {...form.register('avg_consult_minutes')} />
            </Field>
            <Field
              label={t('bookingFee')}
              error={errors.booking_fee?.message}
              className="col-span-2"
            >
              <Input inputMode="decimal" {...form.register('booking_fee')} />
            </Field>
            <fieldset className="col-span-2">
              <legend className="mb-1.5 text-sm font-medium">{t('runsOn')}</legend>
              <Controller
                control={form.control}
                name="weekdays"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-3">
                    {weekdays.map((d, i) => (
                      <label key={d} className="flex items-center gap-1.5 text-sm">
                        <Checkbox
                          checked={field.value?.includes(i)}
                          onCheckedChange={(c) =>
                            field.onChange(
                              c
                                ? [...(field.value ?? []), i].sort()
                                : (field.value ?? []).filter((x) => x !== i),
                            )
                          }
                        />
                        {d}
                      </label>
                    ))}
                  </div>
                )}
              />
            </fieldset>
            <Controller
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <label className="col-span-2 flex items-center gap-2 text-sm">
                  <Switch checked={field.value} onCheckedChange={field.onChange} /> {t('active')}
                </label>
              )}
            />
          </form>
          <DialogFooter>
            <Button type="submit" form="shift-form" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} {t('saveShift')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
