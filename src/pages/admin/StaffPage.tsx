import { zodResolver } from '@hookform/resolvers/zod'
import { createStaffSchema } from '@shared/schemas.ts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import { addRole, createStaff, fetchAllDoctors, fetchStaff, removeRole } from '@/api/admin'
import { useAuth } from '@/auth/AuthProvider'
import { ToneBadge } from '@/components/badges'
import { ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { useHospital } from '@/hooks/useHospital'
import { defineMessages, tr, useT } from '@/i18n'
import { errorMessage } from '@/lib/errors'
import type { AppRole } from '@/types/database'

const messages = defineMessages({
  en: {
    created: 'Staff account created. Share the temporary password securely.',
    roleAdded: 'Existing account given the new role.',
    title: 'Staff & roles',
    description:
      'Least privilege: receptionists can be limited to specific doctors. The last administrator cannot be removed.',
    addStaff: 'Add staff',
    person: 'Person',
    roles: 'Roles',
    unnamed: 'Unnamed',
    doctor: 'Doctor',
    allDoctorsBadge: 'all doctors',
    allDoctors: 'All doctors',
    'role.admin': 'admin',
    'role.receptionist': 'receptionist',
    'role.doctor': 'doctor',
    removeRole: 'Remove {role} role',
    addRole: 'Add role',
    addStaffTitle: 'Add staff account',
    fullName: 'Full name',
    workEmail: 'Work email',
    tempPassword: 'Temporary password',
    role: 'Role',
    'option.receptionist': 'Receptionist',
    'option.doctor': 'Doctor',
    'option.admin': 'Administrator',
    doctorRecord: 'Doctor record',
    doctorAccess: 'Doctor access',
    serverNote:
      'The account is created by a server function after verifying you are an administrator. Ask the person to change the password after first sign-in.',
    createAccount: 'Create account',
    grant: 'Grant',

    'v.email': 'Enter a valid email',
    'v.password': 'Use at least 10 characters',
    'v.doctor': 'Choose the doctor this login belongs to',
    'v.adminDoctor': 'Administrators are not tied to a doctor',

    // zod's built-in checks: empty keeps zod's own English message (see zodText).
    'z.minChars': '',
    'z.maxChars': '',
    'z.invalid': '',
  },
  hi: {
    created: 'स्टाफ़ खाता बन गया। अस्थायी पासवर्ड सुरक्षित तरीके से साझा करें।',
    roleAdded: 'मौजूदा खाते को नई भूमिका दे दी गई।',
    title: 'स्टाफ़ और भूमिकाएँ',
    description:
      'न्यूनतम अधिकार: रिसेप्शनिस्ट को कुछ चुने हुए डॉक्टरों तक सीमित किया जा सकता है। आख़िरी एडमिन को हटाया नहीं जा सकता।',
    addStaff: 'स्टाफ़ जोड़ें',
    person: 'व्यक्ति',
    roles: 'भूमिकाएँ',
    unnamed: 'बिना नाम',
    doctor: 'डॉक्टर',
    allDoctorsBadge: 'सभी डॉक्टर',
    allDoctors: 'सभी डॉक्टर',
    'role.admin': 'एडमिन',
    'role.receptionist': 'रिसेप्शनिस्ट',
    'role.doctor': 'डॉक्टर',
    removeRole: '{role} भूमिका हटाएँ',
    addRole: 'भूमिका जोड़ें',
    addStaffTitle: 'स्टाफ़ खाता जोड़ें',
    fullName: 'पूरा नाम',
    workEmail: 'काम का ईमेल',
    tempPassword: 'अस्थायी पासवर्ड',
    role: 'भूमिका',
    'option.receptionist': 'रिसेप्शनिस्ट',
    'option.doctor': 'डॉक्टर',
    'option.admin': 'एडमिन',
    doctorRecord: 'डॉक्टर का रिकॉर्ड',
    doctorAccess: 'किन डॉक्टरों तक पहुँच',
    serverNote:
      'खाता एक सर्वर फ़ंक्शन बनाता है, यह पुष्टि करने के बाद कि आप एडमिन हैं। उस व्यक्ति से कहें कि पहली बार साइन इन करने के बाद पासवर्ड बदल लें।',
    createAccount: 'खाता बनाएँ',
    grant: 'भूमिका दें',

    'v.email': 'सही ईमेल पता लिखें',
    'v.password': 'कम से कम 10 अक्षर रखें',
    'v.doctor': 'वह डॉक्टर चुनें जिसका यह लॉगिन है',
    'v.adminDoctor': 'एडमिन किसी डॉक्टर से जुड़े नहीं होते',

    'z.minChars': 'कम से कम {n} अक्षर लिखें',
    'z.maxChars': 'अधिकतम {n} अक्षर लिखें',
    'z.invalid': 'यह मान सही नहीं है',
  },
})
type Key = keyof typeof messages.en

// createStaffSchema is shared with the admin-create-staff Edge Function, so its messages stay
// English there; they are translated by their text when shown here.
const SCHEMA_TEXT: Record<string, Key> = {
  'Enter a valid email': 'v.email',
  'Use at least 10 characters': 'v.password',
  'Choose the doctor this login belongs to': 'v.doctor',
  'Administrators are not tied to a doctor': 'v.adminDoctor',
}

/**
 * Messages for zod's built-in checks (name length), which the shared schema leaves to zod.
 * The English 'z.*' texts are empty, so English keeps zod's own wording.
 */
const zodText: z.core.$ZodErrorMap = (iss) => {
  let text: string
  if (iss.code === 'too_small' && iss.origin === 'string') {
    text = tr(messages, 'z.minChars', { n: Number(iss.minimum) })
  } else if (iss.code === 'too_big' && iss.origin === 'string') {
    text = tr(messages, 'z.maxChars', { n: Number(iss.maximum) })
  } else {
    text = tr(messages, 'z.invalid')
  }
  return text || undefined
}

const ALL = '__all'

export default function StaffPage() {
  const { data: hospital } = useHospital()
  const auth = useAuth()
  const queryClient = useQueryClient()
  const t = useT(messages)
  const staff = useQuery({
    queryKey: ['admin-staff', hospital?.id],
    queryFn: () => fetchStaff(hospital!.id),
    enabled: !!hospital,
  })
  const doctors = useQuery({
    queryKey: ['admin-doctors', hospital?.id],
    queryFn: () => fetchAllDoctors(hospital!.id),
    enabled: !!hospital,
  })
  const [creating, setCreating] = useState(false)
  const [granting, setGranting] = useState<{
    userId: string
    role: AppRole
    doctorId: string
  } | null>(null)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['admin-staff'] })

  const form = useForm<
    z.input<typeof createStaffSchema>,
    unknown,
    z.output<typeof createStaffSchema>
  >({
    resolver: zodResolver(createStaffSchema, { error: zodText }),
    defaultValues: {
      hospital_id: hospital?.id ?? '',
      email: '',
      password: '',
      full_name: '',
      role: 'receptionist',
      doctor_id: null,
    },
  })
  const role = useWatch({ control: form.control, name: 'role' })
  const errors = form.formState.errors
  const errorText = (message?: string) => {
    const key = message ? SCHEMA_TEXT[message] : undefined
    return key ? t(key) : message
  }

  const create = useMutation({
    mutationFn: (v: z.output<typeof createStaffSchema>) => createStaff(v),
    onSuccess: (r) => {
      toast.success(r.created ? t('created') : t('roleAdded'))
      setCreating(false)
      form.reset()
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const grant = useMutation({
    mutationFn: (g: { userId: string; role: AppRole; doctorId: string }) =>
      addRole({
        user_id: g.userId,
        hospital_id: hospital!.id,
        role: g.role,
        doctor_id: g.doctorId === ALL ? null : g.doctorId,
      }),
    onSuccess: () => {
      setGranting(null)
      refresh()
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const revoke = useMutation({
    mutationFn: removeRole,
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  })

  const doctorName = (id: string | null) =>
    id ? (doctors.data?.find((d) => d.id === id)?.full_name ?? t('doctor')) : null

  const roleOptions = (
    <>
      <SelectItem value="receptionist">{t('option.receptionist')}</SelectItem>
      <SelectItem value="doctor">{t('option.doctor')}</SelectItem>
      <SelectItem value="admin">{t('option.admin')}</SelectItem>
    </>
  )

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button
            onClick={() => {
              form.reset({
                hospital_id: hospital!.id,
                email: '',
                password: '',
                full_name: '',
                role: 'receptionist',
                doctor_id: null,
              })
              setCreating(true)
            }}
          >
            <Plus /> {t('addStaff')}
          </Button>
        }
      />
      {staff.isPending ? (
        <PageSpinner />
      ) : staff.isError ? (
        <ErrorState error={staff.error} onRetry={() => staff.refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('person')}</TableHead>
                <TableHead>{t('roles')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.data.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell>
                    <p className="font-medium">{m.profile?.full_name ?? t('unnamed')}</p>
                    <p className="text-xs text-muted-foreground">{m.profile?.email ?? m.user_id}</p>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {m.roles.map((r) => (
                        <ToneBadge
                          key={r.id}
                          color={r.role === 'admin' ? 'red' : r.role === 'doctor' ? 'teal' : 'blue'}
                          className="gap-1 pr-1"
                        >
                          {t(`role.${r.role}`)}
                          {r.role !== 'admin' &&
                            ` · ${doctorName(r.doctor_id) ?? t('allDoctorsBadge')}`}
                          {!(r.role === 'admin' && m.user_id === auth.userId) && (
                            <button
                              type="button"
                              aria-label={t('removeRole', { role: t(`role.${r.role}`) })}
                              className="rounded p-0.5 hover:bg-background/60"
                              onClick={() => revoke.mutate(r.id)}
                            >
                              <X className="size-3" />
                            </button>
                          )}
                        </ToneBadge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setGranting({ userId: m.user_id, role: 'receptionist', doctorId: ALL })
                      }
                    >
                      {t('addRole')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addStaffTitle')}</DialogTitle>
          </DialogHeader>
          <form
            id="staff-form"
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="grid gap-3"
            noValidate
          >
            <div className="space-y-1.5">
              <Label htmlFor="s-name">{t('fullName')}</Label>
              <Input id="s-name" {...form.register('full_name')} />
              {errors.full_name && (
                <p className="text-sm text-destructive">{errorText(errors.full_name.message)}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-email">{t('workEmail')}</Label>
              <Input id="s-email" type="email" autoComplete="off" {...form.register('email')} />
              {errors.email && (
                <p className="text-sm text-destructive">{errorText(errors.email.message)}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-pass">{t('tempPassword')}</Label>
              <Input
                id="s-pass"
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errorText(errors.password.message)}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('role')}</Label>
                <Controller
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>{roleOptions}</SelectContent>
                    </Select>
                  )}
                />
              </div>
              {role !== 'admin' && (
                <div className="space-y-1.5">
                  <Label>{role === 'doctor' ? t('doctorRecord') : t('doctorAccess')}</Label>
                  <Controller
                    control={form.control}
                    name="doctor_id"
                    render={({ field }) => (
                      <Select
                        value={field.value ?? ALL}
                        onValueChange={(v) => field.onChange(v === ALL ? null : v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {role === 'receptionist' && (
                            <SelectItem value={ALL}>{t('allDoctors')}</SelectItem>
                          )}
                          {doctors.data?.map((d) => (
                            <SelectItem key={d.id} value={d.id}>
                              {d.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.doctor_id && (
                    <p className="text-sm text-destructive">
                      {errorText(errors.doctor_id.message)}
                    </p>
                  )}
                </div>
              )}
            </div>
            <Alert>
              <AlertDescription>{t('serverNote')}</AlertDescription>
            </Alert>
          </form>
          <DialogFooter>
            <Button type="submit" form="staff-form" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} {t('createAccount')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!granting} onOpenChange={(o) => !o && setGranting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('addRole')}</DialogTitle>
          </DialogHeader>
          {granting && (
            <div className="grid grid-cols-2 gap-3">
              <Select
                value={granting.role}
                onValueChange={(v) =>
                  setGranting({
                    ...granting,
                    role: v as AppRole,
                    doctorId: v === 'doctor' ? '' : ALL,
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>{roleOptions}</SelectContent>
              </Select>
              {granting.role !== 'admin' && (
                <Select
                  value={granting.doctorId}
                  onValueChange={(v) => setGranting({ ...granting, doctorId: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('doctor')} />
                  </SelectTrigger>
                  <SelectContent>
                    {granting.role === 'receptionist' && (
                      <SelectItem value={ALL}>{t('allDoctors')}</SelectItem>
                    )}
                    {doctors.data?.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={
                !granting || (granting.role === 'doctor' && !granting.doctorId) || grant.isPending
              }
              onClick={() =>
                granting &&
                grant.mutate(granting.role === 'admin' ? { ...granting, doctorId: ALL } : granting)
              }
            >
              {t('grant')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
