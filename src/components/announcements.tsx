import { Megaphone } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { defineMessages, useT } from '@/i18n'
import { formatDateTime } from '@/lib/format'
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

export function AnnouncementList({
  items,
}: {
  items: Pick<Announcement, 'id' | 'kind' | 'title' | 'body' | 'published_at'>[]
}) {
  const t = useT(messages)
  if (!items.length) return null
  return (
    <section aria-labelledby="announcements-heading" className="space-y-3">
      <h2 id="announcements-heading" className="text-lg font-semibold">
        {t('heading')}
      </h2>
      {items.map((a) => (
        <Alert
          key={a.id}
          className={
            a.kind === 'OPD_CANCELLED' || a.kind === 'DOCTOR_DELAY'
              ? 'border-warning/50'
              : undefined
          }
        >
          <Megaphone aria-hidden />
          <AlertTitle>
            {a.title}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {t(`kind.${a.kind}`)}
              {a.published_at && <> · {formatDateTime(a.published_at)}</>}
            </span>
          </AlertTitle>
          <AlertDescription className="whitespace-pre-line">{a.body}</AlertDescription>
        </Alert>
      ))}
    </section>
  )
}
