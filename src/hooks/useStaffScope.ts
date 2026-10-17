import { useQuery } from '@tanstack/react-query'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/auth/AuthProvider'
import { useHospital } from '@/hooks/useHospital'
import type { AppRole, Doctor } from '@/types/database'

/**
 * Which doctors the signed-in staff member works with, and in which role for each.
 * Mirrors app.can_access_doctor(); the database enforces it regardless.
 */
export function useStaffScope() {
  const auth = useAuth()
  const { data: hospital } = useHospital()

  const doctors = useQuery({
    queryKey: ['staff-doctors', hospital?.id],
    enabled: !!hospital,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('doctors')
          .select(
            'id, full_name, specialty, room_no, can_self_manage_session, is_active, department:departments(id, name)',
          )
          .eq('hospital_id', hospital!.id)
          .eq('is_active', true)
          .order('sort_order')
          .order('full_name'),
      ) as unknown as Doctor[],
  })

  const rolesFor = (doctorId: string): AppRole[] => {
    const out = new Set<AppRole>()
    for (const r of auth.roles) {
      if (hospital && r.hospital_id !== hospital.id) continue
      if (r.role === 'admin') out.add('admin')
      if (r.role === 'doctor' && r.doctor_id === doctorId) out.add('doctor')
      if (r.role === 'receptionist' && (r.doctor_id === null || r.doctor_id === doctorId))
        out.add('receptionist')
    }
    return [...out]
  }

  const accessible = (doctors.data ?? []).filter((d) => rolesFor(d.id).length > 0)

  return { hospital, doctors: accessible, doctorsQuery: doctors, rolesFor }
}
