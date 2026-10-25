import {
  CalendarClock,
  CalendarDays,
  CircleOff,
  Clock,
  Megaphone,
  type LucideIcon,
} from 'lucide-react'
import type { AnnouncementKind } from '@/types/database'

/**
 * Colours per announcement kind, from the brand palette (cancellations stay red because the
 * colour carries the meaning). bar = site-wide strip, action = its buttons, card = list item.
 * Every text/background pair keeps at least 4.5:1.
 */
export const ANNOUNCEMENT_TONE: Record<
  AnnouncementKind,
  {
    icon: LucideIcon
    bar: string
    action: string
    card: string
    chip: string
    pill: string
    priority: number
  }
> = {
  OPD_CANCELLED: {
    icon: CircleOff,
    bar: 'bg-rose-700 text-white',
    action: 'bg-white/20 hover:bg-white/30',
    card: 'border-rose-200 bg-rose-50',
    chip: 'bg-rose-700 text-white',
    pill: 'bg-rose-100 text-rose-800',
    priority: 0,
  },
  DOCTOR_DELAY: {
    icon: Clock,
    bar: 'bg-cream text-cream-ink',
    action: 'bg-cream-ink/10 hover:bg-cream-ink/15',
    card: 'border-cream-dark bg-cream/60',
    chip: 'bg-cream text-cream-ink ring-1 ring-cream-dark',
    pill: 'bg-cream text-cream-ink',
    priority: 1,
  },
  HOLIDAY: {
    icon: CalendarDays,
    bar: 'bg-sky text-brand-deep',
    action: 'bg-brand-deep/10 hover:bg-brand-deep/15',
    card: 'border-sky bg-sky/20',
    chip: 'bg-sky text-brand-deep',
    pill: 'bg-sky/50 text-brand-deep',
    priority: 2,
  },
  SCHEDULE_CHANGE: {
    icon: CalendarClock,
    bar: 'bg-brand-deep text-white',
    action: 'bg-white/15 hover:bg-white/25',
    card: 'border-steel/40 bg-steel/10',
    chip: 'bg-steel text-white',
    pill: 'bg-steel/15 text-brand-deep',
    priority: 3,
  },
  GENERAL: {
    icon: Megaphone,
    bar: 'bg-brand text-white',
    action: 'bg-white/15 hover:bg-white/25',
    card: 'border-brand/20 bg-white',
    chip: 'bg-brand text-white',
    pill: 'bg-brand/10 text-brand',
    priority: 4,
  },
}
