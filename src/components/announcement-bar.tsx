import { useQuery } from '@tanstack/react-query'
import { ArrowRight, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { fetchAnnouncements } from '@/api/public'
import { ANNOUNCEMENT_TONE } from '@/components/announcement-tones'
import { useHospital } from '@/hooks/useHospital'
import { defineMessages, useT } from '@/i18n'
import { cn } from '@/lib/utils'

const messages = defineMessages({
  en: {
    label: 'Hospital announcement',
    more: '+{count} more|+{count} more',
    viewAll: 'View all',
    dismiss: 'Hide this announcement',
  },
  hi: {
    label: 'अस्पताल की घोषणा',
    more: '+{count} और|+{count} और',
    viewAll: 'सभी देखें',
    dismiss: 'यह घोषणा छिपाएँ',
  },
})

const DISMISSED_KEY = 'mq.announcement.dismissed'

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

/**
 * Site-wide strip above the header with the most important published announcement
 * (cancellations first, then delays, holidays, schedule changes, notices; newest first).
 * A visitor can hide it; a newer announcement shows again.
 */
export function AnnouncementBar() {
  const t = useT(messages)
  const { data: hospital } = useHospital()
  const [dismissed, setDismissed] = useState(readDismissed)
  const announcements = useQuery({
    queryKey: ['announcements', hospital?.id],
    queryFn: () => fetchAnnouncements(hospital!.id),
    enabled: !!hospital,
  })

  const items = announcements.data ?? []
  const top = [...items].sort(
    (a, b) =>
      ANNOUNCEMENT_TONE[a.kind].priority - ANNOUNCEMENT_TONE[b.kind].priority ||
      (b.published_at ?? '').localeCompare(a.published_at ?? ''),
  )[0]
  if (!top || top.id === dismissed) return null

  const tone = ANNOUNCEMENT_TONE[top.kind]
  const Icon = tone.icon
  const hide = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, top.id)
    } catch {
      // hidden for this visit only
    }
    setDismissed(top.id)
  }

  return (
    <div role="region" aria-label={t('label')} className={cn('bg-gradient-to-r', tone.bar)}>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 text-sm">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/25">
          <Icon className="size-4" aria-hidden />
        </span>
        <p className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{top.title}</span>
          <span className="hidden opacity-90 sm:inline"> — {top.body}</span>
        </p>
        <Link
          to="/#announcements"
          className="flex shrink-0 items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30"
        >
          {items.length > 1 ? t('more', { count: items.length - 1 }) : t('viewAll')}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={hide}
          aria-label={t('dismiss')}
          className="shrink-0 rounded-full p-1 hover:bg-white/25"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}
