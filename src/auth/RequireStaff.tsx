import { ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { PageSpinner } from '@/components/states'
import { Button } from '@/components/ui/button'
import type { AppRole } from '@/types/database'
import { useAuth } from './AuthProvider'

/**
 * UI guard for staff routes. This only decides what to render — every staff action is
 * authorized again by the database (RLS + role checks inside each function).
 */
export function RequireStaff({ roles, children }: { roles?: AppRole[]; children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()

  if (auth.loading || auth.rolesLoading || auth.mfaLoading) {
    return <PageSpinner label="Checking access" />
  }
  // An account with an authenticator app must also pass the code step (aal2); the login page
  // asks for it when a password-only session arrives here.
  if (!auth.session || auth.isAnonymous || auth.needsMfa) {
    return <Navigate to={`/staff/login?next=${encodeURIComponent(location.pathname)}`} replace />
  }
  const allowed = roles ? auth.roleNames.some((r) => roles.includes(r)) : auth.isStaff
  if (!allowed) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
        <ShieldAlert className="size-10 text-destructive" aria-hidden />
        <h1 className="text-xl font-semibold">You don’t have access to this page</h1>
        <p className="text-muted-foreground">
          Ask the hospital administrator to grant your account the right role.
        </p>
        <Button variant="outline" onClick={() => auth.signOut()}>
          Sign out
        </Button>
      </div>
    )
  }
  return <>{children}</>
}
