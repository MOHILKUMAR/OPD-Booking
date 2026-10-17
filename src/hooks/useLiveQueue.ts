import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type LiveStatus = 'connecting' | 'live' | 'polling'

/** Poll interval used while Realtime is not connected. */
export const FALLBACK_POLL_MS = 15_000
/** Safety-net poll even while connected (covers missed events). */
export const LIVE_POLL_MS = 60_000

interface Options {
  /** Unique per screen, e.g. `track:<queue_state_id>`. */
  channelKey: string
  /** Postgres-changes filter on queue_states, e.g. `id=eq.<uuid>` or `hospital_id=eq.<uuid>`. */
  filter?: string
  /** Queries to refetch when the queue changes. */
  queryKeys: QueryKey[]
  enabled?: boolean
}

/**
 * Subscribes to PII-free `queue_states` changes and refetches the given queries. PostgreSQL stays
 * the source of truth: Realtime only says "something changed". When the channel is not
 * subscribed (blocked network, free-tier connection limit, reconnecting) the returned
 * `refetchInterval` switches to 15 s polling. The channel is closed while the tab is hidden.
 */
export function useLiveQueue({ channelKey, filter, queryKeys, enabled = true }: Options) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>('connecting')
  // Stable dependency for the effect; keys are small arrays of primitives.
  const keysJson = JSON.stringify(queryKeys)

  useEffect(() => {
    if (!enabled) return
    let channel: ReturnType<typeof supabase.channel> | null = null

    const keys = JSON.parse(keysJson) as QueryKey[]
    const refresh = () => {
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: key })
    }

    const subscribe = () => {
      if (channel) return
      setStatus('connecting')
      channel = supabase
        .channel(`mq:${channelKey}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'queue_states', ...(filter ? { filter } : {}) },
          refresh,
        )
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') setStatus('live')
          else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED')
            setStatus('polling')
        })
    }

    const unsubscribe = () => {
      if (channel) void supabase.removeChannel(channel)
      channel = null
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        unsubscribe()
        setStatus('polling')
      } else {
        subscribe()
        refresh() // catch up on anything missed while hidden
      }
    }

    subscribe()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      unsubscribe()
    }
  }, [channelKey, filter, enabled, keysJson, queryClient])

  return {
    status,
    refetchInterval: status === 'live' ? LIVE_POLL_MS : FALLBACK_POLL_MS,
  }
}
