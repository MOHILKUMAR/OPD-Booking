import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import { errorMessage } from '@/lib/errors'
import { formatMoney, formatTimeRange } from '@/lib/format'

const rupees = z
  .string()
  .trim()
  .regex(/^\d{0,6}(\.\d{1,2})?$/, 'Enter an amount in rupees')
  .transform((v) => Math.round(Number(v || '0') * 100))

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))

const doctorSchema = z.object({
  full_name: z.string().trim().min(3, 'Enter the doctor’s name').max(120),
  department_id: z.uuid('Choose a department'),
  specialty: z.string().trim().min(2, 'Enter a specialty').max(80),
  qualifications: optionalText(200),
  bio: optionalText(1000),
  photo_url: optionalText(500).refine(
    (v) => v === null || /^(https:\/\/|\/)/.test(v),
    'Use an https:// URL',
  ),
  room_no: optionalText(20),
  consultation_fee: rupees,
  accepting_bookings: z.boolean(),
  can_self_manage_session: z.boolean(),
  is_active: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(9999),
})

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function DoctorEditPage() {
  const { doctorId = 'new' } = useParams()
  const isNew = doctorId === 'new'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: hospital } = useHospital()

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
    resolver: zodResolver(doctorSchema),
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
      toast.success('Doctor saved')
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
          <ArrowLeft /> Doctors
        </Link>
      </Button>
      <PageHeader title={isNew ? 'Add doctor' : (doctor.data?.full_name ?? 'Doctor')} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Field label="Full name" error={errors.full_name?.message}>
              <Input {...form.register('full_name')} />
            </Field>
            <Field label="Department" error={errors.department_id?.message}>
              <Controller
                control={form.control}
                name="department_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose" />
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
            <Field label="Specialty" error={errors.specialty?.message}>
              <Input {...form.register('specialty')} />
            </Field>
            <Field
              label="Qualifications (exactly as provided by the hospital)"
              error={errors.qualifications?.message}
            >
              <Input {...form.register('qualifications')} />
            </Field>
            <Field label="Room" error={errors.room_no?.message}>
              <Input {...form.register('room_no')} />
            </Field>
            <Field
              label="Consultation fee (₹, paid at hospital)"
              error={errors.consultation_fee?.message}
            >
              <Input inputMode="decimal" {...form.register('consultation_fee')} />
            </Field>
            <Field label="Photo URL (optional)" error={errors.photo_url?.message}>
              <Input placeholder="https://…" {...form.register('photo_url')} />
            </Field>
            <Field label="Sort order" error={errors.sort_order?.message}>
              <Input type="number" {...form.register('sort_order')} />
            </Field>
            <Field label="About (optional)" error={errors.bio?.message} className="sm:col-span-2">
              <Textarea rows={3} {...form.register('bio')} />
            </Field>
            <div className="flex flex-wrap gap-6 sm:col-span-2">
              <SwitchField form={form} name="is_active" label="Active (listed publicly)" />
              <SwitchField
                form={form}
                name="accepting_bookings"
                label="Accepting online bookings"
              />
              <SwitchField
                form={form}
                name="can_self_manage_session"
                label="Doctor may start/stop own OPD"
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Save profile
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
  return (
    <div className={className}>
      <Label className="mb-1.5">{label}</Label>
      {children}
      {error && <p className="mt-1 text-sm text-destructive">{error}</p>}
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
    start_time: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
    end_time: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM'),
    max_tokens: z.coerce.number().int().min(1).max(500),
    walkin_reserved: z.coerce.number().int().min(0),
    booking_cutoff_minutes: z.coerce.number().int().min(0).max(720),
    avg_consult_minutes: z.coerce.number().int().min(1).max(120),
    booking_fee: z
      .string()
      .trim()
      .regex(/^(\d{0,6}(\.\d{1,2})?)?$/, 'Rupees, or blank for the hospital default')
      .transform((v) => (v === '' ? null : Math.round(Number(v) * 100))),
    is_active: z.boolean(),
    weekdays: z.array(z.number().int().min(0).max(6)),
  })
  .refine((v) => v.end_time > v.start_time, {
    message: 'End must be after start',
    path: ['end_time'],
  })
  .refine((v) => v.walkin_reserved < v.max_tokens, {
    message: 'Must be less than total tokens',
    path: ['walkin_reserved'],
  })

function ShiftsCard({ doctorId, hospitalId }: { doctorId: string; hospitalId: string }) {
  const queryClient = useQueryClient()
  const today = useToday()
  const shifts = useQuery({
    queryKey: ['admin-shifts', doctorId],
    queryFn: () => fetchDoctorShifts(doctorId),
  })
  const [editing, setEditing] = useState<ShiftWithDays | 'new' | null>(null)

  const form = useForm<z.input<typeof shiftSchema>, unknown, z.output<typeof shiftSchema>>({
    resolver: zodResolver(shiftSchema),
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
      toast.success('Shift saved')
      setEditing(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-shifts', doctorId] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">OPD shifts and weekly schedule</CardTitle>
        <Button size="sm" onClick={() => open('new')}>
          <Plus /> Add shift
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {shifts.isPending ? (
          <PageSpinner />
        ) : shifts.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No shifts yet.</p>
        ) : (
          shifts.data?.map((s) => (
            <div
              key={s.id}
              className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">
                  {s.name} · {formatTimeRange(s.start_time, s.end_time)}{' '}
                  {!s.is_active && <ToneBadge color="grey">Inactive</ToneBadge>}
                </p>
                <p className="text-sm text-muted-foreground">
                  {s.weekdays.length
                    ? s.weekdays.map((w) => WEEKDAYS[w]).join(', ')
                    : 'No weekdays'}{' '}
                  · {s.max_tokens} tokens ({s.walkin_reserved} for walk-ins) · ~
                  {s.avg_consult_minutes} min each ·{' '}
                  {s.booking_fee_paise == null
                    ? 'hospital default fee'
                    : s.booking_fee_paise
                      ? formatMoney(s.booking_fee_paise)
                      : 'free'}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => open(s)}>
                Edit
              </Button>
            </div>
          ))
        )}
        <p className="pt-2 text-xs text-muted-foreground">
          Overlapping shifts for the same doctor on the same weekday are rejected by the database.
          Use Holidays &amp; closures for one-off changes.
        </p>
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing === 'new' ? 'Add shift' : 'Edit shift'}</DialogTitle>
          </DialogHeader>
          <form
            id="shift-form"
            onSubmit={form.handleSubmit((v) => save.mutate(v))}
            className="grid grid-cols-2 gap-3"
            noValidate
          >
            <Field label="Name" error={errors.name?.message} className="col-span-2">
              <Input {...form.register('name')} />
            </Field>
            <Field label="Start" error={errors.start_time?.message}>
              <Input type="time" {...form.register('start_time')} />
            </Field>
            <Field label="End" error={errors.end_time?.message}>
              <Input type="time" {...form.register('end_time')} />
            </Field>
            <Field label="Max tokens" error={errors.max_tokens?.message}>
              <Input type="number" {...form.register('max_tokens')} />
            </Field>
            <Field label="Reserved for walk-ins" error={errors.walkin_reserved?.message}>
              <Input type="number" {...form.register('walkin_reserved')} />
            </Field>
            <Field
              label="Online cutoff (min before end)"
              error={errors.booking_cutoff_minutes?.message}
            >
              <Input type="number" {...form.register('booking_cutoff_minutes')} />
            </Field>
            <Field label="Avg consultation (min)" error={errors.avg_consult_minutes?.message}>
              <Input type="number" {...form.register('avg_consult_minutes')} />
            </Field>
            <Field
              label="Booking fee ₹ (blank = default)"
              error={errors.booking_fee?.message}
              className="col-span-2"
            >
              <Input inputMode="decimal" {...form.register('booking_fee')} />
            </Field>
            <fieldset className="col-span-2">
              <legend className="mb-1.5 text-sm font-medium">Runs on</legend>
              <Controller
                control={form.control}
                name="weekdays"
                render={({ field }) => (
                  <div className="flex flex-wrap gap-3">
                    {WEEKDAYS.map((d, i) => (
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
                  <Switch checked={field.value} onCheckedChange={field.onChange} /> Active
                </label>
              )}
            />
          </form>
          <DialogFooter>
            <Button type="submit" form="shift-form" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save shift
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
