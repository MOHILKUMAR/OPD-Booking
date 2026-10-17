import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Link } from 'react-router'
import { fetchAllDoctors } from '@/api/admin'
import { ToneBadge } from '@/components/badges'
import { DoctorAvatar } from '@/components/doctor'
import { EmptyState, ErrorState, PageHeader, PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useHospital } from '@/hooks/useHospital'
import { formatMoney } from '@/lib/format'

export default function DoctorsAdminPage() {
  const { data: hospital } = useHospital()
  const doctors = useQuery({
    queryKey: ['admin-doctors', hospital?.id],
    queryFn: () => fetchAllDoctors(hospital!.id),
    enabled: !!hospital,
  })

  return (
    <div>
      <PageHeader
        title="Doctors & shifts"
        description="Profiles, OPD shifts, weekly schedules, capacity and fees."
        actions={
          <Button asChild>
            <Link to="/admin/doctors/new">
              <Plus /> Add doctor
            </Link>
          </Button>
        }
      />
      {doctors.isPending ? (
        <PageSpinner />
      ) : doctors.isError ? (
        <ErrorState error={doctors.error} onRetry={() => doctors.refetch()} />
      ) : doctors.data.length === 0 ? (
        <EmptyState title="No doctors yet" description="Add departments first, then doctors." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Doctor</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Room</TableHead>
                <TableHead>Consultation fee</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {doctors.data.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <DoctorAvatar
                        name={d.full_name}
                        photoUrl={d.photo_url}
                        className="size-9 rounded-lg"
                      />
                      <div>
                        <p className="font-medium">{d.full_name}</p>
                        <p className="text-xs text-muted-foreground">{d.specialty}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{d.department?.name}</TableCell>
                  <TableCell>{d.room_no ?? '–'}</TableCell>
                  <TableCell>
                    {d.consultation_fee_paise ? formatMoney(d.consultation_fee_paise) : '–'}
                  </TableCell>
                  <TableCell className="space-x-1">
                    {d.is_active ? (
                      <ToneBadge color="green">Active</ToneBadge>
                    ) : (
                      <ToneBadge color="grey">Inactive</ToneBadge>
                    )}
                    {d.is_active && !d.accepting_bookings && (
                      <ToneBadge color="amber">Not accepting</ToneBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/admin/doctors/${d.id}`}>Edit</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
