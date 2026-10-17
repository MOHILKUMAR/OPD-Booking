import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { updateHospital } from '@/api/admin'
import { PageHeader, PageSpinner } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { useHospital } from '@/hooks/useHospital'
import { env } from '@/lib/env'
import { errorMessage } from '@/lib/errors'

const nullable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  tagline: nullable(160),
  address_line: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  postal_code: nullable(6).refine((v) => v === null || /^\d{6}$/.test(v), '6-digit PIN code'),
  phone: nullable(30),
  emergency_phone: nullable(30),
  email: nullable(254).refine((v) => v === null || z.email().safeParse(v).success, 'Invalid email'),
  map_url: nullable(500).refine(
    (v) => v === null || v.startsWith('https://'),
    'Use an https:// link',
  ),
  logo_url: nullable(500).refine(
    (v) => v === null || /^(https:\/\/|\/)/.test(v),
    'Use an https:// link',
  ),
  visit_instructions: nullable(1000),
  operating_hours: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        hours: z.string().trim().min(1).max(80),
      }),
    )
    .max(10),
  booking_window_days: z.coerce.number().int().min(0).max(14),
  cancel_cutoff_minutes: z.coerce.number().int().min(0).max(1440),
  duplicate_policy: z.enum(['PHONE', 'PHONE_AND_NAME']),
  max_bookings_per_phone_per_day: z.coerce.number().int().min(1).max(20),
  require_patient_age: z.boolean(),
  default_booking_fee: z
    .string()
    .trim()
    .regex(/^\d{0,6}(\.\d{1,2})?$/, 'Rupees')
    .transform((v) => Math.round(Number(v || '0') * 100)),
  online_payments_enabled: z.boolean(),
  payment_hold_minutes: z.coerce.number().int().min(5).max(60),
})

export default function SettingsPage() {
  const hospital = useHospital()
  const queryClient = useQueryClient()
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
  })
  const hours = useFieldArray({ control: form.control, name: 'operating_hours' })
  const errors = form.formState.errors

  useEffect(() => {
    const h = hospital.data
    if (!h) return
    form.reset({
      name: h.name,
      tagline: h.tagline ?? '',
      address_line: h.address_line,
      city: h.city,
      state: h.state,
      postal_code: h.postal_code ?? '',
      phone: h.phone ?? '',
      emergency_phone: h.emergency_phone ?? '',
      email: h.email ?? '',
      map_url: h.map_url ?? '',
      logo_url: h.logo_url ?? '',
      visit_instructions: h.visit_instructions ?? '',
      operating_hours: h.operating_hours,
      booking_window_days: h.booking_window_days,
      cancel_cutoff_minutes: h.cancel_cutoff_minutes,
      duplicate_policy: h.duplicate_policy,
      max_bookings_per_phone_per_day: h.max_bookings_per_phone_per_day,
      require_patient_age: h.require_patient_age,
      default_booking_fee: String(h.default_booking_fee_paise / 100),
      online_payments_enabled: h.online_payments_enabled,
      payment_hold_minutes: h.payment_hold_minutes,
    })
  }, [hospital.data, form])

  const onSubmit = form.handleSubmit(async (v) => {
    const { default_booking_fee, ...rest } = v
    try {
      await updateHospital(hospital.data!.id, {
        ...rest,
        default_booking_fee_paise: default_booking_fee,
      })
      toast.success('Settings saved (recorded in the audit log)')
      void queryClient.invalidateQueries({ queryKey: ['hospital'] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  })

  if (hospital.isPending || !hospital.data) return <PageSpinner />

  const text = (
    name: keyof z.input<typeof schema>,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <div className="space-y-1.5">
      <Label htmlFor={`set-${name}`}>{label}</Label>
      <Input id={`set-${name}`} {...props} {...form.register(name as never)} />
      {errors[name] && <p className="text-sm text-destructive">{String(errors[name]?.message)}</p>}
    </div>
  )
  const toggle = (name: 'require_patient_age' | 'online_payments_enabled', label: string) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={!!field.value} onCheckedChange={field.onChange} /> {label}
        </label>
      )}
    />
  )

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <PageHeader
        title="Hospital settings"
        actions={
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Save settings
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hospital profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {text('name', 'Name')}
          {text('tagline', 'Tagline')}
          {text('address_line', 'Address')}
          {text('city', 'City')}
          {text('state', 'State')}
          {text('postal_code', 'PIN code', { inputMode: 'numeric' })}
          {text('phone', 'Phone')}
          {text('emergency_phone', 'Emergency number')}
          {text('email', 'Email')}
          {text('map_url', 'Map link')}
          {text('logo_url', 'Logo URL')}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="set-visit">Visit instructions</Label>
            <Textarea id="set-visit" rows={3} {...form.register('visit_instructions')} />
          </div>
          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">Operating hours</legend>
            {hours.fields.map((f, i) => (
              <div key={f.id} className="flex gap-2">
                <Input
                  aria-label="Label"
                  placeholder="OPD, Mon - Sat"
                  {...form.register(`operating_hours.${i}.label`)}
                />
                <Input
                  aria-label="Hours"
                  placeholder="09:00 - 13:00"
                  {...form.register(`operating_hours.${i}.hours`)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Remove"
                  onClick={() => hours.remove(i)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => hours.append({ label: '', hours: '' })}
            >
              <Plus /> Add row
            </Button>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Booking policy</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {text('booking_window_days', 'Days ahead patients can book (0 = today only)', {
            type: 'number',
          })}
          {text('cancel_cutoff_minutes', 'Online cancellation closes (minutes before OPD start)', {
            type: 'number',
          })}
          {text('max_bookings_per_phone_per_day', 'Max online bookings per phone per day', {
            type: 'number',
          })}
          <div className="space-y-1.5">
            <Label>Duplicate-booking rule</Label>
            <Controller
              control={form.control}
              name="duplicate_policy"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PHONE">
                      One active token per phone, doctor and session
                    </SelectItem>
                    <SelectItem value="PHONE_AND_NAME">
                      One per phone + patient name (families)
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          {toggle('require_patient_age', 'Patient age is required')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fees and online payment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {text('default_booking_fee', 'Default booking fee (₹, 0 = free)', {
            inputMode: 'decimal',
          })}
          {text('payment_hold_minutes', 'Minutes a slot is held during payment', {
            type: 'number',
          })}
          <div className="sm:col-span-2">
            {toggle('online_payments_enabled', 'Collect booking fees online (Razorpay)')}
          </div>
          <Alert className="sm:col-span-2">
            <AlertTitle>Before enabling online payments</AlertTitle>
            <AlertDescription>
              <p>
                Payments also need VITE_PAYMENTS_ENABLED={String(env.VITE_PAYMENTS_ENABLED)} in the
                frontend and PAYMENTS_ENABLED + Razorpay secrets on the Edge Functions. Use test
                mode until merchant approval, fees (about 2% + GST) and refund handling are
                confirmed. With online payments off, any fee is shown as payable at the hospital.
              </p>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </form>
  )
}
