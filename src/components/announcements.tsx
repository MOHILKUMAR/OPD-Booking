import { Megaphone } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { formatDateTime } from '@/lib/format'
import type { Announcement } from '@/types/database'

const KIND_LABEL: Record<Announcement['kind'], string> = {
  GENERAL: 'Notice',
  DOCTOR_DELAY: 'Doctor delay',
  OPD_CANCELLED: 'OPD cancelled',
  HOLIDAY: 'Holiday',
  SCHEDULE_CHANGE: 'Schedule change',
}

export function AnnouncementList({
  items,
}: {
  items: Pick<Announcement, 'id' | 'kind' | 'title' | 'body' | 'published_at'>[]
}) {
  if (!items.length) return null
  return (
    <section aria-labelledby="announcements-heading" className="space-y-3">
      <h2 id="announcements-heading" className="text-lg font-semibold">
        Announcements
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
              {KIND_LABEL[a.kind]}
              {a.published_at && <> · {formatDateTime(a.published_at)}</>}
            </span>
          </AlertTitle>
          <AlertDescription className="whitespace-pre-line">{a.body}</AlertDescription>
        </Alert>
      ))}
    </section>
  )
}
