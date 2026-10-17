import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { fetchHospital } from '@/api/public'
import { env } from '@/lib/env'
import { todayInIST } from '@/lib/format'

/** The hospital this deployment serves (VITE_HOSPITAL_SLUG). Cached for the session. */
export function useHospital() {
  return useQuery({
    queryKey: ['hospital', env.VITE_HOSPITAL_SLUG],
    queryFn: () => fetchHospital(env.VITE_HOSPITAL_SLUG),
    staleTime: 10 * 60_000,
  })
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/** Re-renders every `ms` milliseconds; returns the current time. */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Today's date in the hospital time zone (refreshes after midnight). */
export function useToday(): string {
  const now = useNow(60_000)
  return todayInIST(now)
}
