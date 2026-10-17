import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_POLL_MS, LIVE_POLL_MS, useLiveQueue } from './useLiveQueue'

const mock = vi.hoisted(() => {
  const state: { onChange?: () => void; onStatus?: (s: string) => void; channels: number } = {
    channels: 0,
  }
  const channel = {
    on: (_event: string, _filter: unknown, cb: () => void) => {
      state.onChange = cb
      return channel
    },
    subscribe: (cb: (s: string) => void) => {
      state.onStatus = cb
      return channel
    },
  }
  const supabase = {
    channel: vi.fn(() => {
      state.channels += 1
      return channel
    }),
    removeChannel: vi.fn(async () => 'ok'),
  }
  return { state, supabase }
})
vi.mock('@/lib/supabase', () => ({ supabase: mock.supabase }))

function setup() {
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () =>
      useLiveQueue({
        channelKey: 'track:x',
        filter: 'id=eq.q1',
        queryKeys: [['booking', 'MQ-1', null]],
      }),
    { wrapper },
  )
  return { ...hook, invalidate }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useLiveQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock.state.channels = 0
    setVisibility('visible')
  })

  it('polls every 15 s until Realtime is subscribed, then relaxes to a 60 s safety net', () => {
    const { result } = setup()
    expect(result.current.status).toBe('connecting')
    expect(result.current.refetchInterval).toBe(FALLBACK_POLL_MS)
    act(() => mock.state.onStatus!('SUBSCRIBED'))
    expect(result.current.status).toBe('live')
    expect(result.current.refetchInterval).toBe(LIVE_POLL_MS)
  })

  it('a queue change refetches from the database (Realtime is only a signal)', () => {
    const { invalidate } = setup()
    act(() => mock.state.onChange!())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['booking', 'MQ-1', null] })
  })

  it('falls back to polling when the channel errors or times out', () => {
    const { result } = setup()
    act(() => mock.state.onStatus!('SUBSCRIBED'))
    act(() => mock.state.onStatus!('CHANNEL_ERROR'))
    expect(result.current.status).toBe('polling')
    expect(result.current.refetchInterval).toBe(FALLBACK_POLL_MS)
    act(() => mock.state.onStatus!('TIMED_OUT'))
    expect(result.current.status).toBe('polling')
  })

  it('closes the channel while hidden and resubscribes + refetches on return', () => {
    const { invalidate } = setup()
    expect(mock.state.channels).toBe(1)
    act(() => setVisibility('hidden'))
    expect(mock.supabase.removeChannel).toHaveBeenCalledTimes(1)
    act(() => setVisibility('visible'))
    expect(mock.state.channels).toBe(2)
    expect(invalidate).toHaveBeenCalled()
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = setup()
    unmount()
    expect(mock.supabase.removeChannel).toHaveBeenCalled()
  })
})
