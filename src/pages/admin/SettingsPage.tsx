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
import { defineMessages, tr, useT } from '@/i18n'
import { env } from '@/lib/env'
import { errorMessage } from '@/lib/errors'

const messages = defineMessages({
  en: {
    saved: 'Settings saved (recorded in the audit log)',
    title: 'Hospital settings',
    saveSettings: 'Save settings',

    profile: 'Hospital profile',
    name: 'Name',
    tagline: 'Tagline',
    address: 'Address',
    city: 'City',
    state: 'State',
    pinCode: 'PIN code',
    phone: 'Phone',
    emergencyNumber: 'Emergency number',
    email: 'Email',
    mapLink: 'Map link',
    logoUrl: 'Logo URL',
    visitInstructions: 'Visit instructions',
    operatingHours: 'Operating hours',
    hoursLabel: 'Label',
    hoursLabelPlaceholder: 'OPD, Mon - Sat',
    hours: 'Hours',
    remove: 'Remove',
    addRow: 'Add row',

    bookingPolicy: 'Booking policy',
    bookingWindow: 'Days ahead patients can book (0 = today only)',
    cancelCutoff: 'Online cancellation closes (minutes before OPD start)',
    maxPerPhone: 'Max online bookings per phone per day',
    duplicateRule: 'Duplicate-booking rule',
    duplicatePhone: 'One active token per phone, doctor and session',
    duplicatePhoneName: 'One per phone + patient name (families)',
    requireAge: 'Patient age is required',

    fees: 'Fees and online payment',
    defaultFee: 'Default booking fee (₹, 0 = free)',
    holdMinutes: 'Minutes a slot is held during payment',
    collectOnline: 'Collect booking fees online (Razorpay)',
    beforeTitle: 'Before enabling online payments',
    beforeBody:
      'Payments also need VITE_PAYMENTS_ENABLED={value} in the frontend and PAYMENTS_ENABLED + Razorpay secrets on the Edge Functions. Use test mode until merchant approval, fees (about 2% + GST) and refund handling are confirmed. With online payments off, any fee is shown as payable at the hospital.',
    autoRefund: 'Refund cancelled paid bookings automatically',
    autoRefundBody:
      'Patient cancellations (before the cut-off) and bookings the hospital cancels are sent to Razorpay within about a minute, without waiting for an administrator. Patients see “refund initiated” when Razorpay accepts it and “refund processed” when it confirms. Refunds that fail, or are above the limit, stay on the Payments page.',
    autoRefundMax: 'Automatic refund limit (₹, empty = no limit)',

    alerts: 'Patient alerts',
    turnAlert: '“Your turn is near” when this many patients are ahead (0 = off)',
    visitReminder: 'Visit reminder, minutes before the OPD starts (0 = off)',
    alertsBody:
      'Alerts are free: they appear on the patient’s tracking page and My bookings, and as a phone notification while the tracking page is open (the patient allows it once). Delays of 15 minutes or more are announced automatically.',
    smsAlerts: 'Also send alerts by SMS',
    smsTitle: 'Paid service: needs a provider before it does anything',
    smsBody:
      'SMS in India costs about ₹0.15–0.30 per message and needs DLT registration and approved templates. Until an SMS provider is set up on the server (MESSAGE_PROVIDER), queued messages are not sent and are marked failed. Leave this off unless the provider and its cost are approved.',
    whatsappAlerts: 'Offer WhatsApp updates to patients',
    whatsappTitle: 'Paid service: Meta charges per message',
    whatsappBody:
      'Patients who opt in on their tracking page get a WhatsApp message when their turn is near and before their visit (2 approved templates, English and Hindi). Meta charges about ₹0.12–0.15 per message, plus any reseller fee; check Meta’s current India pricing. Nothing is sent until the WhatsApp secrets are set on the server (docs/deployment.md). Patients can stop at any time on the tracking page or by replying STOP. Leave this off unless the cost is approved.',

    'v.pinCode': '6-digit PIN code',
    'v.email': 'Invalid email',
    'v.httpsLink': 'Use an https:// link',
    'v.rupees': 'Rupees',
    'v.refundLimit': 'Rupees, or empty for no limit',
    'v.refundLimitMin': 'At least ₹1, or empty for no limit',

    // zod's built-in checks: empty keeps zod's own English message (see zodText).
    'z.minChars': '',
    'z.maxChars': '',
    'z.min': '',
    'z.max': '',
    'z.number': '',
    'z.invalid': '',
  },
  hi: {
    saved: 'सेटिंग्स सहेजी गईं (ऑडिट लॉग में दर्ज)',
    title: 'अस्पताल सेटिंग्स',
    saveSettings: 'सेटिंग्स सहेजें',

    profile: 'अस्पताल की प्रोफ़ाइल',
    name: 'नाम',
    tagline: 'टैगलाइन',
    address: 'पता',
    city: 'शहर',
    state: 'राज्य',
    pinCode: 'पिन कोड',
    phone: 'फ़ोन',
    emergencyNumber: 'आपातकालीन नंबर',
    email: 'ईमेल',
    mapLink: 'मैप लिंक',
    logoUrl: 'लोगो URL',
    visitInstructions: 'अस्पताल आने के निर्देश',
    operatingHours: 'खुलने का समय',
    hoursLabel: 'लेबल',
    hoursLabelPlaceholder: 'ओपीडी, सोम - शनि',
    hours: 'समय',
    remove: 'हटाएँ',
    addRow: 'पंक्ति जोड़ें',

    bookingPolicy: 'बुकिंग नीति',
    bookingWindow: 'मरीज़ कितने दिन आगे तक बुक कर सकते हैं (0 = केवल आज)',
    cancelCutoff: 'ऑनलाइन रद्द करना कब बंद हो (ओपीडी शुरू होने से कितने मिनट पहले)',
    maxPerPhone: 'एक फ़ोन नंबर से एक दिन में अधिकतम ऑनलाइन बुकिंग',
    duplicateRule: 'दोहरी बुकिंग का नियम',
    duplicatePhone: 'हर फ़ोन, डॉक्टर और सत्र पर एक सक्रिय टोकन',
    duplicatePhoneName: 'हर फ़ोन + मरीज़ के नाम पर एक (परिवारों के लिए)',
    requireAge: 'मरीज़ की उम्र ज़रूरी है',

    fees: 'शुल्क और ऑनलाइन भुगतान',
    defaultFee: 'डिफ़ॉल्ट बुकिंग शुल्क (₹, 0 = निःशुल्क)',
    holdMinutes: 'भुगतान के दौरान स्लॉट कितने मिनट रोका जाए',
    collectOnline: 'बुकिंग शुल्क ऑनलाइन लें (Razorpay)',
    beforeTitle: 'ऑनलाइन भुगतान चालू करने से पहले',
    beforeBody:
      'भुगतान के लिए फ़्रंटएंड में VITE_PAYMENTS_ENABLED={value} और Edge Functions पर PAYMENTS_ENABLED + Razorpay सीक्रेट भी ज़रूरी हैं। जब तक मर्चेंट मंज़ूरी, शुल्क (लगभग 2% + GST) और रिफ़ंड की व्यवस्था पक्की न हो जाए, टेस्ट मोड ही इस्तेमाल करें। ऑनलाइन भुगतान बंद होने पर कोई भी शुल्क अस्पताल में देय दिखाया जाता है।',
    autoRefund: 'रद्द हुई सशुल्क बुकिंग का रिफ़ंड अपने-आप करें',
    autoRefundBody:
      'मरीज़ों द्वारा (कट-ऑफ़ से पहले) रद्द की गई और अस्पताल द्वारा रद्द की गई बुकिंग के रिफ़ंड, किसी एडमिन का इंतज़ार किए बिना, लगभग एक मिनट में Razorpay को भेज दिए जाते हैं। Razorpay के स्वीकार करने पर मरीज़ों को “रिफ़ंड शुरू हुआ” और पुष्टि होने पर “रिफ़ंड पूरा हुआ” दिखता है। जो रिफ़ंड विफल हों, या सीमा से ज़्यादा हों, वे “भुगतान और रिफ़ंड” पेज पर ही रहते हैं।',
    autoRefundMax: 'स्वचालित रिफ़ंड की सीमा (₹, ख़ाली = कोई सीमा नहीं)',

    alerts: 'मरीज़ों के लिए अलर्ट',
    turnAlert: '“आपकी बारी नज़दीक है” अलर्ट, जब आगे इतने मरीज़ बचे हों (0 = बंद)',
    visitReminder: 'आने का रिमाइंडर, ओपीडी शुरू होने से कितने मिनट पहले (0 = बंद)',
    alertsBody:
      'अलर्ट मुफ़्त हैं: ये मरीज़ के ट्रैकिंग पेज और “मेरी बुकिंग” में दिखते हैं, और ट्रैकिंग पेज खुला रहने पर फ़ोन नोटिफ़िकेशन के रूप में भी आते हैं (मरीज़ एक बार अनुमति देता है)। 15 मिनट या उससे ज़्यादा की देरी की सूचना अपने-आप दी जाती है।',
    smsAlerts: 'अलर्ट SMS से भी भेजें',
    smsTitle: 'सशुल्क सेवा: प्रदाता सेट होने से पहले यह कुछ नहीं करती',
    smsBody:
      'भारत में SMS का ख़र्च लगभग ₹0.15–0.30 प्रति संदेश है, और इसके लिए DLT पंजीकरण और स्वीकृत टेम्पलेट ज़रूरी हैं। जब तक सर्वर पर SMS प्रदाता (MESSAGE_PROVIDER) सेट नहीं होता, भेजने के लिए रखे गए संदेश नहीं भेजे जाते और विफल दर्ज होते हैं। जब तक प्रदाता और उसका ख़र्च स्वीकृत न हो, इसे बंद ही रखें।',
    whatsappAlerts: 'मरीज़ों को WhatsApp अपडेट का विकल्प दें',
    whatsappTitle: 'सशुल्क सेवा: Meta हर संदेश का शुल्क लेता है',
    whatsappBody:
      'जो मरीज़ अपने ट्रैकिंग पेज पर सहमति देते हैं, उन्हें बारी नज़दीक आने पर और आने से पहले WhatsApp संदेश मिलता है (2 स्वीकृत टेम्पलेट, अंग्रेज़ी और हिन्दी)। Meta लगभग ₹0.12–0.15 प्रति संदेश लेता है, साथ में किसी रीसेलर का शुल्क भी हो सकता है; भारत के लिए Meta की मौजूदा दरें देख लें। जब तक सर्वर पर WhatsApp सीक्रेट सेट नहीं होते (docs/deployment.md), कोई संदेश नहीं भेजा जाता। मरीज़ ट्रैकिंग पेज पर या STOP लिखकर कभी भी इन्हें बंद कर सकते हैं। जब तक ख़र्च स्वीकृत न हो, इसे बंद ही रखें।',

    'v.pinCode': '6 अंकों का पिन कोड',
    'v.email': 'ईमेल सही नहीं है',
    'v.httpsLink': 'https:// वाला लिंक डालें',
    'v.rupees': 'राशि रुपये में लिखें',
    'v.refundLimit': 'राशि रुपये में लिखें, या कोई सीमा न हो तो ख़ाली छोड़ें',
    'v.refundLimitMin': 'कम से कम ₹1, या कोई सीमा न हो तो ख़ाली छोड़ें',

    'z.minChars': 'कम से कम {n} अक्षर लिखें',
    'z.maxChars': 'अधिकतम {n} अक्षर लिखें',
    'z.min': 'कम से कम {n} होना चाहिए',
    'z.max': 'अधिकतम {n} हो सकता है',
    'z.number': 'पूरी संख्या लिखें',
    'z.invalid': 'यह मान सही नहीं है',
  },
})
type Key = keyof typeof messages.en

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

const nullable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))

// Custom messages are message keys, translated where they are shown.
const schema = z.object({
  name: z.string().trim().min(2).max(120),
  tagline: nullable(160),
  address_line: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  postal_code: nullable(6).refine((v) => v === null || /^\d{6}$/.test(v), 'v.pinCode'),
  phone: nullable(30),
  emergency_phone: nullable(30),
  email: nullable(254).refine((v) => v === null || z.email().safeParse(v).success, 'v.email'),
  map_url: nullable(500).refine((v) => v === null || v.startsWith('https://'), 'v.httpsLink'),
  logo_url: nullable(500).refine((v) => v === null || /^(https:\/\/|\/)/.test(v), 'v.httpsLink'),
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
    .regex(/^\d{0,6}(\.\d{1,2})?$/, 'v.rupees')
    .transform((v) => Math.round(Number(v || '0') * 100)),
  online_payments_enabled: z.boolean(),
  payment_hold_minutes: z.coerce.number().int().min(5).max(60),
  auto_refund_enabled: z.boolean(),
  auto_refund_max: z
    .string()
    .trim()
    .regex(/^(\d{1,6}(\.\d{1,2})?)?$/, 'v.refundLimit')
    .transform((v) => (v === '' ? null : Math.round(Number(v) * 100)))
    .refine((v) => v === null || v >= 100, 'v.refundLimitMin'),
  turn_alert_ahead: z.coerce.number().int().min(0).max(20),
  visit_reminder_minutes: z.coerce.number().int().min(0).max(1440),
  sms_alerts_enabled: z.boolean(),
  whatsapp_alerts_enabled: z.boolean(),
})

export default function SettingsPage() {
  const hospital = useHospital()
  const queryClient = useQueryClient()
  const t = useT(messages)
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema, { error: zodText }),
  })
  const hours = useFieldArray({ control: form.control, name: 'operating_hours' })
  const errors = form.formState.errors
  /** Our schema messages are message keys; zod's own messages are already text. */
  const errorText = (message: string) => (message in messages.en ? t(message as Key) : message)

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
      auto_refund_enabled: h.auto_refund_enabled,
      auto_refund_max:
        h.auto_refund_max_paise === null ? '' : String(h.auto_refund_max_paise / 100),
      turn_alert_ahead: h.turn_alert_ahead,
      visit_reminder_minutes: h.visit_reminder_minutes,
      sms_alerts_enabled: h.sms_alerts_enabled,
      whatsapp_alerts_enabled: h.whatsapp_alerts_enabled,
    })
  }, [hospital.data, form])

  const onSubmit = form.handleSubmit(async (v) => {
    const { default_booking_fee, auto_refund_max, ...rest } = v
    try {
      await updateHospital(hospital.data!.id, {
        ...rest,
        default_booking_fee_paise: default_booking_fee,
        auto_refund_max_paise: auto_refund_max,
      })
      toast.success(t('saved'))
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
      {errors[name] && (
        <p className="text-sm text-destructive">{errorText(String(errors[name]?.message))}</p>
      )}
    </div>
  )
  const toggle = (
    name:
      | 'require_patient_age'
      | 'online_payments_enabled'
      | 'auto_refund_enabled'
      | 'sms_alerts_enabled'
      | 'whatsapp_alerts_enabled',
    label: string,
  ) => (
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
        title={t('title')}
        actions={
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}{' '}
            {t('saveSettings')}
          </Button>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('profile')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {text('name', t('name'))}
          {text('tagline', t('tagline'))}
          {text('address_line', t('address'))}
          {text('city', t('city'))}
          {text('state', t('state'))}
          {text('postal_code', t('pinCode'), { inputMode: 'numeric' })}
          {text('phone', t('phone'))}
          {text('emergency_phone', t('emergencyNumber'))}
          {text('email', t('email'))}
          {text('map_url', t('mapLink'))}
          {text('logo_url', t('logoUrl'))}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="set-visit">{t('visitInstructions')}</Label>
            <Textarea id="set-visit" rows={3} {...form.register('visit_instructions')} />
          </div>
          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">{t('operatingHours')}</legend>
            {hours.fields.map((f, i) => (
              <div key={f.id} className="flex gap-2">
                <Input
                  aria-label={t('hoursLabel')}
                  placeholder={t('hoursLabelPlaceholder')}
                  {...form.register(`operating_hours.${i}.label`)}
                />
                <Input
                  aria-label={t('hours')}
                  placeholder="09:00 - 13:00"
                  {...form.register(`operating_hours.${i}.hours`)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t('remove')}
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
              <Plus /> {t('addRow')}
            </Button>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('bookingPolicy')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {text('booking_window_days', t('bookingWindow'), { type: 'number' })}
          {text('cancel_cutoff_minutes', t('cancelCutoff'), { type: 'number' })}
          {text('max_bookings_per_phone_per_day', t('maxPerPhone'), { type: 'number' })}
          <div className="space-y-1.5">
            <Label>{t('duplicateRule')}</Label>
            <Controller
              control={form.control}
              name="duplicate_policy"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PHONE">{t('duplicatePhone')}</SelectItem>
                    <SelectItem value="PHONE_AND_NAME">{t('duplicatePhoneName')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          {toggle('require_patient_age', t('requireAge'))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('fees')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {text('default_booking_fee', t('defaultFee'), { inputMode: 'decimal' })}
          {text('payment_hold_minutes', t('holdMinutes'), { type: 'number' })}
          <div className="sm:col-span-2">
            {toggle('online_payments_enabled', t('collectOnline'))}
          </div>
          <Alert className="sm:col-span-2">
            <AlertTitle>{t('beforeTitle')}</AlertTitle>
            <AlertDescription>
              <p>{t('beforeBody', { value: String(env.VITE_PAYMENTS_ENABLED) })}</p>
            </AlertDescription>
          </Alert>
          <div className="space-y-3 border-t pt-4 sm:col-span-2">
            {toggle('auto_refund_enabled', t('autoRefund'))}
            <p className="text-sm text-muted-foreground">{t('autoRefundBody')}</p>
            <div className="max-w-xs">
              {text('auto_refund_max', t('autoRefundMax'), { inputMode: 'decimal' })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('alerts')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {text('turn_alert_ahead', t('turnAlert'), { type: 'number' })}
          {text('visit_reminder_minutes', t('visitReminder'), { type: 'number' })}
          <p className="text-sm text-muted-foreground sm:col-span-2">{t('alertsBody')}</p>
          <div className="space-y-2 sm:col-span-2">
            {toggle('sms_alerts_enabled', t('smsAlerts'))}
            <Alert>
              <AlertTitle>{t('smsTitle')}</AlertTitle>
              <AlertDescription>
                <p>{t('smsBody')}</p>
              </AlertDescription>
            </Alert>
          </div>
          <div className="space-y-2 sm:col-span-2">
            {toggle('whatsapp_alerts_enabled', t('whatsappAlerts'))}
            <Alert>
              <AlertTitle>{t('whatsappTitle')}</AlertTitle>
              <AlertDescription>
                <p>{t('whatsappBody')}</p>
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>
    </form>
  )
}
