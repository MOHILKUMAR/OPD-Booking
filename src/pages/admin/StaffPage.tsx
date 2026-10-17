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
import { errorMessage } from '@/lib/errors'
import type { AppRole } from '@/types/database'

const ALL = '__all'

export default function StaffPage() {
  const { data: hospital } = useHospital()
  const auth = useAuth()
  const queryClient = useQueryClient()
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
    resolver: zodResolver(createStaffSchema),
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

  const create = useMutation({
    mutationFn: (v: z.output<typeof createStaffSchema>) => createStaff(v),
    onSuccess: (r) => {
      toast.success(
        r.created
          ? 'Staff account created. Share the temporary password securely.'
          : 'Existing account given the new role.',
      )
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
    id ? (doctors.data?.find((d) => d.id === id)?.full_name ?? 'Doctor') : null

  return (
    <div>
      <PageHeader
        title="Staff & roles"
        description="Least privilege: receptionists can be limited to specific doctors. The last administrator cannot be removed."
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
            <Plus /> Add staff
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
                <TableHead>Person</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.data.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell>
                    <p className="font-medium">{m.profile?.full_name ?? 'Unnamed'}</p>
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
                          {r.role}
                          {r.role !== 'admin' && ` · ${doctorName(r.doctor_id) ?? 'all doctors'}`}
                          {!(r.role === 'admin' && m.user_id === auth.userId) && (
                            <button
                              type="button"
                              aria-label={`Remove ${r.role} role`}
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
                      Add role
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
            <DialogTitle>Add staff account</DialogTitle>
          </DialogHeader>
          <form
            id="staff-form"
            onSubmit={form.handleSubmit((v) => create.mutate(v))}
            className="grid gap-3"
            noValidate
          >
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Full name</Label>
              <Input id="s-name" {...form.register('full_name')} />
              {errors.full_name && (
                <p className="text-sm text-destructive">{errors.full_name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-email">Work email</Label>
              <Input id="s-email" type="email" autoComplete="off" {...form.register('email')} />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-pass">Temporary password</Label>
              <Input
                id="s-pass"
                type="password"
                autoComplete="new-password"
                {...form.register('password')}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Controller
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="receptionist">Receptionist</SelectItem>
                        <SelectItem value="doctor">Doctor</SelectItem>
                        <SelectItem value="admin">Administrator</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              {role !== 'admin' && (
                <div className="space-y-1.5">
                  <Label>{role === 'doctor' ? 'Doctor record' : 'Doctor access'}</Label>
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
                            <SelectItem value={ALL}>All doctors</SelectItem>
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
                    <p className="text-sm text-destructive">{errors.doctor_id.message}</p>
                  )}
                </div>
              )}
            </div>
            <Alert>
              <AlertDescription>
                The account is created by a server function after verifying you are an
                administrator. Ask the person to change the password after first sign-in.
              </AlertDescription>
            </Alert>
          </form>
          <DialogFooter>
            <Button type="submit" form="staff-form" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Create account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!granting} onOpenChange={(o) => !o && setGranting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add role</DialogTitle>
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
                <SelectContent>
                  <SelectItem value="receptionist">Receptionist</SelectItem>
                  <SelectItem value="doctor">Doctor</SelectItem>
                  <SelectItem value="admin">Administrator</SelectItem>
                </SelectContent>
              </Select>
              {granting.role !== 'admin' && (
                <Select
                  value={granting.doctorId}
                  onValueChange={(v) => setGranting({ ...granting, doctorId: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    {granting.role === 'receptionist' && (
                      <SelectItem value={ALL}>All doctors</SelectItem>
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
              Grant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
