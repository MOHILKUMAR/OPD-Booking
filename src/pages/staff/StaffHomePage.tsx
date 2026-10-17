import { Navigate } from 'react-router'
import { useAuth } from '@/auth/AuthProvider'

export default function StaffHomePage() {
  const { isAdmin } = useAuth()
  return <Navigate to={isAdmin ? '/admin' : '/staff/queue'} replace />
}
