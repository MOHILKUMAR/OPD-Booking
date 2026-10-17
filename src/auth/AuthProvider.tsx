import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { unwrap } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import type { AppRole, UserRole } from '@/types/database'

interface AuthState {
  session: Session | null
  loading: boolean
  userId: string | null
  isAnonymous: boolean
  /** Staff roles from user_roles (RLS: a user can read only their own rows). */
  roles: UserRole[]
  roleNames: AppRole[]
  isStaff: boolean
  isAdmin: boolean
  rolesLoading: boolean
  /**
   * True when the account has a verified authenticator app but this session has only passed the
   * password step (aal1). Staff pages ask for the code before showing anything.
   */
  needsMfa: boolean
  mfaLoading: boolean
  signOut: () => Promise<void>
}

interface AssuranceLevel {
  userId: string
  current: string | null
  next: string | null
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id ?? null
  const isAnonymous = session?.user.is_anonymous ?? false

  // Recomputed on every session change (sign-in, MFA verify, token refresh). The previous value
  // is kept meanwhile, so an hourly token refresh does not flash the "Checking access" spinner.
  const [aal, setAal] = useState<AssuranceLevel | null>(null)
  useEffect(() => {
    if (!session || session.user.is_anonymous) return
    let active = true
    void supabase.auth.mfa
      .getAuthenticatorAssuranceLevel()
      .catch(() => ({ data: null }))
      .then(({ data }) => {
        if (!active) return
        setAal({
          userId: session.user.id,
          current: data?.currentLevel ?? null,
          next: data?.nextLevel ?? null,
        })
      })
    return () => {
      active = false
    }
  }, [session])
  const aalForUser = aal && aal.userId === userId ? aal : null

  const rolesQuery = useQuery({
    queryKey: ['my-roles', userId],
    enabled: !!userId && !isAnonymous,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(await supabase.from('user_roles').select('*').eq('user_id', userId!)) as UserRole[],
  })

  const value = useMemo<AuthState>(() => {
    const roles = rolesQuery.data ?? []
    const roleNames = [...new Set(roles.map((r) => r.role))]
    return {
      session,
      loading,
      userId,
      isAnonymous,
      roles,
      roleNames,
      isStaff: roles.length > 0,
      isAdmin: roleNames.includes('admin'),
      rolesLoading: !!userId && !isAnonymous && rolesQuery.isPending,
      needsMfa: aalForUser?.next === 'aal2' && aalForUser.current !== 'aal2',
      mfaLoading: !!userId && !isAnonymous && !aalForUser,
      signOut: async () => {
        await supabase.auth.signOut()
        queryClient.clear()
      },
    }
  }, [
    session,
    loading,
    userId,
    isAnonymous,
    rolesQuery.data,
    rolesQuery.isPending,
    aalForUser,
    queryClient,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
