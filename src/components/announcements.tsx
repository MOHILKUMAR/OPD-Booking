import { ANNOUNCEMENT_TONE } from '@/components/announcement-tones'
import { defineMessages, useT } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Announcement } from '@/types/database'

const messages = defineMessages({
  en: {
    heading: 'Announcements',
    'kind.GENERAL': 'Notice',
    'kind.DOCTOR_DELAY': 'Doctor delay',
    'kind.OPD_CANCELLED': 'OPD cancelled',
    'kind.HOLIDAY': 'Holiday',
    'kind.SCHEDULE_CHANGE': 'Schedule change',
  },
  hi: {
    heading: 'घोषणाएँ',
    'kind.GENERAL': 'सूचना',
    'kind.DOCTOR_DELAY': 'डॉक्टर को देरी',
    'kind.OPD_CANCELLED': 'ओपीडी रद्द',
    'kind.HOLIDAY': 'छुट्टी',
    'kind.SCHEDULE_CHANGE': 'समय में बदलाव',
  },
})

type Item = Pick<Announcement, 'id' | 'kind' | 'title' | 'body' | 'published_at'>

export function AnnouncementList({ items }: { items: Item[] }) {
  const t = useT(messages)
  if (!items.length) return null
  return (
    <section
      id="announcements"
      aria-labelledby="announcements-heading"
      className="scroll-mt-24 space-y-3"
    >
      <h2 id="announcements-heading" className="text-lg font-semibold">
        {t('heading')}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((a) => {
          const tone = ANNOUNCEMENT_TONE[a.kind]
          const Icon = tone.icon
          return (
            <article key={a.id} className={cn('flex gap-3 rounded-lg border p-4', tone.card)}>
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-full',
                  tone.chip,
                )}
              >
                <Icon className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('rounded-sm px-2 py-0.5 text-xs font-semibold', tone.pill)}>
                    {t(`kind.${a.kind}`)}
                  </span>
                  {a.published_at && (
                    <span className="text-xs text-slate-600">{formatDateTime(a.published_at)}</span>
                  )}
                </div>
                <h3 className="font-semibold text-slate-900">{a.title}</h3>
                <p className="whitespace-pre-line text-sm text-slate-700">{a.body}</p>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
