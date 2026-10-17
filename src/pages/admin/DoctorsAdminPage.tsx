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
import { defineMessages, useT } from '@/i18n'
import { formatMoney } from '@/lib/format'

const messages = defineMessages({
  en: {
    title: 'Doctors & shifts',
    description: 'Profiles, OPD shifts, weekly schedules, capacity and fees.',
    addDoctor: 'Add doctor',
    emptyTitle: 'No doctors yet',
    emptyBody: 'Add departments first, then doctors.',
    doctor: 'Doctor',
    department: 'Department',
    room: 'Room',
    fee: 'Consultation fee',
    status: 'Status',
    active: 'Active',
    inactive: 'Inactive',
    notAccepting: 'Not accepting',
    edit: 'Edit',
  },
  hi: {
    title: 'डॉक्टर और शिफ़्ट',
    description: 'प्रोफ़ाइल, ओपीडी शिफ़्ट, साप्ताहिक समय-सारणी, क्षमता और शुल्क।',
    addDoctor: 'डॉक्टर जोड़ें',
    emptyTitle: 'अभी कोई डॉक्टर नहीं',
    emptyBody: 'पहले विभाग जोड़ें, फिर डॉक्टर।',
    doctor: 'डॉक्टर',
    department: 'विभाग',
    room: 'कक्ष',
    fee: 'परामर्श शुल्क',
    status: 'स्थिति',
    active: 'सक्रिय',
    inactive: 'निष्क्रिय',
    notAccepting: 'बुकिंग नहीं ले रहे',
    edit: 'बदलें',
  },
})

export default function DoctorsAdminPage() {
  const { data: hospital } = useHospital()
  const t = useT(messages)
  const doctors = useQuery({
    queryKey: ['admin-doctors', hospital?.id],
    queryFn: () => fetchAllDoctors(hospital!.id),
    enabled: !!hospital,
  })

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <Button asChild>
            <Link to="/admin/doctors/new">
              <Plus /> {t('addDoctor')}
            </Link>
          </Button>
        }
      />
      {doctors.isPending ? (
        <PageSpinner />
      ) : doctors.isError ? (
        <ErrorState error={doctors.error} onRetry={() => doctors.refetch()} />
      ) : doctors.data.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('doctor')}</TableHead>
                <TableHead>{t('department')}</TableHead>
                <TableHead>{t('room')}</TableHead>
                <TableHead>{t('fee')}</TableHead>
                <TableHead>{t('status')}</TableHead>
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
                      <ToneBadge color="green">{t('active')}</ToneBadge>
                    ) : (
                      <ToneBadge color="grey">{t('inactive')}</ToneBadge>
                    )}
                    {d.is_active && !d.accepting_bookings && (
                      <ToneBadge color="amber">{t('notAccepting')}</ToneBadge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/admin/doctors/${d.id}`}>{t('edit')}</Link>
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
