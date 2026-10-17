import { createClient } from '@supabase/supabase-js'
import { env } from './env'

// Publishable key only. All data access is protected by RLS and database functions.
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'mediqueue-auth',
  },
  realtime: { params: { eventsPerSecond: 5 } },
})
